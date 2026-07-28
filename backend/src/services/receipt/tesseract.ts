/**
 * Tesseract.js receipt extractor — fully offline OCR.
 *
 * Runs the OCR in a lazily-created, reused worker and serializes recognitions
 * (one image at a time). Language data (default `pol+eng`) is fetched once and
 * cached under the data directory so it survives restarts; point
 * TESSERACT_LANG_PATH at a local bundle for a strictly no-egress deployment.
 */

import { createWorker, OEM, Worker, WorkerOptions } from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { ReceiptExtractor, ReceiptExtraction } from './types';
import { parseReceiptText } from './parse';

const LANGS = process.env.RECEIPT_OCR_LANGS || 'pol+eng';

/** Where downloaded `*.traineddata` is cached (defaults next to the DB file). */
function cacheDir(): string {
  if (process.env.TESSERACT_CACHE_PATH) return process.env.TESSERACT_CACHE_PATH;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'expenses.db');
  return path.join(path.dirname(dbPath), 'tesseract');
}

export class TesseractExtractor implements ReceiptExtractor {
  readonly name = 'tesseract';
  private workerPromise: Promise<Worker> | null = null;
  // Promise chain that serializes recognize() calls on the single worker.
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      const cachePath = cacheDir();
      // tesseract.js caches downloaded language data with a bare fs.writeFile
      // (no mkdir), so the directory must already exist — otherwise the
      // *.traineddata is silently never persisted and gets re-downloaded on
      // every restart (one network blip then crashes the server, see below).
      fs.mkdirSync(cachePath, { recursive: true });

      const options: Partial<WorkerOptions> = {
        cachePath,
        gzip: true,
        // Critical: without an errorHandler, a worker-side failure (most often a
        // failed language download) is re-thrown inside the worker's 'message'
        // handler as an *uncaught exception* that takes the whole server down.
        // Providing one keeps the failure on the awaited job promise (so the
        // request gets a clean 500) while the process stays alive.
        errorHandler: (err) => console.error('Tesseract worker error:', err),
      };
      if (process.env.TESSERACT_LANG_PATH) options.langPath = process.env.TESSERACT_LANG_PATH;
      // OEM.LSTM_ONLY = the modern neural engine (best accuracy on receipts).
      this.workerPromise = createWorker(LANGS, OEM.LSTM_ONLY, options).catch(err => {
        // Reset so a transient init failure (e.g. lang download) can be retried.
        this.workerPromise = null;
        throw new Error(
          `Could not initialize the OCR engine — the '${LANGS}' language data may have failed ` +
          `to download. For offline use, bundle the *.traineddata files and set TESSERACT_LANG_PATH. ` +
          `(${err instanceof Error ? err.message : String(err)})`
        );
      });
    }
    return this.workerPromise;
  }

  async extract(image: Buffer, _mimeType: string): Promise<ReceiptExtraction> {
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(image);
      return data;
    });
    // Keep the queue moving even if this job throws, so one bad image doesn't
    // wedge every subsequent scan.
    this.queue = run.catch(() => undefined);

    const data = await run;
    const confidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
    return parseReceiptText(data.text || '', confidence);
  }
}

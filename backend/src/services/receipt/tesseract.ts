/**
 * Tesseract.js receipt extractor — fully offline OCR.
 *
 * Runs the OCR in a lazily-created, reused worker and serializes recognitions
 * (one image at a time). Language data comes from `tessdata/` next to the app
 * (staged by `npm run tessdata`, and baked into the Docker image), so the
 * bundled stack never has to reach the network to read its first receipt.
 * TESSERACT_LANG_PATH overrides that; with neither, tesseract.js falls back to
 * downloading from its CDN and caching under the data directory.
 */

import { createWorker, OEM, Worker, WorkerOptions } from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { ReceiptExtractor, ReceiptExtraction } from './types';
import { parseReceiptText } from './parse';

const LANGS = process.env.RECEIPT_OCR_LANGS || 'pol+eng';

/**
 * Wall-clock ceilings, in milliseconds.
 *
 * These are coupled to `proxy_read_timeout` on `location ^~ /api` in
 * frontend/nginx.conf: the worst case a scan can take (init + recognize) has to
 * stay under it, or the proxy answers 504 and the caller never sees the message
 * explaining what actually went wrong. 60 + 110 < 180. Change them together.
 *
 * Neither is a normal-path number. With language data present, init is ~7s and
 * a phone photo recognizes in a few seconds; these only bound the pathological
 * cases — a cold CDN download over a bad link, or a worker that has wedged.
 */
const INIT_TIMEOUT_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 110_000;

/** Where downloaded `*.traineddata` is cached (defaults next to the DB file). */
function cacheDir(): string {
  if (process.env.TESSERACT_CACHE_PATH) return process.env.TESSERACT_CACHE_PATH;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'expenses.db');
  return path.join(path.dirname(dbPath), 'tesseract');
}

/**
 * The language data shipped with the app.
 *
 * Resolves to `<backend>/tessdata` from both `src/services/receipt` (ts-node)
 * and `dist/services/receipt` (the built image), because the two trees sit at
 * the same depth.
 */
function bundledLangDir(): string {
  return path.join(__dirname, '..', '..', '..', 'tessdata');
}

/** Where a worker should read `*.traineddata` from, and in which form. */
interface LangSource {
  /** Left undefined to let tesseract.js download from its CDN. */
  langPath?: string;
  gzip: boolean;
  /** One phrase for the boot log, so a self-hoster can see which path won. */
  origin: string;
}

/** Does `dir` hold every one of `langs`, in the `gzip` form? */
function covers(dir: string, langs: string[], gzip: boolean): boolean {
  return langs.every((lang) => fs.existsSync(path.join(dir, `${lang}.traineddata${gzip ? '.gz' : ''}`)));
}

/**
 * Decide where the `*.traineddata` for `langs` comes from.
 *
 * Two constraints from tesseract.js shape this. It reads exactly one file name
 * per language out of `langPath` — `<lang>.traineddata.gz` when the `gzip`
 * option is true, `<lang>.traineddata` when it is false — so a directory that
 * mixes the two forms cannot be used for both languages, and the flag has to be
 * chosen for the whole set. And it does *not* fall back to the CDN for a
 * language `langPath` happens to be missing: it fails the whole worker. So the
 * bundle only wins when it covers every requested language, which is what keeps
 * `RECEIPT_OCR_LANGS=deu` working on an image that ships pol+eng.
 *
 * An explicitly configured TESSERACT_LANG_PATH is never second-guessed, even if
 * it is incomplete. Its documented purpose is a strictly no-egress deployment,
 * and silently reaching for the CDN would be the one behaviour such an operator
 * asked us not to have.
 */
function resolveLangSource(langs: string[]): LangSource {
  const explicit = process.env.TESSERACT_LANG_PATH;
  if (explicit) {
    // Default to gzip, matching the form the data ships in; accept a directory
    // of plain .traineddata too, since that is what tessdata_best hands you.
    const gzip = covers(explicit, langs, true) || !covers(explicit, langs, false);
    return { langPath: explicit, gzip, origin: `TESSERACT_LANG_PATH (${explicit})` };
  }

  const bundled = bundledLangDir();
  for (const gzip of [true, false]) {
    if (covers(bundled, langs, gzip)) {
      return { langPath: bundled, gzip, origin: `bundled data (${bundled})` };
    }
  }

  return { gzip: true, origin: 'the tesseract.js CDN (no local copy found)' };
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

      const langs = LANGS.split('+').map((l) => l.trim()).filter(Boolean);
      const source = resolveLangSource(langs);
      console.log(`Tesseract: loading '${LANGS}' from ${source.origin}`);

      // How a worker-side failure has to be caught, and why there are two nets.
      //
      // tesseract.js 7.0.0 hands a failed job to `errorHandler` and then drops
      // it: src/createWorker.js only rejects its own promise for the `load`
      // action, and the `loadLanguage` rejection that a failed download
      // produces is swallowed by a trailing `.catch(() => {})`. The promise
      // `createWorker` returned therefore never settles — the request hangs
      // until the proxy gives up, which is exactly what it did in the bundled
      // Docker stack when the CDN could not be reached.
      //
      // So `errorHandler` is the fast path (it fires the moment the worker
      // reports the failure) and the timeout is the backstop for a worker that
      // stops answering altogether. The handler is also given a *string* rather
      // than an Error, which is why the original cause never reached the log.
      let failInit: (err: Error) => void = () => {};

      const options: Partial<WorkerOptions> = {
        cachePath,
        gzip: source.gzip,
        errorHandler: (err) => {
          console.error('Tesseract worker error:', err);
          failInit(new Error(String(err)));
        },
      };
      if (source.langPath) options.langPath = source.langPath;

      const started = createWorker(LANGS, OEM.LSTM_ONLY, options);

      this.workerPromise = new Promise<Worker>((resolve, reject) => {
        let settled = false;
        const finish = (settle: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          settle();
        };

        const timer = setTimeout(
          () => finish(() => reject(new Error(`initialization timed out after ${INIT_TIMEOUT_MS} ms`))),
          INIT_TIMEOUT_MS,
        );
        // A ceiling must not be a reason for the process to stay alive.
        timer.unref?.();

        failInit = (err) => finish(() => reject(err));

        started.then(
          (worker) => {
            // A worker that arrives after we gave up is a live thread nobody
            // holds a reference to; end it rather than leak it.
            if (settled) void worker.terminate().catch(() => undefined);
            else finish(() => resolve(worker));
          },
          (err) => finish(() => reject(err)),
        );
      }).catch((err) => {
        // Reset so a transient init failure (e.g. lang download) can be retried.
        this.workerPromise = null;
        throw new Error(
          `Could not initialize the OCR engine — the '${LANGS}' language data may have failed ` +
          `to load from ${source.origin}. For offline use, run 'npm run tessdata' or point ` +
          `TESSERACT_LANG_PATH at a folder of *.traineddata.gz files. ` +
          `(${err instanceof Error ? err.message : String(err)})`
        );
      });
    }
    return this.workerPromise;
  }

  /**
   * Drop the shared worker after a job that will never come back.
   *
   * There is no way to cancel a recognition once the worker has started it, so
   * a timed-out job leaves the thread busy forever. Terminating it and clearing
   * the cached promise means the next scan builds a fresh worker instead of
   * queueing behind a dead one.
   */
  private discardWorker(worker: Worker): void {
    this.workerPromise = null;
    void worker.terminate().catch(() => undefined);
  }

  private async recognize(worker: Worker, image: Buffer) {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.discardWorker(worker);
        reject(new Error(`Reading the receipt timed out after ${RECOGNIZE_TIMEOUT_MS} ms`));
      }, RECOGNIZE_TIMEOUT_MS);
      timer.unref?.();
    });

    try {
      const { data } = await Promise.race([worker.recognize(image), deadline]);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async extract(image: Buffer, _mimeType: string): Promise<ReceiptExtraction> {
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      return this.recognize(worker, image);
    });
    // Keep the queue moving even if this job throws, so one bad image doesn't
    // wedge every subsequent scan.
    this.queue = run.catch(() => undefined);

    const data = await run;
    const confidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
    return parseReceiptText(data.text || '', confidence);
  }
}

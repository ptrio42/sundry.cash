/**
 * Unit tests for the Tesseract extractor's resilience wiring.
 *
 * tesseract.js is mocked so no real OCR worker or network download runs. What
 * is under test is everything that stands between a failed language load and a
 * hung HTTP request:
 *
 *   1. the language-data cache directory exists before the worker starts
 *      (tesseract.js writes the cache with a bare fs.writeFile, so a missing
 *      dir means the download is never persisted and is re-fetched every run);
 *   2. where the `*.traineddata` is read from — bundled copy, explicit
 *      TESSERACT_LANG_PATH, or the CDN — and in which form;
 *   3. that a failed or wedged worker makes `extract()` REJECT.
 *
 * (3) is the one that matters. tesseract.js 7.0.0 reports a failed
 * `loadLanguage` job by calling `errorHandler` and then dropping it — its own
 * promise is only rejected for the `load` action, and the rejection is
 * swallowed by a trailing `.catch(() => {})` in src/createWorker.js. So the
 * mock below deliberately returns a promise that NEVER SETTLES: that is what
 * the real library does, and an earlier version of this file asserted the
 * opposite by mocking a rejection that cannot happen. The tests passed while a
 * scan hung until nginx answered 504.
 */

jest.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: jest.fn(),
}));

import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { TesseractExtractor } from '../services/receipt/tesseract';

const mockedCreateWorker = createWorker as jest.MockedFunction<typeof createWorker>;

/** The options object the extractor handed to createWorker. */
type WorkerOptions = {
  cachePath?: string;
  langPath?: string;
  gzip?: boolean;
  errorHandler?: (err: unknown) => void;
};

const optionsFromLastCall = (): WorkerOptions =>
  mockedCreateWorker.mock.calls[mockedCreateWorker.mock.calls.length - 1][2] as WorkerOptions;

/** A promise that never settles — what createWorker returns on a failed load. */
const neverSettles = () => new Promise<never>(() => undefined);

/** Drain the microtask queue without letting real time pass. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** Both ceilings from services/receipt/tesseract.ts. */
const INIT_TIMEOUT_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 110_000;

describe('TesseractExtractor', () => {
  let mkdirSpy: jest.SpyInstance;
  let existsSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const langPathEnv = process.env.TESSERACT_LANG_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TESSERACT_LANG_PATH;
    // Don't touch the real filesystem — just record the call.
    mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    // Default: no local language data anywhere, so the CDN is the fallback.
    // Tests that care about resolution override this per case, which is what
    // keeps them independent of whether `npm run tessdata` has been run here.
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    mkdirSpy.mockRestore();
    existsSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (langPathEnv === undefined) delete process.env.TESSERACT_LANG_PATH;
    else process.env.TESSERACT_LANG_PATH = langPathEnv;
    jest.useRealTimers();
  });

  describe('worker setup', () => {
    it('ensures the cache dir exists and wires an errorHandler on the worker', async () => {
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: 'SUMA PLN 10,00', confidence: 90 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      const extractor = new TesseractExtractor();
      await extractor.extract(Buffer.from('img'), 'image/png');

      expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });

      const options = optionsFromLastCall();
      expect(typeof options.errorHandler).toBe('function');
      expect(typeof options.cachePath).toBe('string');
    });

    it('reuses one worker across scans', async () => {
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: 'SUMA PLN 10,00', confidence: 90 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      const extractor = new TesseractExtractor();
      await extractor.extract(Buffer.from('a'), 'image/png');
      await extractor.extract(Buffer.from('b'), 'image/png');

      expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('language data resolution', () => {
    it('falls back to the CDN when no local copy covers the requested languages', async () => {
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await new TesseractExtractor().extract(Buffer.from('img'), 'image/png');

      // No langPath at all is what makes tesseract.js download.
      expect(optionsFromLastCall().langPath).toBeUndefined();
    });

    it('prefers the bundled tessdata directory when it holds every language', async () => {
      existsSpy.mockImplementation((p) => String(p).endsWith('.traineddata.gz'));
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await new TesseractExtractor().extract(Buffer.from('img'), 'image/png');

      const options = optionsFromLastCall();
      expect(options.langPath).toBe(path.join(__dirname, '..', '..', 'tessdata'));
      expect(options.gzip).toBe(true);
    });

    it('does not use a bundled copy that is missing one of the languages', async () => {
      // pol is there, eng is not — using the directory would fail the whole
      // worker, because tesseract.js does not fall back per language.
      existsSpy.mockImplementation((p) => String(p).endsWith('pol.traineddata.gz'));
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await new TesseractExtractor().extract(Buffer.from('img'), 'image/png');

      expect(optionsFromLastCall().langPath).toBeUndefined();
    });

    it('honours TESSERACT_LANG_PATH even when the directory looks empty', async () => {
      // The variable's whole purpose is a no-egress deployment; quietly
      // reaching for the CDN would be the one behaviour it was set to prevent.
      process.env.TESSERACT_LANG_PATH = '/srv/tessdata';
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await new TesseractExtractor().extract(Buffer.from('img'), 'image/png');

      const options = optionsFromLastCall();
      expect(options.langPath).toBe('/srv/tessdata');
      expect(options.gzip).toBe(true);
    });

    it('reads uncompressed *.traineddata when that is what the directory holds', async () => {
      process.env.TESSERACT_LANG_PATH = '/srv/tessdata';
      existsSpy.mockImplementation((p) => /\.traineddata$/.test(String(p)));
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await new TesseractExtractor().extract(Buffer.from('img'), 'image/png');

      expect(optionsFromLastCall().gzip).toBe(false);
    });
  });

  describe('failure never hangs the request', () => {
    it('rejects as soon as the worker reports an error, though createWorker never settles', async () => {
      mockedCreateWorker.mockReturnValue(neverSettles());

      const extractor = new TesseractExtractor();
      const scan = extractor.extract(Buffer.from('img'), 'image/png');
      const settled = jest.fn();
      scan.then(settled, settled);

      await flush();
      // tesseract.js hands the handler a bare string, not an Error.
      optionsFromLastCall().errorHandler!('TypeError: fetch failed');

      await expect(scan).rejects.toThrow(/OCR engine/i);
      await expect(scan).rejects.toThrow(/fetch failed/);
      expect(settled).toHaveBeenCalled();
    });

    it('gives up on a worker that never finishes initializing', async () => {
      jest.useFakeTimers();
      mockedCreateWorker.mockReturnValue(neverSettles());

      const scan = new TesseractExtractor().extract(Buffer.from('img'), 'image/png');
      const swallow = scan.catch(() => undefined);

      await flush();
      jest.advanceTimersByTime(INIT_TIMEOUT_MS);

      await expect(scan).rejects.toThrow(/timed out/i);
      await swallow;
    });

    it('retries initialization on the next scan after a failure', async () => {
      mockedCreateWorker.mockReturnValueOnce(neverSettles());

      const extractor = new TesseractExtractor();
      const failing = extractor.extract(Buffer.from('img'), 'image/png');
      const swallow = failing.catch(() => undefined);
      await flush();
      optionsFromLastCall().errorHandler!('TypeError: fetch failed');
      await expect(failing).rejects.toThrow();
      await swallow;

      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: 'SUMA PLN 10,00', confidence: 90 } }),
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      await expect(extractor.extract(Buffer.from('img'), 'image/png')).resolves.toBeDefined();
      expect(mockedCreateWorker).toHaveBeenCalledTimes(2);
    });

    it('rejects with a helpful message when createWorker itself rejects', async () => {
      mockedCreateWorker.mockRejectedValue(new Error('fetch failed'));

      const extractor = new TesseractExtractor();
      await expect(extractor.extract(Buffer.from('img'), 'image/png')).rejects.toThrow(/OCR engine/i);
    });

    it('drops a worker whose recognition never returns, so the next scan gets a fresh one', async () => {
      jest.useFakeTimers();
      const terminate = jest.fn().mockResolvedValue(undefined);
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockReturnValue(neverSettles()),
        terminate,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);

      const extractor = new TesseractExtractor();
      const scan = extractor.extract(Buffer.from('img'), 'image/png');
      const swallow = scan.catch(() => undefined);

      await flush();
      jest.advanceTimersByTime(RECOGNIZE_TIMEOUT_MS);

      await expect(scan).rejects.toThrow(/timed out/i);
      await swallow;
      expect(terminate).toHaveBeenCalled();

      // The cached worker was discarded, so the next scan builds another.
      mockedCreateWorker.mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: 'SUMA PLN 10,00', confidence: 90 } }),
        terminate,
      } as unknown as Awaited<ReturnType<typeof createWorker>>);
      await expect(extractor.extract(Buffer.from('img'), 'image/png')).resolves.toBeDefined();
      expect(mockedCreateWorker).toHaveBeenCalledTimes(2);
    });
  });
});

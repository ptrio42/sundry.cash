/**
 * Unit tests for the Tesseract extractor's resilience wiring.
 *
 * tesseract.js is mocked so no real OCR worker or network download runs — we
 * only assert the two safeguards that stop a failed receipt scan from taking
 * down the whole backend:
 *   1. the language-data cache directory is created before the worker starts
 *      (tesseract.js writes the cache with a bare fs.writeFile, so a missing
 *      dir means the download is never persisted and is re-fetched every run);
 *   2. an errorHandler is passed to createWorker, so a worker-thread failure
 *      surfaces as a rejected promise rather than an uncaught exception.
 */

jest.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: jest.fn(),
}));

import { createWorker } from 'tesseract.js';
import fs from 'fs';
import { TesseractExtractor } from '../services/receipt/tesseract';

const mockedCreateWorker = createWorker as jest.MockedFunction<typeof createWorker>;

describe('TesseractExtractor resilience', () => {
  let mkdirSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Don't touch the real filesystem — just record the call.
    mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  });

  afterEach(() => {
    mkdirSpy.mockRestore();
  });

  it('ensures the cache dir exists and wires an errorHandler on the worker', async () => {
    mockedCreateWorker.mockResolvedValue({
      recognize: jest.fn().mockResolvedValue({ data: { text: 'SUMA PLN 10,00', confidence: 90 } }),
    } as unknown as Awaited<ReturnType<typeof createWorker>>);

    const extractor = new TesseractExtractor();
    await extractor.extract(Buffer.from('img'), 'image/png');

    // (1) cache directory is created recursively before the worker starts.
    expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });

    // (2) createWorker received a function errorHandler and a cachePath.
    const options = mockedCreateWorker.mock.calls[0][2] as Record<string, unknown>;
    expect(typeof options.errorHandler).toBe('function');
    expect(typeof options.cachePath).toBe('string');
  });

  it('rejects with a helpful message (instead of crashing) when worker init fails', async () => {
    mockedCreateWorker.mockRejectedValue(new Error('fetch failed'));

    const extractor = new TesseractExtractor();
    await expect(extractor.extract(Buffer.from('img'), 'image/png')).rejects.toThrow(/OCR engine/i);
  });
});

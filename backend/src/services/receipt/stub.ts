/**
 * Stub receipt extractor for tests / demos.
 *
 * Decodes the uploaded bytes as UTF-8 text and runs the real parser on them, so
 * route tests can "upload" a snippet of receipt text (as a fake image) and
 * exercise the full scan → parse → response path without invoking Tesseract.
 */

import { ReceiptExtractor, ReceiptExtraction } from './types';
import { parseReceiptText } from './parse';

export class StubExtractor implements ReceiptExtractor {
  readonly name = 'stub';

  async extract(image: Buffer): Promise<ReceiptExtraction> {
    return parseReceiptText(image.toString('utf8'), 0.9);
  }
}

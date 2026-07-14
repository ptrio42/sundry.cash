/**
 * Receipt extractor factory.
 *
 * Selects the OCR engine from RECEIPT_OCR_PROVIDER (default: `tesseract`).
 * Swapping engines — e.g. adding cloud AI vision — is a change confined to this
 * folder; routes and the frontend never learn which engine ran.
 *
 * Adding Claude Vision later:
 *   1. create ./claude.ts implementing ReceiptExtractor (send the image to the
 *      Anthropic Messages API, ask for a JSON of {amount,date,merchant,currency}
 *      via a tool/structured output, then reuse parse.ts helpers as needed);
 *   2. add a `case 'claude'` below, reading ANTHROPIC_API_KEY;
 *   3. set RECEIPT_OCR_PROVIDER=claude. No other file needs to change.
 */

import { ReceiptExtractor } from './types';
import { TesseractExtractor } from './tesseract';
import { StubExtractor } from './stub';

let cached: ReceiptExtractor | null = null;

function resolveProvider(): string {
  const explicit = process.env.RECEIPT_OCR_PROVIDER?.trim().toLowerCase();
  if (explicit) return explicit;
  // Tests default to the offline stub so they never spin up the OCR worker.
  if (process.env.NODE_ENV === 'test') return 'stub';
  return 'tesseract';
}

export function getExtractor(): ReceiptExtractor {
  if (cached) return cached;

  switch (resolveProvider()) {
    case 'stub':
      cached = new StubExtractor();
      break;
    case 'claude':
      throw new Error(
        "RECEIPT_OCR_PROVIDER=claude is not implemented yet. Add services/receipt/claude.ts " +
        "(Claude Vision) and wire it here, or unset RECEIPT_OCR_PROVIDER to use local Tesseract OCR."
      );
    case 'tesseract':
      cached = new TesseractExtractor();
      break;
    default:
      throw new Error(`Unknown RECEIPT_OCR_PROVIDER: ${resolveProvider()}`);
  }

  return cached;
}

/** Test helper: forget the cached extractor so a new provider can be selected. */
export function resetExtractor(): void {
  cached = null;
}

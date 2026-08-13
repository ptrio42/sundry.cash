/**
 * Receipt scanning routes.
 *
 *   POST /api/receipts/scan   -> OCR a receipt photo, return extracted fields
 *                                (no expense is created yet)
 *   POST /api/receipts        -> create an expense from the reviewed fields and
 *                                attach the uploaded photo
 *   GET  /api/receipts/:file  -> stream a stored receipt image
 *
 * Mirrors the two-step Excel import flow (scan → review → save) so the user
 * always confirms the numbers before anything is written.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Currency, ExpenseCategory } from '../types/expense.types';
import { isValidDate } from '../middleware/validation';
import * as ExpenseModel from '../models/expense';
import * as CategoryModel from '../models/category';
import * as CurrencyModel from '../models/currency';
import { getExtractor } from '../services/receipt';
import {
  saveReceiptImage,
  receiptImagePath,
  deleteReceiptImage,
  mimeForReceiptFilename,
} from '../services/receipt/storage';
import fs from 'fs';

const router = Router();


// Bound concurrent OCR jobs: each scan holds a multi-MB image in memory and runs
// CPU-heavy recognition, so cap in-flight work to avoid memory/CPU exhaustion.
const MAX_CONCURRENT_SCANS = 3;
let activeScans = 0;

// Accept common raster image formats that the OCR engine can decode. HEIC/HEIF
// (default iPhone format) can't be decoded without extra native deps, so it is
// rejected with a clear message rather than failing deep inside OCR.
const ACCEPTED_IMAGE_MIME = /^image\/(jpe?g|png|webp|gif|bmp|tiff)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — plenty for a phone photo
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_IMAGE_MIME.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image type. Use JPEG, PNG, or WebP (HEIC is not supported).'));
    }
  },
});

/**
 * Wrap a multer middleware so its errors (bad type, file too large) become clean
 * 400 JSON responses instead of bubbling to the generic 500 handler.
 */
function uploadReceipt(req: Request, res: Response, next: () => void): void {
  upload.single('receipt')(req, res, (err: any) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({ error: tooBig ? 'Image is too large (max 10MB)' : err.message });
      return;
    }
    next();
  });
}

/**
 * POST /api/receipts/scan
 * Read a receipt photo and return the extracted fields for the user to review.
 */
router.post('/scan', uploadReceipt, async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image uploaded' });
    return;
  }

  if (activeScans >= MAX_CONCURRENT_SCANS) {
    res.status(429).json({ error: 'Too many receipts are being processed right now — please try again in a moment.' });
    return;
  }

  activeScans++;
  try {
    const extraction = await getExtractor().extract(req.file.buffer, req.file.mimetype);
    res.json(extraction);
  } catch (error) {
    console.error('Receipt OCR failed:', error);
    res.status(500).json({
      error: 'Failed to read the receipt',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    activeScans--;
  }
});

/** Longest merchant name worth storing; a receipt header is a shop name, not a paragraph. */
const MAX_MERCHANT_LENGTH = 120;

/**
 * The merchant the scan detected, as it should be stored.
 *
 * Not a user-facing field and never validated into a 400: the client echoes
 * back what `/scan` returned, so a missing or unusable value simply means the
 * row groups by its description instead — which is what every manually entered
 * expense already does. Truncated rather than rejected for the same reason.
 */
function detectedMerchant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_MERCHANT_LENGTH);
}

/**
 * POST /api/receipts
 * Create an expense from reviewed fields, attaching the uploaded photo.
 * Sent as multipart/form-data: the image in `receipt`, the fields alongside.
 *
 * `merchant` rides along as the scanner saw it, never as something the user
 * typed: the description box is theirs to rewrite, and the insights layer still
 * needs to know which shop the row came from. See docs/insights-spec.md.
 */
router.post('/', uploadReceipt, (req: Request, res: Response) => {
  try {
    const amount = parseFloat(String(req.body.amount ?? ''));
    const { date, description, category, currency, merchant, who } = req.body as Record<string, string>;

    const errors: string[] = [];
    if (!isFinite(amount) || amount <= 0) errors.push('Amount must be a positive number');
    if (!date || !isValidDate(date)) errors.push('Date must be a valid ISO date (YYYY-MM-DD)');
    if (!description || description.trim().length === 0) errors.push('Description is required');
    if (!CategoryModel.exists(category)) errors.push(`Category must be one of: ${CategoryModel.allSlugs().join(', ')}`);
    if (!CurrencyModel.isEnabled(currency)) errors.push(`Currency must be one of: ${CurrencyModel.enabledCodes().join(', ')}`);

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    // Persist the photo only after validation passes, so invalid submissions
    // don't litter the receipts directory.
    const receiptImage = req.file ? saveReceiptImage(req.file.buffer, req.file.mimetype) : null;

    try {
      const expense = ExpenseModel.create({
        amount,
        date,
        description: description.trim(),
        category: category as ExpenseCategory,
        currency: currency as Currency,
        receiptImage,
        merchant: detectedMerchant(merchant),
        // One of the three creation paths that must stamp the device label —
        // typed, scanned, imported. Normalized by the model; absent means the
        // device never answered, which is a value.
        who,
      });
      res.status(201).json(expense);
    } catch (dbError) {
      // Roll back the saved image if the row couldn't be written.
      deleteReceiptImage(receiptImage);
      throw dbError;
    }
  } catch (error) {
    console.error('Failed to create expense from receipt:', error);
    res.status(500).json({ error: 'Failed to create expense from receipt' });
  }
});

/**
 * GET /api/receipts/:filename
 * Stream a stored receipt image (auth-protected via the router mount).
 */
router.get('/:filename', (req: Request, res: Response) => {
  const full = receiptImagePath(req.params.filename);
  if (!full) {
    res.status(400).json({ error: 'Invalid receipt filename' });
    return;
  }

  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'Receipt image not found' });
    return;
  }

  res.setHeader('Content-Type', mimeForReceiptFilename(req.params.filename));
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(full);
});

export default router;

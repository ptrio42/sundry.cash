/**
 * Tests for the receipt scanning endpoints.
 *
 * Under NODE_ENV=test the OCR provider resolves to the offline "stub" extractor,
 * which decodes the uploaded bytes as text and runs the real parser — so we can
 * "upload" receipt text as a fake image and exercise the full flow without
 * Tesseract. Receipt images are written to a throwaway temp directory.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';

// Isolate stored images from the dev data dir before anything imports storage.
const TEST_RECEIPTS_DIR = path.join(os.tmpdir(), `receipt-test-${process.pid}`);
process.env.RECEIPTS_DIR = TEST_RECEIPTS_DIR;

import request from 'supertest';
import app from '../server';
import { isSafeReceiptFilename, receiptImagePath } from '../services/receipt/storage';

const RECEIPT_TEXT = `Biedronka
NIP 779-10-11-327
2024-01-15
Mleko 3,49
Chleb 4,20
SUMA PLN   11,18
GOTOWKA    20,00
RESZTA      8,82`;

// Track created expenses so we can clean up the shared dev DB afterwards.
const createdIds: number[] = [];

afterAll(async () => {
  for (const id of createdIds) {
    await request(app).delete(`/api/expenses/${id}`);
  }
  fs.rmSync(TEST_RECEIPTS_DIR, { recursive: true, force: true });
});

describe('POST /api/receipts/scan', () => {
  it('extracts fields from a receipt image', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .attach('receipt', Buffer.from(RECEIPT_TEXT), { filename: 'r.png', contentType: 'image/png' })
      .expect(200);

    expect(res.body.amount).toBe(11.18);
    expect(res.body.date).toBe('2024-01-15');
    expect(res.body.merchant).toBe('Biedronka');
    expect(res.body.currency).toBe('PLN');
    expect(res.body.category).toBe('groceries');
    expect(typeof res.body.rawText).toBe('string');
  });

  it('returns 400 when no image is uploaded', async () => {
    const res = await request(app).post('/api/receipts/scan').expect(400);
    expect(res.body.error).toBe('No image uploaded');
  });

  it('rejects unsupported file types', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .attach('receipt', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(res.body.error).toMatch(/unsupported image type/i);
  });
});

describe('POST /api/receipts (save with image)', () => {
  it('creates an expense and attaches the receipt image', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .attach('receipt', Buffer.from(RECEIPT_TEXT), { filename: 'r.png', contentType: 'image/png' })
      .field('amount', '11.18')
      .field('date', '2024-01-15')
      .field('description', 'Biedronka')
      .field('category', 'groceries')
      .field('currency', 'PLN')
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.amount).toBe(11.18);
    expect(res.body.receiptImage).toBeTruthy();
    createdIds.push(res.body.id);

    // The stored image is retrievable and holds the original bytes.
    const img = await request(app).get(`/api/receipts/${res.body.receiptImage}`).expect(200);
    expect(img.body.toString()).toContain('Biedronka');
  });

  it('creates an expense without an image', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .field('amount', '9.99')
      .field('date', '2024-02-02')
      .field('description', 'No photo expense')
      .field('category', 'other')
      .field('currency', 'USD')
      .expect(201);

    expect(res.body.receiptImage).toBeNull();
    createdIds.push(res.body.id);
  });

  it('rejects invalid fields with 400', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .field('amount', '-5')
      .field('date', 'not-a-date')
      .field('description', '')
      .field('category', 'bogus')
      .field('currency', 'XYZ')
      .expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.length).toBeGreaterThan(0);
  });
});

describe('GET /api/receipts/:filename', () => {
  it('returns 404 for a well-formed but missing filename', async () => {
    await request(app).get('/api/receipts/receipt-000-deadbeef.png').expect(404);
  });
});

describe('storage safety (path traversal)', () => {
  it('accepts plain generated filenames', () => {
    expect(isSafeReceiptFilename('receipt-123-abcd.png')).toBe(true);
  });

  it('rejects traversal and separators', () => {
    expect(isSafeReceiptFilename('../secret.png')).toBe(false);
    expect(isSafeReceiptFilename('a/b.png')).toBe(false);
    expect(isSafeReceiptFilename('..')).toBe(false);
    expect(isSafeReceiptFilename('foo\0.png')).toBe(false);
    expect(receiptImagePath('../../etc/passwd')).toBeNull();
  });
});

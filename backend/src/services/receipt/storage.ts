/**
 * Receipt image storage on disk.
 *
 * Images live under the data directory (same volume as the SQLite DB, so they
 * persist across restarts and stay out of git). The DB stores only the
 * generated filename; helpers here translate a filename to an absolute path and
 * guard against path traversal.
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

/** Directory that holds receipt images (defaults next to the DB file). */
export function receiptsDir(): string {
  if (process.env.RECEIPTS_DIR) return process.env.RECEIPTS_DIR;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'expenses.db');
  return path.join(path.dirname(dbPath), 'receipts');
}

/** Map a supported image MIME type to a file extension. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

export function extensionForMime(mimeType: string): string {
  return EXT_BY_MIME[mimeType.toLowerCase()] || 'img';
}

/**
 * Persist an image buffer and return the opaque filename to store on the
 * expense. The name is random (timestamp + 8 random bytes) so it never collides
 * and cannot be guessed.
 */
export function saveReceiptImage(buffer: Buffer, mimeType: string): string {
  const dir = receiptsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `receipt-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extensionForMime(mimeType)}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return filename;
}

/** True when `filename` is a plain basename (no separators, no traversal). */
export function isSafeReceiptFilename(filename: string): boolean {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename.length <= 128 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('\0') &&
    path.basename(filename) === filename &&
    filename !== '.' &&
    filename !== '..'
  );
}

/** Absolute path for a stored receipt, or null if the filename is unsafe/missing. */
export function receiptImagePath(filename: string): string | null {
  if (!isSafeReceiptFilename(filename)) return null;
  const full = path.join(receiptsDir(), filename);
  // Defense in depth: ensure the resolved path stays inside the receipts dir.
  const base = path.resolve(receiptsDir());
  if (!path.resolve(full).startsWith(base + path.sep)) return null;
  return full;
}

/** Best-effort delete of a receipt image; never throws. */
export function deleteReceiptImage(filename: string | null | undefined): void {
  if (!filename) return;
  const full = receiptImagePath(filename);
  if (!full) return;
  try {
    fs.unlinkSync(full);
  } catch {
    /* already gone — ignore */
  }
}

/** Delete every stored receipt image (used when wiping the database). */
export function clearReceiptImages(): void {
  const dir = receiptsDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return; // directory doesn't exist yet — nothing to clear
  }
  for (const entry of entries) {
    if (!isSafeReceiptFilename(entry)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry));
    } catch {
      /* ignore */
    }
  }
}

/** Content-Type to serve a stored receipt with, inferred from its extension. */
export function mimeForReceiptFilename(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const found = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext);
  return found ? found[0] : 'application/octet-stream';
}

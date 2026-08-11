/**
 * Feature gates — whether this instance offers a route at all.
 *
 * `requireAuth` answers "who are you"; this answers "is that switched on here".
 * They compose in that order at the mount, so a stranger still gets 401 from a
 * password-protected instance rather than learning which features it runs.
 */

import { Request, Response, NextFunction } from 'express';
import { isReceiptsEnabled } from '../config/instance';

/**
 * Gate receipt upload and OCR behind RECEIPTS_ENABLED.
 *
 * 403 rather than 404 on purpose: the route exists, it is turned off, and a
 * caller deserves to know which — a 404 would send someone hunting for a
 * typo in a URL that is perfectly correct.
 */
export function receiptsEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (isReceiptsEnabled()) {
    next();
    return;
  }

  res.status(403).json({ error: 'Receipt scanning is disabled on this instance' });
}

/**
 * Auth middleware — gates protected routes behind a valid bearer token.
 *
 * Two "no token needed" cases, and they are opposites:
 *   - no APP_PASSWORD and no AUTH_REQUIRED  -> open API, the documented
 *     self-hosted default (a laptop, a trusted LAN).
 *   - no APP_PASSWORD but AUTH_REQUIRED set -> 503, never `next()`. The
 *     operator declared this instance reachable by strangers and the password
 *     did not resolve, so the only safe answer is to serve nothing.
 *
 * The second case is the fail-open finding in docs/hosted-security.md §3, and
 * it is deliberately checked *before* the token, so a misconfigured instance
 * cannot be talked past with a stale token either.
 */

import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, isAuthMisconfigured, verifyToken } from '../config/auth';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthMisconfigured()) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Authentication is required on this instance but is not configured.',
    });
    return;
  }

  if (!isAuthEnabled()) {
    next();
    return;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (token && verifyToken(token)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Auth middleware — gates protected routes behind a valid bearer token.
 * A no-op when auth is disabled (no APP_PASSWORD configured).
 */

import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, verifyToken } from '../config/auth';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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

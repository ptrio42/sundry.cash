/**
 * Auth routes — public (not behind requireAuth).
 *   GET  /api/auth/status  -> whether a password is required
 *   POST /api/auth/login   -> exchange the password for a bearer token
 */

import { Router, Request, Response } from 'express';
import { isAuthEnabled, passwordMatches, signToken } from '../config/auth';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json({ authRequired: isAuthEnabled() });
});

router.post('/login', (req: Request, res: Response) => {
  if (!isAuthEnabled()) {
    res.status(400).json({ error: 'Authentication is not enabled' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !passwordMatches(password)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  res.json({ token: signToken() });
});

export default router;

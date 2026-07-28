/**
 * Auth routes — public (not behind requireAuth).
 *   GET  /api/auth/status  -> whether a password is required
 *   POST /api/auth/login   -> exchange the password for a bearer token
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isAuthEnabled, passwordMatches, signToken } from '../config/auth';

const router = Router();

/**
 * Throttle password guessing.
 *
 * The token payload is known plaintext signed with the password (or
 * AUTH_SECRET), so an attacker who can guess freely is the main risk to a
 * self-hosted instance exposed beyond localhost. Measured before this existed:
 * ~660 attempts/second against the login route with nothing to stop them.
 *
 * `skipSuccessfulRequests` means only failures count, so a person who logs in
 * normally — even repeatedly across devices — never trips it.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ authRequired: isAuthEnabled() });
});

router.post('/login', loginLimiter, (req: Request, res: Response) => {
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

/**
 * Auth routes — public (not behind requireAuth).
 *   GET  /api/auth/status  -> whether a password is required
 *   POST /api/auth/login   -> exchange the password for a bearer token
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isAuthEnabled, isAuthMisconfigured, isAuthRequired, passwordMatches, signToken } from '../config/auth';
import {
  SqliteRateLimitStore,
  loginBackstop,
  noteLoginFailure,
  noteLoginSuccess,
} from '../middleware/rateLimit';

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
 *
 * The store is SQLite rather than the default in-memory map: a platform that
 * stops idle machines wipes process memory, and a counter that resets every
 * idle period is not a counter (docs/hosted-security.md §2.4). `loginBackstop`
 * below is the second line, for the attacker who simply changes address.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new SqliteRateLimitStore(),
  message: { error: 'Too many login attempts. Try again later.' },
});

/**
 * A misconfigured instance answers 503 here too, and reports `authRequired:
 * true` below.
 *
 * Both matter to the same trap: the frontend treats `authRequired: false` as
 * "no login needed and the app may render". An instance that demands a password
 * it does not have must therefore not answer `false` — it is not an open
 * instance, it is a broken one, and the honest report is "a password is
 * required" plus a login route that cannot mint a token.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({ authRequired: isAuthEnabled() || isAuthRequired() });
});

router.post('/login', loginBackstop, loginLimiter, (req: Request, res: Response) => {
  if (isAuthMisconfigured()) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Authentication is required on this instance but is not configured.',
    });
    return;
  }

  if (!isAuthEnabled()) {
    res.status(400).json({ error: 'Authentication is not enabled' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !passwordMatches(password)) {
    noteLoginFailure();
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  noteLoginSuccess();
  res.json({ token: signToken() });
});

export default router;

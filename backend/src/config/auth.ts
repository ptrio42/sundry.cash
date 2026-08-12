/**
 * Single-user authentication.
 *
 * Auth is OPT-IN: it activates only when APP_PASSWORD is set. With no password
 * configured the API stays open (convenient for local dev / trusted LAN). When a
 * password is set, clients exchange it for a short-lived HMAC-signed bearer token
 * — no heavyweight JWT dependency, just Node's crypto.
 *
 * OPT-IN IS RIGHT FOR A LAPTOP AND CATASTROPHIC ON A PUBLIC HOST, so there is a
 * second flag. `AUTH_REQUIRED` says "this instance is reachable by strangers":
 * with it set and no password resolving, the app refuses to boot and every
 * guarded route answers 503 rather than `next()`. Nothing changes when it is
 * unset — a self-hosted laptop install behaves exactly as it always has.
 * See docs/hosted-security.md §3 finding 1.
 */

import crypto from 'crypto';
import { flag } from './instance';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getPassword(): string | undefined {
  const p = process.env.APP_PASSWORD;
  return p && p.length > 0 ? p : undefined;
}

// Signing secret: an explicit AUTH_SECRET if provided, otherwise the password.
function getSecret(): string {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || '';
}

/**
 * What the bearer token is actually signed with — reported at boot, because
 * "AUTH_SECRET is empty" is invisible otherwise and the fallback is dangerous.
 *
 *   'AUTH_SECRET'  an explicit key, the only correct answer on a public host.
 *   'APP_PASSWORD' the fallback: the token payload is known plaintext
 *                  (`{"exp":…}`) keyed by the password, so one leaked token is
 *                  an offline, unthrottled cracker for it. Kept working for
 *                  backward compatibility, refused when AUTH_REQUIRED is set.
 *                  docs/hosted-security.md §3.
 *   'none'         no password either, so nothing signs anything: auth is off.
 */
export function secretSource(): 'AUTH_SECRET' | 'APP_PASSWORD' | 'none' {
  const explicit = process.env.AUTH_SECRET;
  if (explicit && explicit.length > 0) return 'AUTH_SECRET';
  return getPassword() !== undefined ? 'APP_PASSWORD' : 'none';
}

/** Is the token signed with the password itself, for want of an AUTH_SECRET? */
export function isSecretFallback(): boolean {
  return secretSource() === 'APP_PASSWORD';
}

/**
 * Is a password mandatory on this instance? Read from the environment on every
 * call, the same shape as `config/instance.ts`, so a test can flip it without
 * reloading the module graph.
 */
export function isAuthRequired(): boolean {
  return flag('AUTH_REQUIRED', false);
}

export function isAuthEnabled(): boolean {
  return getPassword() !== undefined;
}

/**
 * Is the instance in the one state that must never serve data — auth demanded
 * by configuration, and no credential to enforce it with?
 *
 * `requireAuth` asks this instead of falling through to `next()`. Keeping it
 * here rather than in the middleware means the boot assertion and the request
 * path answer from the same expression, so they cannot disagree.
 */
export function isAuthMisconfigured(): boolean {
  return isAuthRequired() && !isAuthEnabled();
}

/**
 * Everything wrong with this instance's auth configuration, split by whether it
 * should stop the process.
 *
 * A pure function so it can be tested directly and called from boot; `server.ts`
 * owns the decision to exit, because a module that calls `process.exit` cannot
 * be imported by a test.
 */
export function authConfigurationProblems(): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (isAuthRequired()) {
    if (!isAuthEnabled()) {
      fatal.push(
        'AUTH_REQUIRED is set but APP_PASSWORD is empty. This instance would serve every ' +
        'expense, receipt and budget to anyone who can reach it. Set APP_PASSWORD, or unset ' +
        'AUTH_REQUIRED if this really is a localhost install.'
      );
    }
    if (isSecretFallback()) {
      // Refused rather than warned about, per docs/hosted-security.md §3: on an
      // instance a stranger can reach, one captured token is an offline attack
      // on the password itself.
      fatal.push(
        'AUTH_REQUIRED is set but AUTH_SECRET is empty, so bearer tokens would be signed with ' +
        'APP_PASSWORD. Generate one with `openssl rand -hex 32` and set AUTH_SECRET.'
      );
    }
  } else if (isSecretFallback()) {
    warnings.push(
      'AUTH_SECRET is empty: bearer tokens are signed with APP_PASSWORD itself. The token ' +
      'payload is known plaintext, so a leaked token is an offline cracker for your password. ' +
      'Generate one with `openssl rand -hex 32` and set AUTH_SECRET.'
    );
  }

  return { fatal, warnings };
}

/** Constant-time comparison of a candidate password against APP_PASSWORD. */
export function passwordMatches(candidate: string): boolean {
  const pw = getPassword();
  if (!pw) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/** Issue a signed token that expires TOKEN_TTL_MS from now. */
export function signToken(now: number = Date.now()): string {
  const payloadB64 = Buffer.from(JSON.stringify({ exp: now + TOKEN_TTL_MS })).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify a token's signature and expiry. */
export function verifyToken(token: string, now: number = Date.now()): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp > now;
  } catch {
    return false;
  }
}

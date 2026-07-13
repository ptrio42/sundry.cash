/**
 * Single-user authentication.
 *
 * Auth is OPT-IN: it activates only when APP_PASSWORD is set. With no password
 * configured the API stays open (convenient for local dev / trusted LAN). When a
 * password is set, clients exchange it for a short-lived HMAC-signed bearer token
 * — no heavyweight JWT dependency, just Node's crypto.
 */

import crypto from 'crypto';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getPassword(): string | undefined {
  const p = process.env.APP_PASSWORD;
  return p && p.length > 0 ? p : undefined;
}

// Signing secret: an explicit AUTH_SECRET if provided, otherwise the password.
function getSecret(): string {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || '';
}

export function isAuthEnabled(): boolean {
  return getPassword() !== undefined;
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

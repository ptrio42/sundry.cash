/**
 * Login throttling state, stored in the instance's own SQLite.
 *
 * Two counters with different jobs:
 *   - `auth_rate_limit` is the per-IP bucket express-rate-limit drives through
 *     the store adapter in `middleware/rateLimit.ts`. First line of defence,
 *     and the one that never inconveniences the owner.
 *   - `auth_backstop` is one row for the whole instance: consecutive failed
 *     logins and the instant the next attempt is allowed. It catches what the
 *     per-IP bucket cannot — an attacker rotating source addresses, which is
 *     cheap and is the documented weakness of per-IP limiting.
 *
 * Every function takes `now` so the policy can be tested without waiting for
 * wall-clock time. All SQL for both tables lives here, per the layering the
 * rest of `models/` keeps; the tables are created in `config/database.ts`.
 */

import { db } from '../config/database';

export interface RateLimitEntry {
  /** Attempts counted in the current window. */
  hits: number;
  /** Epoch ms at which the window ends and the count resets. */
  resetAt: number;
}

export interface BackstopState {
  /** Failed logins since the last successful one, across all addresses. */
  consecutiveFailures: number;
  /** Epoch ms before which no login attempt is accepted. 0 = not blocked. */
  blockedUntil: number;
}

/**
 * Count one attempt against `key`, starting a new window if the old one has
 * expired. Returns the state *after* the increment, which is what
 * express-rate-limit's store contract asks for.
 */
export function increment(key: string, windowMs: number, now: number = Date.now()): RateLimitEntry {
  const current = db
    .prepare('SELECT hits, reset_at AS resetAt FROM auth_rate_limit WHERE key = ?')
    .get(key) as RateLimitEntry | undefined;

  // An expired window is indistinguishable from an absent one — both start at
  // one hit. Checking the stored expiry rather than deleting on a timer is what
  // makes this survive a restart with no sweeper process.
  if (!current || current.resetAt <= now) {
    const entry: RateLimitEntry = { hits: 1, resetAt: now + windowMs };
    db.prepare(
      `INSERT INTO auth_rate_limit (key, hits, reset_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET hits = excluded.hits, reset_at = excluded.reset_at`
    ).run(key, entry.hits, entry.resetAt);
    purgeExpired(now);
    return entry;
  }

  const hits = current.hits + 1;
  db.prepare('UPDATE auth_rate_limit SET hits = ? WHERE key = ?').run(hits, key);
  return { hits, resetAt: current.resetAt };
}

/** Read a key's state without counting an attempt. Undefined once expired. */
export function get(key: string, now: number = Date.now()): RateLimitEntry | undefined {
  const row = db
    .prepare('SELECT hits, reset_at AS resetAt FROM auth_rate_limit WHERE key = ?')
    .get(key) as RateLimitEntry | undefined;
  return row && row.resetAt > now ? row : undefined;
}

/**
 * Give one hit back. express-rate-limit calls this for a request that turned
 * out not to count — which for us is every successful login, because the
 * limiter runs with `skipSuccessfulRequests`.
 */
export function decrement(key: string): void {
  db.prepare('UPDATE auth_rate_limit SET hits = MAX(hits - 1, 0) WHERE key = ?').run(key);
}

export function resetKey(key: string): void {
  db.prepare('DELETE FROM auth_rate_limit WHERE key = ?').run(key);
}

export function resetAll(): void {
  db.prepare('DELETE FROM auth_rate_limit').run();
}

/** Drop windows that have closed, so the table cannot grow without bound. */
export function purgeExpired(now: number = Date.now()): void {
  db.prepare('DELETE FROM auth_rate_limit WHERE reset_at <= ?').run(now);
}

export function backstopState(): BackstopState {
  const row = db
    .prepare(
      'SELECT consecutive_failures AS consecutiveFailures, blocked_until AS blockedUntil FROM auth_backstop WHERE id = 1'
    )
    .get() as BackstopState | undefined;

  // The row is seeded at initialization. Its absence means the table was
  // dropped or never created, and per docs/hosted-security.md §3 "no row" must
  // never be read as "not throttled" — a control that cannot read its own state
  // has failed, so say so rather than returning a permissive default.
  if (!row) throw new Error('auth_backstop row is missing: login throttling state cannot be read');
  return row;
}

/**
 * Count a failed login. Returns the state after the increment, because the
 * delay the caller then applies is a function of the new streak length — the
 * policy that turns a count into a delay is in `middleware/rateLimit.ts`, not
 * here, so that this file stays the SQL and nothing else.
 */
export function recordFailure(): BackstopState {
  db.prepare('UPDATE auth_backstop SET consecutive_failures = consecutive_failures + 1 WHERE id = 1').run();
  return backstopState();
}

/** Refuse every login attempt until this instant (epoch ms). */
export function setBlockedUntil(at: number): void {
  db.prepare('UPDATE auth_backstop SET blocked_until = ? WHERE id = 1').run(at);
}

/** A correct password clears the streak — the delay is for guessing, not use. */
export function clearFailures(): void {
  db.prepare('UPDATE auth_backstop SET consecutive_failures = 0, blocked_until = 0 WHERE id = 1').run();
}

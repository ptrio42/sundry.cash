/**
 * Login throttling: a per-IP bucket that survives a restart, and a per-instance
 * backstop behind it.
 *
 * The per-IP limiter is the first line and the one tuned for the owner: it
 * counts only failures, so logging in from four devices never trips it. It has
 * one structural weakness — rotating source addresses costs an attacker almost
 * nothing, and behind a misconfigured `trust proxy` every client shares one
 * bucket anyway (see `config/security.ts`).
 *
 * So there is a second counter with no key at all. Sundry is one user on one
 * instance, which means a global lock is available to us in a way it is not to
 * a multi-user product: locking "the account" locks exactly one person, and
 * that person can read the reason in their own server log. The delay grows with
 * the streak so that a human who mistyped their password twice waits seconds
 * while a script that has guessed forty times waits a quarter of an hour.
 *
 * The schedule below is OUR JUDGEMENT — no published source sets it.
 * docs/hosted-security.md §2.4 requires only that the counter survive autostop;
 * the shape of the delay is a product decision, recorded here.
 */

import { Request, Response, NextFunction } from 'express';
import type { Store, ClientRateLimitInfo, IncrementResponse, Options } from 'express-rate-limit';
import * as RateLimitModel from '../models/rateLimit';

/** Failures allowed at full speed before the backstop starts adding delay. */
export const BACKSTOP_FREE_ATTEMPTS = 5;
/** Longest the backstop will ever lock the instance for. */
export const BACKSTOP_MAX_DELAY_MS = 15 * 60 * 1000;

/**
 * How long the instance is refused after `failures` consecutive bad passwords.
 *
 * Doubling from one second: 6 failures = 2s, 10 = 32s, 15 = 17min -> capped at
 * 15. Two typos cost nothing, a sustained attack costs 96 guesses a day.
 */
export function backstopDelayMs(failures: number): number {
  if (failures <= BACKSTOP_FREE_ATTEMPTS) return 0;
  const doublings = failures - BACKSTOP_FREE_ATTEMPTS;
  return Math.min(1000 * 2 ** (doublings - 1), BACKSTOP_MAX_DELAY_MS);
}

/**
 * express-rate-limit store backed by the instance's SQLite file.
 *
 * better-sqlite3 is synchronous, which suits a store interface that accepts a
 * value or a promise: no async plumbing, no connection pool, and the write is
 * durable before the middleware decides anything.
 */
export class SqliteRateLimitStore implements Store {
  /**
   * False: the counter is shared by every instance of the store in this
   * process *and* by every process that opens the same file, which is what
   * makes it survive a restart. The flag exists so express-rate-limit's
   * double-count check does not mistake that for a misconfiguration.
   */
  localKeys = false;

  private windowMs = 15 * 60 * 1000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  increment(key: string): IncrementResponse {
    const entry = RateLimitModel.increment(key, this.windowMs);
    return { totalHits: entry.hits, resetTime: new Date(entry.resetAt) };
  }

  get(key: string): ClientRateLimitInfo | undefined {
    const entry = RateLimitModel.get(key);
    return entry ? { totalHits: entry.hits, resetTime: new Date(entry.resetAt) } : undefined;
  }

  decrement(key: string): void {
    RateLimitModel.decrement(key);
  }

  resetKey(key: string): void {
    RateLimitModel.resetKey(key);
  }

  resetAll(): void {
    RateLimitModel.resetAll();
  }
}

/**
 * Refuse every login while the backstop's delay is running.
 *
 * Sits in front of the per-IP limiter, because the point of it is to catch the
 * attacker the per-IP limiter cannot see.
 */
export function loginBackstop(_req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const state = RateLimitModel.backstopState();

  if (state.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((state.blockedUntil - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many login attempts. Try again later.',
      retryAfter: retryAfterSeconds,
    });
    return;
  }

  next();
}

/** Count a bad password and extend the lock. Returns the new delay in ms. */
export function noteLoginFailure(now: number = Date.now()): number {
  const state = RateLimitModel.recordFailure();
  const delay = backstopDelayMs(state.consecutiveFailures);
  if (delay > 0) RateLimitModel.setBlockedUntil(now + delay);
  return delay;
}

/** A correct password ends the streak. */
export function noteLoginSuccess(): void {
  RateLimitModel.clearFailures();
}

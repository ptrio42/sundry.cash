/**
 * Login throttling: the per-IP bucket that now lives on disk, and the
 * per-instance backstop behind it.
 *
 * The point of both is that they survive a restart — docs/hosted-security.md
 * §2.4: a platform that stops idle machines wipes process memory, so an
 * in-memory counter resets faster than an attacker can be bothered to pace.
 */

import request from 'supertest';
import app from '../server';
import { db } from '../config/database';
import * as RateLimitModel from '../models/rateLimit';
import {
  BACKSTOP_FREE_ATTEMPTS,
  BACKSTOP_MAX_DELAY_MS,
  SqliteRateLimitStore,
  backstopDelayMs,
} from '../middleware/rateLimit';

const ORIGINAL_PASSWORD = process.env.APP_PASSWORD;

/** Every test starts from an instance nobody has guessed at yet. */
function clearThrottleState(): void {
  RateLimitModel.resetAll();
  RateLimitModel.clearFailures();
}

beforeEach(() => {
  clearThrottleState();
  process.env.APP_PASSWORD = 'hunter2';
});

afterAll(() => {
  clearThrottleState();
  if (ORIGINAL_PASSWORD === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = ORIGINAL_PASSWORD;
});

describe('The per-IP counter is on disk', () => {
  it('writes failed attempts to SQLite rather than to process memory', async () => {
    await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);

    const rows = db.prepare('SELECT key, hits, reset_at FROM auth_rate_limit').all() as Array<{
      key: string;
      hits: number;
      reset_at: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(2);
    expect(rows[0].reset_at).toBeGreaterThan(Date.now());
  });

  // A restart is a new store object over the same file. The old MemoryStore
  // would have started this assertion from zero.
  it('survives a restart: a fresh store reads the count back', async () => {
    await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);

    const afterRestart = new SqliteRateLimitStore();
    afterRestart.init({ windowMs: 15 * 60 * 1000 } as never);
    const key = (db.prepare('SELECT key FROM auth_rate_limit').get() as { key: string }).key;

    expect(afterRestart.get(key)?.totalHits).toBe(1);
    expect(afterRestart.increment(key).totalHits).toBe(2);
  });

  it('starts a new window once the old one has closed', () => {
    const past = Date.now() - 60_000;
    RateLimitModel.increment('probe', 1_000, past);
    expect(RateLimitModel.get('probe', past + 500)?.hits).toBe(1);

    // Expired: not readable, and the next attempt starts at one rather than two.
    expect(RateLimitModel.get('probe')).toBeUndefined();
    expect(RateLimitModel.increment('probe', 1_000).hits).toBe(1);
  });

  it('drops expired rows so the table cannot grow without bound', () => {
    RateLimitModel.increment('stale', 1_000, Date.now() - 60_000);
    RateLimitModel.increment('fresh', 60_000);
    RateLimitModel.purgeExpired();
    const keys = (db.prepare('SELECT key FROM auth_rate_limit').all() as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['fresh']);
  });
});

describe('The per-instance backstop', () => {
  it('lets a couple of typos through, then grows the delay, then caps it', () => {
    expect(backstopDelayMs(1)).toBe(0);
    expect(backstopDelayMs(BACKSTOP_FREE_ATTEMPTS)).toBe(0);
    expect(backstopDelayMs(BACKSTOP_FREE_ATTEMPTS + 1)).toBe(1_000);
    expect(backstopDelayMs(BACKSTOP_FREE_ATTEMPTS + 2)).toBe(2_000);
    expect(backstopDelayMs(BACKSTOP_FREE_ATTEMPTS + 6)).toBe(32_000);
    expect(backstopDelayMs(BACKSTOP_FREE_ATTEMPTS + 40)).toBe(BACKSTOP_MAX_DELAY_MS);
  });

  it('locks the instance after a run of failures, whatever the source address', async () => {
    // The per-IP bucket cannot see an attacker who changes address; this one
    // counts the account, so a rotating source makes no difference to it.
    for (let i = 0; i < BACKSTOP_FREE_ATTEMPTS + 1; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `198.51.100.${i}`)
        .send({ password: 'wrong' })
        .expect(401);
    }

    const blocked = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ password: 'wrong' })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // And the right password is refused too, or the lock would be trivially
    // bypassable by whoever finally guessed correctly.
    await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(429);
  });

  it('is remembered on disk, not in the process', async () => {
    for (let i = 0; i < BACKSTOP_FREE_ATTEMPTS + 1; i++) {
      await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    }
    const state = RateLimitModel.backstopState();
    expect(state.consecutiveFailures).toBe(BACKSTOP_FREE_ATTEMPTS + 1);
    expect(state.blockedUntil).toBeGreaterThan(Date.now());
  });

  it('clears the streak on a correct password', async () => {
    await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    expect(RateLimitModel.backstopState().consecutiveFailures).toBe(1);

    await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(200);
    expect(RateLimitModel.backstopState()).toEqual({ consecutiveFailures: 0, blockedUntil: 0 });
  });

  it('lets the owner back in once the delay has run out', async () => {
    for (let i = 0; i < BACKSTOP_FREE_ATTEMPTS + 1; i++) {
      await request(app).post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    }
    await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(429);

    RateLimitModel.setBlockedUntil(Date.now() - 1);
    await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(200);
  });

  it('treats a missing row as a failure, never as "not throttled"', () => {
    db.prepare('DELETE FROM auth_backstop').run();
    expect(() => RateLimitModel.backstopState()).toThrow(/cannot be read/);
    db.prepare('INSERT INTO auth_backstop (id, consecutive_failures, blocked_until) VALUES (1, 0, 0)').run();
  });
});

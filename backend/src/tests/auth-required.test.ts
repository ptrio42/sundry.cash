/**
 * AUTH_REQUIRED — the fail-closed flag.
 *
 * The opt-in default (no password, open API) is right for a laptop and
 * catastrophic for a public instance, so an operator can declare "this one is
 * reachable by strangers". These cases pin both halves: the declared instance
 * refuses to serve anything without a password, and an instance that has not
 * declared it behaves exactly as it did before this flag existed.
 *
 * See docs/hosted-security.md §3 finding 1.
 */

import request from 'supertest';
import app from '../server';
import { authConfigurationProblems, isAuthMisconfigured, secretSource } from '../config/auth';
import * as RateLimitModel from '../models/rateLimit';

const ORIGINAL = {
  password: process.env.APP_PASSWORD,
  secret: process.env.AUTH_SECRET,
  required: process.env.AUTH_REQUIRED,
};

function restore(key: 'APP_PASSWORD' | 'AUTH_SECRET' | 'AUTH_REQUIRED', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Start every case from an unthrottled instance.
 *
 * `POST /api/auth/login` is fronted by `loginBackstop`, which answers 429
 * *before* the handler that decides between 503, 401 and a token — and its
 * counters live in the database the whole run shares, with no sweep between
 * files. So a case here that asserts a status from that route is asserting
 * about whatever the previous file left behind unless it says otherwise. The
 * file that trips it also cleans up now, but this is what makes these cases
 * independent of the order Jest happens to pick.
 */
beforeEach(() => {
  RateLimitModel.resetAll();
  RateLimitModel.clearFailures();
});

afterEach(() => {
  restore('APP_PASSWORD', ORIGINAL.password);
  restore('AUTH_SECRET', ORIGINAL.secret);
  restore('AUTH_REQUIRED', ORIGINAL.required);
});

describe('AUTH_REQUIRED with no password', () => {
  beforeEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_SECRET;
    process.env.AUTH_REQUIRED = 'true';
  });

  // The finding in one case: this exact request used to return 200 and the
  // whole ledger, because requireAuth called next() when no password resolved.
  it('refuses an unauthenticated GET /api/expenses with 503', async () => {
    const res = await request(app).get('/api/expenses').expect(503);
    expect(res.body.error).toBe('Service Unavailable');
  });

  it('refuses every other guarded route the same way', async () => {
    await request(app).get('/api/budgets').expect(503);
    await request(app).get('/api/settings').expect(503);
    await request(app).get('/api/insights/summary').expect(503);
    await request(app).post('/api/expenses').send({ amount: 1 }).expect(503);
  });

  it('cannot be talked past with a token', async () => {
    // No password means no valid token can exist, but a stale one from before
    // the password was removed must not find an open door either.
    await request(app).get('/api/expenses').set('Authorization', 'Bearer anything').expect(503);
  });

  it('refuses to mint a token', async () => {
    await request(app).post('/api/auth/login').send({ password: 'anything' }).expect(503);
  });

  // The frontend reads `authRequired: false` as "no login needed, render the
  // app". A broken instance must not answer that.
  it('still reports authRequired = true', async () => {
    const res = await request(app).get('/api/auth/status').expect(200);
    expect(res.body.authRequired).toBe(true);
  });

  it('is fatal at boot', () => {
    expect(isAuthMisconfigured()).toBe(true);
    const { fatal } = authConfigurationProblems();
    // One complaint, not two: with no password there is nothing signing
    // anything, so "AUTH_SECRET is empty" would be noise on top of the real
    // problem rather than a second finding.
    expect(fatal).toHaveLength(1);
    expect(secretSource()).toBe('none');
    expect(fatal[0]).toContain('APP_PASSWORD');
  });
});

describe('AUTH_REQUIRED with a password', () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = 'hunter2';
    process.env.AUTH_SECRET = 'a'.repeat(64);
    process.env.AUTH_REQUIRED = 'true';
  });

  it('behaves like any password-protected instance', async () => {
    await request(app).get('/api/expenses').expect(401);
    expect(isAuthMisconfigured()).toBe(false);
    expect(authConfigurationProblems().fatal).toEqual([]);
  });

  // Change 6: the fallback keeps working on a laptop and is refused here,
  // because one captured token is an offline cracker for the password.
  it('refuses to boot when AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET;
    expect(secretSource()).toBe('APP_PASSWORD');
    const { fatal } = authConfigurationProblems();
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toContain('AUTH_SECRET');
    expect(fatal[0]).toContain('openssl rand -hex 32');
  });
});

describe('without AUTH_REQUIRED, nothing changes', () => {
  beforeEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_REQUIRED;
  });

  it('leaves the API open, as a self-hosted laptop install expects', async () => {
    await request(app).get('/api/expenses').expect(200);
    const res = await request(app).get('/api/auth/status').expect(200);
    expect(res.body.authRequired).toBe(false);
  });

  it('has nothing to complain about', () => {
    expect(isAuthMisconfigured()).toBe(false);
    expect(secretSource()).toBe('none');
    expect(authConfigurationProblems()).toEqual({ fatal: [], warnings: [] });
  });

  it('warns — but only warns — when a password is set without AUTH_SECRET', () => {
    process.env.APP_PASSWORD = 'hunter2';
    const { fatal, warnings } = authConfigurationProblems();
    expect(fatal).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('signed with APP_PASSWORD');
  });

  it('treats an empty AUTH_REQUIRED as unset, the way Compose writes it', async () => {
    // `AUTH_REQUIRED=${AUTH_REQUIRED:-}` renders an empty string, which must
    // mean "not configured" rather than crashing an open instance shut.
    process.env.AUTH_REQUIRED = '';
    await request(app).get('/api/expenses').expect(200);
  });
});

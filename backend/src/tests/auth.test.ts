/**
 * Tests for the single-user auth gate.
 * Toggles APP_PASSWORD around the suites and restores it afterward.
 */

import request from 'supertest';
import app from '../server';

const ORIGINAL = process.env.APP_PASSWORD;

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = ORIGINAL;
});

describe('Auth gate', () => {
  describe('when disabled (no APP_PASSWORD)', () => {
    beforeAll(() => {
      delete process.env.APP_PASSWORD;
    });

    it('reports authRequired = false', async () => {
      const res = await request(app).get('/api/auth/status').expect(200);
      expect(res.body.authRequired).toBe(false);
    });

    it('allows protected routes without a token', async () => {
      await request(app).get('/api/expenses').expect(200);
    });
  });

  describe('when enabled', () => {
    beforeAll(() => {
      process.env.APP_PASSWORD = 'hunter2';
    });
    afterAll(() => {
      delete process.env.APP_PASSWORD;
    });

    it('reports authRequired = true', async () => {
      const res = await request(app).get('/api/auth/status').expect(200);
      expect(res.body.authRequired).toBe(true);
    });

    it('blocks protected routes without a token', async () => {
      await request(app).get('/api/expenses').expect(401);
    });

    it('rejects a wrong password', async () => {
      await request(app).post('/api/auth/login').send({ password: 'nope' }).expect(401);
    });

    it('rejects a garbage token', async () => {
      await request(app).get('/api/expenses').set('Authorization', 'Bearer not.a.token').expect(401);
    });

    it('issues a token for the right password and accepts it', async () => {
      const login = await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(200);
      expect(typeof login.body.token).toBe('string');
      expect(login.body.token.length).toBeGreaterThan(10);

      await request(app)
        .get('/api/expenses')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200);
    });

    it('sets security headers and hides the framework', async () => {
      const res = await request(app).get('/api/auth/status').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    // Kept last on purpose: both counters live in this file's database, so
    // exhausting the budget here would make any later case in *this* file 429.
    // It no longer reaches beyond the file — see src/tests/db-per-file.ts.
    it('throttles repeated failed logins', async () => {
      const limit = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;
      let sawTooMany = false;

      // One failed attempt was already spent by the wrong-password test above.
      for (let i = 0; i < limit + 1; i++) {
        const res = await request(app).post('/api/auth/login').send({ password: 'wrong' });
        if (res.status === 429) { sawTooMany = true; break; }
      }
      expect(sawTooMany).toBe(true);

      // A correct password is refused too while the block is in force —
      // otherwise throttling would be trivially bypassable.
      await request(app).post('/api/auth/login').send({ password: 'hunter2' }).expect(429);
    });
  });
});

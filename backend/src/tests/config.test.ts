/**
 * Tests for the public instance configuration and the feature gate it reports.
 *
 * Both flags are read from the environment per request (config/instance.ts), so
 * these suites set and delete the variables around themselves. Jest runs with
 * --runInBand, meaning every test file shares one process — a leaked
 * RECEIPTS_ENABLED would 403 another file's receipt tests, so the originals are
 * restored in afterAll.
 */

import request from 'supertest';
import app from '../server';

const ORIGINAL = {
  demo: process.env.DEMO_MODE,
  receipts: process.env.RECEIPTS_ENABLED,
  password: process.env.APP_PASSWORD,
};

/** Put a variable back exactly as it was — unset is not the same as empty. */
function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  delete process.env.DEMO_MODE;
  delete process.env.RECEIPTS_ENABLED;
});

afterAll(() => {
  restore('DEMO_MODE', ORIGINAL.demo);
  restore('RECEIPTS_ENABLED', ORIGINAL.receipts);
  restore('APP_PASSWORD', ORIGINAL.password);
});

describe('GET /api/config', () => {
  it('defaults to a private instance with receipts on', async () => {
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body).toEqual({ demoMode: false, receiptsEnabled: true });
  });

  it('reports both flags when they are set', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.RECEIPTS_ENABLED = 'false';

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body).toEqual({ demoMode: true, receiptsEnabled: false });
  });

  it('keeps the flags orthogonal — demo mode does not disable receipts', async () => {
    process.env.DEMO_MODE = 'true';

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.receiptsEnabled).toBe(true);
  });

  it('falls back to the default for an unrecognised value', async () => {
    // Compose writes an empty string for an unset `${VAR:-}`; that means "not
    // configured", never "false".
    process.env.DEMO_MODE = '';
    process.env.RECEIPTS_ENABLED = 'flase';

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body).toEqual({ demoMode: false, receiptsEnabled: true });
  });

  it('is reachable without a token even when a password is set', async () => {
    process.env.APP_PASSWORD = 'hunter2';
    try {
      // The frontend has to render the right tabs on the login screen itself,
      // so this endpoint cannot sit behind the gate that screen exists to pass.
      await request(app).get('/api/expenses').expect(401);
      const res = await request(app).get('/api/config').expect(200);
      expect(res.body.receiptsEnabled).toBe(true);
    } finally {
      restore('APP_PASSWORD', ORIGINAL.password);
    }
  });

  /**
   * The point of this test is to fail when someone adds a field.
   *
   * The endpoint is unauthenticated, so anything that lands in this body is
   * public: a path, a row count or a version string would be an unauthenticated
   * leak, shipped by accident. Assert the exact shape and the exact types.
   */
  it('returns exactly two boolean fields and nothing else', async () => {
    const res = await request(app).get('/api/config').expect(200);

    expect(Object.keys(res.body).sort()).toEqual(['demoMode', 'receiptsEnabled']);
    for (const value of Object.values(res.body)) {
      expect(typeof value).toBe('boolean');
    }
  });
});

describe('Receipt gate (RECEIPTS_ENABLED)', () => {
  // The stub OCR provider is what NODE_ENV=test resolves to, so "enabled" can be
  // exercised for real: it decodes the uploaded bytes as text. Nothing is written
  // to disk by /scan — no expense is created until the user confirms.
  const scan = () =>
    request(app)
      .post('/api/receipts/scan')
      .attach('receipt', Buffer.from('Żabka\nSUMA PLN 12,30'), { filename: 'r.png', contentType: 'image/png' });

  it('refuses with 403 and says why when disabled', async () => {
    process.env.RECEIPTS_ENABLED = 'false';

    const res = await scan().expect(403);
    expect(res.body.error).toBe('Receipt scanning is disabled on this instance');
  });

  it('refuses saving an expense from a receipt too, not just scanning', async () => {
    process.env.RECEIPTS_ENABLED = 'false';

    // The gate is on the router mount, so it covers every method under it —
    // otherwise a disabled instance would still accept uploads through the save
    // endpoint, which is the one that writes an image to disk.
    await request(app)
      .post('/api/receipts')
      .field('amount', '12.30')
      .field('date', '2026-08-11')
      .field('description', 'Żabka')
      .field('category', 'groceries')
      .field('currency', 'PLN')
      .expect(403);

    await request(app).get('/api/receipts/receipt-000-deadbeef.png').expect(403);
  });

  it('works when the variable is unset', async () => {
    const res = await scan().expect(200);
    expect(res.body.amount).toBe(12.3);
  });

  it('works when it is explicitly on', async () => {
    process.env.RECEIPTS_ENABLED = 'true';

    await scan().expect(200);
  });
});

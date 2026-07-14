/**
 * Tests for the settings endpoints.
 * Runs against the shared dev DB, so the original settings are captured and
 * restored to avoid leaking test state.
 */

import request from 'supertest';
import app from '../server';
import { AppSettings } from '../types/expense.types';

let original: AppSettings;

beforeAll(async () => {
  const res = await request(app).get('/api/settings').expect(200);
  original = res.body;
});

afterAll(async () => {
  await request(app).put('/api/settings').send(original);
});

describe('GET /api/settings', () => {
  it('returns a complete, valid settings object', async () => {
    const res = await request(app).get('/api/settings').expect(200);
    expect(res.body).toHaveProperty('defaultCurrency');
    expect(res.body).toHaveProperty('defaultCategory');
    expect(res.body).toHaveProperty('defaultBtcUnit');
    expect(['USD', 'PLN', 'BTC']).toContain(res.body.defaultCurrency);
  });
});

describe('PUT /api/settings', () => {
  it('updates settings and persists them', async () => {
    const body = { defaultCurrency: 'PLN', defaultCategory: 'transport', defaultBtcUnit: 'sats', primaryCurrency: 'PLN' };
    const put = await request(app).put('/api/settings').send(body).expect(200);
    expect(put.body).toEqual(body);

    const get = await request(app).get('/api/settings').expect(200);
    expect(get.body.defaultCurrency).toBe('PLN');
    expect(get.body.defaultCategory).toBe('transport');
    expect(get.body.defaultBtcUnit).toBe('sats');
    expect(get.body.primaryCurrency).toBe('PLN');
  });

  it('supports partial updates', async () => {
    await request(app).put('/api/settings').send({ defaultCurrency: 'USD', defaultCategory: 'other', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' }).expect(200);
    const res = await request(app).put('/api/settings').send({ defaultCurrency: 'BTC' }).expect(200);
    expect(res.body.defaultCurrency).toBe('BTC');
    expect(res.body.defaultCategory).toBe('other'); // unchanged
    expect(res.body.defaultBtcUnit).toBe('BTC');     // unchanged
    expect(res.body.primaryCurrency).toBe('USD');    // unchanged
  });

  it('rejects invalid values with 400', async () => {
    const res = await request(app).put('/api/settings').send({ defaultCurrency: 'GBP' }).expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.length).toBeGreaterThan(0);

    await request(app).put('/api/settings').send({ defaultCategory: 'bogus' }).expect(400);
    await request(app).put('/api/settings').send({ defaultBtcUnit: 'gwei' }).expect(400);
    await request(app).put('/api/settings').send({ primaryCurrency: 'XYZ' }).expect(400);
  });
});

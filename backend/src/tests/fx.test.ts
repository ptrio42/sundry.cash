/**
 * Tests for the FX rates API.
 */

import request from 'supertest';
import app from '../server';

describe('FX API', () => {
  it('returns a USD base and default rates', async () => {
    const res = await request(app).get('/api/fx').expect(200);
    expect(res.body.base).toBe('USD');
    expect(res.body.rates.USD).toBe(1);
    expect(typeof res.body.rates.PLN).toBe('number');
    expect(typeof res.body.rates.BTC).toBe('number');
  });

  it('updates a rate via PUT', async () => {
    const res = await request(app).put('/api/fx').send({ currency: 'PLN', rate: 0.26 }).expect(200);
    expect(res.body.rates.PLN).toBeCloseTo(0.26);
  });

  it('rejects a non-positive rate', async () => {
    await request(app).put('/api/fx').send({ currency: 'PLN', rate: 0 }).expect(400);
  });

  it('rejects an unknown currency', async () => {
    await request(app).put('/api/fx').send({ currency: 'GBP', rate: 1.2 }).expect(400);
  });
});

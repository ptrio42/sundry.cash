/**
 * Tests for the budgets API.
 */

import request from 'supertest';
import app from '../server';

describe('Budgets API', () => {
  it('starts empty', async () => {
    const res = await request(app).get('/api/budgets').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('creates a budget via PUT', async () => {
    const res = await request(app)
      .put('/api/budgets')
      .send({ category: 'groceries', currency: 'USD', amount: 400 })
      .expect(200);
    expect(res.body).toMatchObject({ category: 'groceries', currency: 'USD', amount: 400 });
  });

  it('lists the created budget', async () => {
    const res = await request(app).get('/api/budgets').expect(200);
    const found = res.body.find((b: any) => b.category === 'groceries' && b.currency === 'USD');
    expect(found).toBeTruthy();
    expect(found.amount).toBe(400);
  });

  it('upserts (updates) an existing budget', async () => {
    await request(app)
      .put('/api/budgets')
      .send({ category: 'groceries', currency: 'USD', amount: 550 })
      .expect(200);
    const res = await request(app).get('/api/budgets').expect(200);
    const found = res.body.find((b: any) => b.category === 'groceries' && b.currency === 'USD');
    expect(found.amount).toBe(550);
    // still only one groceries/USD row
    expect(res.body.filter((b: any) => b.category === 'groceries' && b.currency === 'USD')).toHaveLength(1);
  });

  it('rejects an invalid category', async () => {
    await request(app)
      .put('/api/budgets')
      .send({ category: 'nope', currency: 'USD', amount: 100 })
      .expect(400);
  });

  it('rejects a non-positive amount', async () => {
    await request(app)
      .put('/api/budgets')
      .send({ category: 'transport', currency: 'USD', amount: -5 })
      .expect(400);
  });

  it('deletes a budget', async () => {
    await request(app).delete('/api/budgets/groceries?currency=USD').expect(204);
    const res = await request(app).get('/api/budgets').expect(200);
    expect(res.body.find((b: any) => b.category === 'groceries' && b.currency === 'USD')).toBeFalsy();
  });
});

/**
 * Tests for expense API endpoints
 * Uses supertest for HTTP assertions and ts-jest for TypeScript support
 */

import request from 'supertest';
import app from '../server';
import { CreateExpenseDTO } from '../types/expense.types';

describe('Expense API', () => {
  // Sample expense data for testing
  const sampleExpense: CreateExpenseDTO = {
    amount: 50.99,
    date: '2026-01-15',
    description: 'Grocery shopping',
    category: 'groceries',
    currency: 'USD'
  };

  let createdExpenseId: number;

  describe('POST /api/expenses', () => {
    it('should create a new expense with valid data', async () => {
      const response = await request(app)
        .post('/api/expenses')
        .send(sampleExpense)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.amount).toBe(sampleExpense.amount);
      expect(response.body.date).toBe(sampleExpense.date);
      expect(response.body.description).toBe(sampleExpense.description);
      expect(response.body.category).toBe(sampleExpense.category);

      createdExpenseId = response.body.id;
    });

    it('should reject expense with negative amount', async () => {
      const invalidExpense = {
        ...sampleExpense,
        amount: -10
      };

      const response = await request(app)
        .post('/api/expenses')
        .send(invalidExpense)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.details).toContain('Amount must be greater than 0');
    });

    it('should reject expense with invalid date', async () => {
      const invalidExpense = {
        ...sampleExpense,
        date: 'invalid-date'
      };

      const response = await request(app)
        .post('/api/expenses')
        .send(invalidExpense)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject expense with empty description', async () => {
      const invalidExpense = {
        ...sampleExpense,
        description: ''
      };

      const response = await request(app)
        .post('/api/expenses')
        .send(invalidExpense)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject expense with invalid category', async () => {
      const invalidExpense = {
        ...sampleExpense,
        category: 'invalid-category'
      };

      const response = await request(app)
        .post('/api/expenses')
        .send(invalidExpense)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/expenses', () => {
    it('should retrieve all expenses', async () => {
      const response = await request(app)
        .get('/api/expenses')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should filter expenses by category', async () => {
      const response = await request(app)
        .get('/api/expenses?category=groceries')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((expense: any) => {
        expect(expense.category).toBe('groceries');
      });
    });
  });

  describe('GET /api/expenses/:id', () => {
    it('should retrieve a single expense by id', async () => {
      const response = await request(app)
        .get(`/api/expenses/${createdExpenseId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.id).toBe(createdExpenseId);
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('category');
    });

    it('should return 404 for non-existent expense', async () => {
      const response = await request(app)
        .get('/api/expenses/999999')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/expenses/:id', () => {
    it('should update an existing expense', async () => {
      const updateData = {
        amount: 75.50,
        description: 'Updated grocery shopping'
      };

      const response = await request(app)
        .put(`/api/expenses/${createdExpenseId}`)
        .send(updateData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.id).toBe(createdExpenseId);
      expect(response.body.amount).toBe(updateData.amount);
      expect(response.body.description).toBe(updateData.description);
    });
  });

  describe('DELETE /api/expenses/:id', () => {
    it('should delete an expense', async () => {
      await request(app)
        .delete(`/api/expenses/${createdExpenseId}`)
        .expect(204);

      // Verify it's deleted
      await request(app)
        .get(`/api/expenses/${createdExpenseId}`)
        .expect(404);
    });
  });

  describe('GET /api/expenses/stats/by-category', () => {
    it('should retrieve category statistics', async () => {
      const response = await request(app)
        .get('/api/expenses/stats/by-category')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveProperty('category');
        expect(response.body[0]).toHaveProperty('total');
        expect(response.body[0]).toHaveProperty('count');
      }
    });
  });

  describe('GET /api/expenses/export', () => {
    it('returns an xlsx download (route is not shadowed by /:id)', async () => {
      const response = await request(app).get('/api/expenses/export').expect(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toContain('expenses.xlsx');
    });
  });

  describe('GET /api/expenses/stats/analytics', () => {
    /**
     * Regression: byCategory used to collapse the currency dimension, summing
     * major units across currencies — so 100 USD + 100 PLN in one category came
     * back as a single "200", which the UI then labelled "$". Aggregating
     * currencies is the client's decision (it needs an FX rate), so the API has
     * to keep them apart.
     */
    it('keeps byCategory rows scoped to one currency', async () => {
      const day = '2027-05-04';
      await request(app)
        .post('/api/expenses')
        .send({ amount: 100, date: day, description: 'USD groceries', category: 'groceries', currency: 'USD' })
        .expect(201);
      await request(app)
        .post('/api/expenses')
        .send({ amount: 100, date: day, description: 'PLN groceries', category: 'groceries', currency: 'PLN' })
        .expect(201);

      const response = await request(app)
        .get(`/api/expenses/stats/analytics?startDate=${day}&endDate=${day}`)
        .expect(200);

      const groceries = response.body.byCategory.filter((r: any) => r.category === 'groceries');
      expect(groceries).toHaveLength(2);

      const byCurrency = Object.fromEntries(groceries.map((r: any) => [r.currency, r.total]));
      expect(byCurrency.USD).toBeCloseTo(100, 2);
      expect(byCurrency.PLN).toBeCloseTo(100, 2);

      // No row may claim the combined 200.
      expect(groceries.some((r: any) => r.total > 150)).toBe(false);
    });

    it('scopes byCategory to the requested currency when one is given', async () => {
      const day = '2027-05-05';
      await request(app)
        .post('/api/expenses')
        .send({ amount: 70, date: day, description: 'USD transport', category: 'transport', currency: 'USD' })
        .expect(201);
      await request(app)
        .post('/api/expenses')
        .send({ amount: 900, date: day, description: 'PLN transport', category: 'transport', currency: 'PLN' })
        .expect(201);

      const response = await request(app)
        .get(`/api/expenses/stats/analytics?startDate=${day}&endDate=${day}&currency=USD`)
        .expect(200);

      const transport = response.body.byCategory.filter((r: any) => r.category === 'transport');
      expect(transport).toHaveLength(1);
      expect(transport[0].currency).toBe('USD');
      expect(transport[0].total).toBeCloseTo(70, 2);
    });
  });
});

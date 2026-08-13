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

  /**
   * The "who added it" label — docs/who-label-spec.md.
   *
   * A label, not a login: the API takes whatever the device says it is called
   * and stores it. Nothing here should read as authentication, because nothing
   * about it is.
   *
   * The names carry a `-QA` suffix so the `/people` assertions below stay true
   * whatever else the run has written — the whole suite shares one temp database
   * (see `src/tests/env.ts`), so these are the only rows that can be relied on.
   */
  describe('who', () => {
    const labelled = (who: unknown, overrides: Record<string, unknown> = {}) => ({
      amount: 12.5,
      date: '2027-06-01',
      description: 'Coffee',
      category: 'other',
      currency: 'USD',
      who,
      ...overrides
    });

    it('stamps the label on create and reads it back', async () => {
      const created = await request(app).post('/api/expenses').send(labelled('Ania-QA')).expect(201);
      expect(created.body.who).toBe('Ania-QA');

      const read = await request(app).get(`/api/expenses/${created.body.id}`).expect(200);
      expect(read.body.who).toBe('Ania-QA');
    });

    it('trims, collapses inner whitespace and caps at 24 characters, keeping the case typed', async () => {
      const created = await request(app)
        .post('/api/expenses')
        .send(labelled('   aNIA    z  Krakowa i okolic   '))
        .expect(201);

      // Collapsed and trimmed, then cut to 24 — and still spelled the way it
      // was typed, because people want to see "Ania" rather than "ania".
      expect(created.body.who).toBe('aNIA z Krakowa i okolic'.slice(0, 24));
      expect(created.body.who.length).toBeLessThanOrEqual(24);
    });

    /**
     * An expense created before the column existed still reads and edits.
     *
     * A row that never carried a label is exactly the shape of one written
     * before the migration ran: `who` is SQL NULL. The point of the assertion is
     * that it comes back as `null` rather than being absent — NULL is a value,
     * not a missing field — and that a PUT touching other fields works on it.
     */
    it('treats an unlabelled row as a value, not a missing field, and still edits it', async () => {
      const created = await request(app)
        .post('/api/expenses')
        .send(labelled(undefined, { description: 'Pre-column row' }))
        .expect(201);

      expect(created.body).toHaveProperty('who');
      expect(created.body.who).toBeNull();

      const updated = await request(app)
        .put(`/api/expenses/${created.body.id}`)
        .send({ description: 'Pre-column row, renamed' })
        .expect(200);

      expect(updated.body.description).toBe('Pre-column row, renamed');
      expect(updated.body.who).toBeNull();
    });

    it('lets an edit fix a typo, and clear the label entirely', async () => {
      const created = await request(app).post('/api/expenses').send(labelled('Alexander-QA')).expect(201);

      const fixed = await request(app)
        .put(`/api/expenses/${created.body.id}`)
        .send({ who: 'Alex-QA' })
        .expect(200);
      expect(fixed.body.who).toBe('Alex-QA');

      const cleared = await request(app)
        .put(`/api/expenses/${created.body.id}`)
        .send({ who: null })
        .expect(200);
      expect(cleared.body.who).toBeNull();
    });

    it('leaves the label alone when a PUT does not mention it', async () => {
      const created = await request(app).post('/api/expenses').send(labelled('Ania-QA')).expect(201);

      const updated = await request(app)
        .put(`/api/expenses/${created.body.id}`)
        .send({ amount: 20 })
        .expect(200);

      expect(updated.body.amount).toBe(20);
      expect(updated.body.who).toBe('Ania-QA');
    });

    it('rejects a label that is not a string', async () => {
      const response = await request(app).post('/api/expenses').send(labelled(42)).expect(400);
      expect(response.body.details).toContain('Who must be a string');
    });

    describe('GET /api/expenses/people', () => {
      it('answers with the names in the ledger, most-used first (route is not shadowed by /:id)', async () => {
        // Ania-QA already has more rows than Alex-QA from the tests above; add
        // one more of each spelling so the case-folding has something to merge.
        await request(app).post('/api/expenses').send(labelled('ania-qa')).expect(201);
        await request(app).post('/api/expenses').send(labelled('Alex-QA')).expect(201);

        const response = await request(app)
          .get('/api/expenses/people')
          .expect('Content-Type', /json/)
          .expect(200);

        const people: string[] = response.body.people;
        expect(Array.isArray(people)).toBe(true);

        // Deduplicated case-insensitively: one entry, spelled the way the
        // majority of the rows spell it.
        expect(people.filter(name => name.toLowerCase() === 'ania-qa')).toEqual(['Ania-QA']);

        // Ordered by how often each appears. Both are asserted present first, or
        // a missing name would pass the comparison on -1.
        expect(people).toContain('Ania-QA');
        expect(people).toContain('Alex-QA');
        expect(people.indexOf('Ania-QA')).toBeLessThan(people.indexOf('Alex-QA'));

        // Unlabelled rows contribute nothing.
        expect(people).not.toContain(null);
        expect(people.every(name => name.trim().length > 0)).toBe(true);
      });
    });
  });
});

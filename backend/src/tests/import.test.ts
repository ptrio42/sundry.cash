/**
 * Tests for Excel import endpoints
 */

import request from 'supertest';
import xlsx from 'xlsx';
import app from '../server';

describe('Import API Endpoints', () => {
  // Create a test Excel file
  const createTestExcelFile = (data: any[][]): Buffer => {
    const ws = xlsx.utils.aoa_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };

  describe('POST /api/import/preview', () => {
    it('should return preview of Excel file', async () => {
      const testData = [
        ['Date', 'Amount', 'Description', 'Category'],
        ['2024-01-15', 50.25, 'Grocery shopping', 'groceries'],
        ['2024-01-16', 30.00, 'Gas', 'transport'],
        ['2024-01-17', 15.99, 'Netflix', 'media'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/preview')
        .attach('file', buffer, 'test.xlsx')
        .expect(200);

      expect(response.body).toHaveProperty('columns');
      expect(response.body).toHaveProperty('preview');
      expect(response.body).toHaveProperty('totalRows');
      expect(response.body.columns).toEqual(['Date', 'Amount', 'Description', 'Category']);
      expect(response.body.totalRows).toBe(3);
      expect(response.body.preview).toHaveLength(3);
    });

    it('should return 400 if no file is uploaded', async () => {
      const response = await request(app)
        .post('/api/import/preview')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('No file uploaded');
    });

    it('should return 400 if Excel file is empty', async () => {
      const emptyData: any[][] = [];
      const buffer = createTestExcelFile(emptyData);

      const response = await request(app)
        .post('/api/import/preview')
        .attach('file', buffer, 'empty.xlsx')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Excel file is empty');
    });
  });

  describe('POST /api/import/confirm', () => {
    it('should successfully import valid expenses', async () => {
      const testData = [
        ['Date', 'Amount', 'Description', 'Category'],
        ['2024-01-15', 50.25, 'Grocery shopping', 'groceries'],
        ['2024-01-16', 30.00, 'Gas', 'transport'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'test.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('categoryColumn', '3')
        .field('currency', 'USD')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('results');
      expect(response.body.results.total).toBe(2);
      expect(response.body.results.success).toBe(2);
      expect(response.body.results.failed).toBe(0);
    });

    /**
     * The importing device's own label lands on every row. An import that
     * arrived unlabelled while everything else was labelled would make the
     * ledger's person filter useless — docs/who-label-spec.md.
     */
    it('stamps the who label on every imported row', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-03-01', 11.0, 'Imported one'],
        ['2024-03-02', 12.0, 'Imported two'],
      ];

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', createTestExcelFile(testData), 'test.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'USD')
        .field('who', '  Kasia-import  ')
        .expect(200);

      expect(response.body.results.success).toBe(2);

      const ledger = await request(app).get('/api/expenses').expect(200);
      const imported = ledger.body.filter((e: any) => e.description.startsWith('Imported '));
      expect(imported).toHaveLength(2);
      // Trimmed by the model, exactly as the typed and scanned paths are.
      imported.forEach((expense: any) => expect(expense.who).toBe('Kasia-import'));
    });

    it('should return 400 if required fields are missing', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-01-15', 50.25, 'Test'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'test.xlsx')
        .field('dateColumn', '0')
        // Missing amountColumn and descriptionColumn
        .field('currency', 'USD')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 if currency is invalid', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-01-15', 50.25, 'Test'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'test.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'INVALID')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid currency');
    });

    it('should handle invalid rows and report errors', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-01-15', 50.25, 'Valid expense'],
        ['invalid-date', 30.00, 'Invalid date'],
        ['2024-01-17', -10.00, 'Negative amount'],
        ['2024-01-18', 'abc', 'Invalid amount'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'test.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'PLN')
        .expect(200);

      expect(response.body.results.total).toBe(4);
      expect(response.body.results.success).toBe(1);
      expect(response.body.results.failed).toBe(3);
      expect(response.body.results.errors).toHaveLength(3);
    });

    it('should use default category if category column is not provided', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-01-15', 50.25, 'Test expense'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'test.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'USD')
        .expect(200);

      expect(response.body.results.success).toBe(1);
    });

    /**
     * Regression: amounts used to be parsed with `replace(/[^0-9.-]/g, '')`,
     * which deleted the decimal comma instead of interpreting it. Every
     * European-formatted cell was inflated 100x — "1 234,56" imported as
     * 123456.00. Numeric cells hid the bug, because they never hit that path.
     */
    it('should parse text amounts in both decimal conventions', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-02-01', '1 234,56', 'PL thousands space, decimal comma'],
        ['2024-02-02', '1.234,56', 'DE/PL thousands dot, decimal comma'],
        ['2024-02-03', '1,234.56', 'US thousands comma, decimal dot'],
        ['2024-02-04', '42,99 zł', 'currency suffix'],
        ['2024-02-05', '$1,000.00', 'currency prefix'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'formats.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'PLN')
        .expect(200);

      expect(response.body.results.success).toBe(5);
      expect(response.body.results.failed).toBe(0);

      const imported = await request(app)
        .get('/api/expenses?startDate=2024-02-01&endDate=2024-02-05&currency=PLN')
        .expect(200);

      const byDate = Object.fromEntries(
        imported.body.map((e: any) => [e.date, e.amount])
      );
      expect(byDate['2024-02-01']).toBeCloseTo(1234.56, 2);
      expect(byDate['2024-02-02']).toBeCloseTo(1234.56, 2);
      expect(byDate['2024-02-03']).toBeCloseTo(1234.56, 2);
      expect(byDate['2024-02-04']).toBeCloseTo(42.99, 2);
      expect(byDate['2024-02-05']).toBeCloseTo(1000, 2);
    });

    /**
     * The text heuristic reads a lone separator followed by exactly 3 digits as
     * a thousands group, so routing a genuine numeric 1.234 through it would
     * yield 1234. Numeric cells are already exact and must bypass it.
     */
    it('should take numeric cells at face value', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-03-01', 1.234, 'three decimal places'],
        ['2024-03-02', 1234, 'whole number'],
      ];

      const buffer = createTestExcelFile(testData);

      await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'numeric.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'USD')
        .expect(200);

      const imported = await request(app)
        .get('/api/expenses?startDate=2024-03-01&endDate=2024-03-02&currency=USD')
        .expect(200);

      const byDate = Object.fromEntries(
        imported.body.map((e: any) => [e.date, e.amount])
      );
      // Stored as integer minor units, so 1.234 rounds to the cent — but it must
      // stay near 1.23, not become 1234.
      expect(byDate['2024-03-01']).toBeCloseTo(1.23, 2);
      expect(byDate['2024-03-02']).toBeCloseTo(1234, 2);
    });

    it('should still reject negative and non-numeric amounts', async () => {
      const testData = [
        ['Date', 'Amount', 'Description'],
        ['2024-04-01', '-50,00', 'negative'],
        ['2024-04-02', 'abc', 'not a number'],
      ];

      const buffer = createTestExcelFile(testData);

      const response = await request(app)
        .post('/api/import/confirm')
        .attach('file', buffer, 'invalid.xlsx')
        .field('dateColumn', '0')
        .field('amountColumn', '1')
        .field('descriptionColumn', '2')
        .field('currency', 'USD')
        .expect(200);

      expect(response.body.results.success).toBe(0);
      expect(response.body.results.failed).toBe(2);
    });
  });
});

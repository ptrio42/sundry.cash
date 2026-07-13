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
  });
});

/**
 * API routes for expense management
 * All routes are prefixed with /api/expenses
 */

import { Router, Request, Response } from 'express';
import xlsx from 'xlsx';
import * as expenseModel from '../models/expense';
import { validateExpense, validateFilters } from '../middleware/validation';
import { ExpenseFilters } from '../types/expense.types';

const router = Router();

/**
 * GET /api/expenses
 * Get all expenses with optional filtering
 * Query params: category, startDate, endDate, currency
 */
router.get('/', validateFilters, (req: Request, res: Response) => {
  try {
    const filters: ExpenseFilters = {
      category: req.query.category as any,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      currency: req.query.currency as any
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof ExpenseFilters] === undefined) {
        delete filters[key as keyof ExpenseFilters];
      }
    });

    const expenses = expenseModel.getAll(Object.keys(filters).length > 0 ? filters : undefined);
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

/**
 * GET /api/expenses/export
 * Download all expenses as an .xlsx file.
 * Registered before /:id so "export" is not matched as an id.
 */
router.get('/export', (_req: Request, res: Response) => {
  try {
    const expenses = expenseModel.getAll();
    const rows = expenses.map(e => ({
      Date: e.date,
      Description: e.description,
      Category: e.category,
      Amount: e.amount,
      Currency: e.currency
    }));
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Expenses');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting expenses:', error);
    res.status(500).json({ error: 'Failed to export expenses' });
  }
});

/**
 * GET /api/expenses/:id
 * Get a single expense by ID
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid expense ID' });
      return;
    }

    const expense = expenseModel.getById(id);

    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    res.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

/**
 * POST /api/expenses
 * Create a new expense
 */
router.post('/', validateExpense, (req: Request, res: Response) => {
  try {
    const expenseData = {
      amount: req.body.amount,
      date: req.body.date,
      description: req.body.description,
      category: req.body.category,
      currency: req.body.currency
    };

    const newExpense = expenseModel.create(expenseData);
    res.status(201).json(newExpense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

/**
 * PUT /api/expenses/:id
 * Update an existing expense
 */
router.put('/:id', validateExpense, (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid expense ID' });
      return;
    }

    const updateData = {
      amount: req.body.amount,
      date: req.body.date,
      description: req.body.description,
      category: req.body.category,
      currency: req.body.currency
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key as keyof typeof updateData] === undefined) {
        delete updateData[key as keyof typeof updateData];
      }
    });

    const updatedExpense = expenseModel.update(id, updateData);

    if (!updatedExpense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    res.json(updatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

/**
 * DELETE /api/expenses/all
 * Delete all expenses (wipe database)
 * IMPORTANT: This route must come before /:id to avoid matching "all" as an ID
 */
router.delete('/all', (_req: Request, res: Response) => {
  try {
    const deletedCount = expenseModel.deleteAll();
    res.json({
      message: 'All expenses deleted successfully',
      deletedCount
    });
  } catch (error) {
    console.error('Error deleting all expenses:', error);
    res.status(500).json({ error: 'Failed to delete all expenses' });
  }
});

/**
 * DELETE /api/expenses/:id
 * Delete an expense
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid expense ID' });
      return;
    }

    const deleted = expenseModel.deleteExpense(id);

    if (!deleted) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

/**
 * GET /api/expenses/stats/by-category
 * Get expense statistics grouped by category
 */
router.get('/stats/by-category', (_req: Request, res: Response) => {
  try {
    const stats = expenseModel.getStatsByCategory();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({ error: 'Failed to fetch category statistics' });
  }
});

/**
 * GET /api/expenses/stats/by-date
 * Get expense statistics grouped by date
 */
router.get('/stats/by-date', (_req: Request, res: Response) => {
  try {
    const stats = expenseModel.getStatsByDate();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching date stats:', error);
    res.status(500).json({ error: 'Failed to fetch date statistics' });
  }
});

/**
 * GET /api/expenses/stats/analytics
 * Get analytics for time period and categories
 * Query params: startDate, endDate, categories (comma-separated), currency
 */
router.get('/stats/analytics', (req: Request, res: Response) => {
  try {
    const { startDate, endDate, categories, currency } = req.query;

    const params: {
      startDate?: string;
      endDate?: string;
      categories?: string[];
      currency?: string;
    } = {};

    if (startDate && typeof startDate === 'string') {
      params.startDate = startDate;
    }

    if (endDate && typeof endDate === 'string') {
      params.endDate = endDate;
    }

    if (categories && typeof categories === 'string') {
      params.categories = categories.split(',').filter(c => c.trim());
    }

    if (currency && typeof currency === 'string') {
      params.currency = currency;
    }

    const analytics = expenseModel.getAnalytics(params);
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;

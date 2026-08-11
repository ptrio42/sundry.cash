/**
 * Budget routes — /api/budgets
 *   GET    /                       list all budgets
 *   PUT    /                       create/update a budget { category, currency, amount }
 *   DELETE /:category?currency=USD  remove a budget
 */

import { Router, Request, Response } from 'express';
import * as BudgetModel from '../models/budget';
import * as CategoryModel from '../models/category';
import { ExpenseCategory, Currency } from '../types/expense.types';

const router = Router();

const VALID_CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(BudgetModel.getAll());
  } catch (error) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const { category, currency, amount } = req.body;
    const errors: string[] = [];

    if (!CategoryModel.exists(category)) errors.push('Category must be one of: ' + CategoryModel.allSlugs().join(', '));
    if (!VALID_CURRENCIES.includes(currency)) errors.push('Currency must be one of: ' + VALID_CURRENCIES.join(', '));
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) errors.push('Amount must be a positive number');

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(BudgetModel.upsert(category, currency, amount));
  } catch (error) {
    console.error('Error saving budget:', error);
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

router.delete('/:category', (req: Request, res: Response) => {
  try {
    const category = req.params.category as ExpenseCategory;
    const currency = req.query.currency as Currency;

    if (!CategoryModel.exists(category) || !VALID_CURRENCIES.includes(currency)) {
      res.status(400).json({ error: 'Invalid category or currency' });
      return;
    }

    const removed = BudgetModel.remove(category, currency);
    if (!removed) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

export default router;

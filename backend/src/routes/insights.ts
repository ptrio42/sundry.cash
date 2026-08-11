/**
 * Insight routes — /api/insights
 *   GET /comparison  spend per category for a period vs the one before it
 *   GET /recurring   repeating charges, with what each one costs per month
 *
 * Read-only: nothing here writes, so there is no POST/PUT counterpart.
 */

import { Router, Request, Response } from 'express';
import * as insightsModel from '../models/insights';
import { ComparisonWindow, ComparisonPeriod } from '../models/insights';
import { isValidDate } from '../middleware/validation';
import { Currency } from '../types/expense.types';

const router = Router();

const VALID_WINDOWS: ComparisonWindow[] = ['rolling', 'calendar'];
const VALID_PERIODS: ComparisonPeriod[] = ['week', 'month', 'year'];
const VALID_CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

/**
 * GET /api/insights/comparison
 * Query params: window (rolling|calendar), period (week|month|year), anchor (YYYY-MM-DD), currency
 *
 * `rolling` is the default deliberately: comparing a partial calendar month
 * against a complete previous one reports a collapse in spending on the 3rd.
 */
router.get('/comparison', (req: Request, res: Response) => {
  try {
    const { window, period, anchor, currency } = req.query;
    const errors: string[] = [];

    // A repeated query param arrives as an array, which fails these checks too.
    if (window !== undefined && !VALID_WINDOWS.includes(window as ComparisonWindow)) {
      errors.push(`Window must be one of: ${VALID_WINDOWS.join(', ')}`);
    }

    if (period !== undefined && !VALID_PERIODS.includes(period as ComparisonPeriod)) {
      errors.push(`Period must be one of: ${VALID_PERIODS.join(', ')}`);
    }

    // Years below 1000 are refused rather than answered wrongly: `Date.UTC` maps
    // years 0-99 onto 1900-1999, so window arithmetic there silently lands in the
    // 20th century. No ledger has entries that far back either.
    if (anchor !== undefined && (typeof anchor !== 'string' || !isValidDate(anchor) || anchor < '1000-01-01')) {
      errors.push('Anchor must be a valid ISO date (YYYY-MM-DD) from year 1000 onward');
    }

    if (currency !== undefined && !VALID_CURRENCIES.includes(currency as Currency)) {
      errors.push(`Currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(insightsModel.getComparison({
      window: window as ComparisonWindow | undefined,
      period: period as ComparisonPeriod | undefined,
      anchor: anchor as string | undefined,
      currency: currency as Currency | undefined
    }));
  } catch (error) {
    console.error('Error building comparison insight:', error);
    res.status(500).json({ error: 'Failed to build comparison' });
  }
});

/**
 * GET /api/insights/recurring
 * Query params: since (YYYY-MM-DD, defaults to 12 months back), minOccurrences (integer >= 2)
 */
router.get('/recurring', (req: Request, res: Response) => {
  try {
    const { since, minOccurrences } = req.query;
    const errors: string[] = [];

    if (since !== undefined && (typeof since !== 'string' || !isValidDate(since))) {
      errors.push('Since must be a valid ISO date (YYYY-MM-DD)');
    }

    // Two points define one gap, which is the least that can suggest a schedule.
    let occurrences: number | undefined;
    if (minOccurrences !== undefined) {
      occurrences = Number(minOccurrences);
      if (!Number.isInteger(occurrences) || occurrences < 2) {
        errors.push('minOccurrences must be an integer >= 2');
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json({
      recurring: insightsModel.getRecurring({
        since: since as string | undefined,
        minOccurrences: occurrences
      })
    });
  } catch (error) {
    console.error('Error building recurring insight:', error);
    res.status(500).json({ error: 'Failed to build recurring charges' });
  }
});

export default router;

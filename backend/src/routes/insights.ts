/**
 * Insight routes — /api/insights
 *   GET /comparison  spend per category for a period vs the one before it
 *   GET /recurring   repeating charges, with what each one costs per month
 *   GET /merchants   where the money goes, small frequent purchases included
 *   GET /patterns    when it goes — weekend against weekday, per day
 *   GET /summary     all four, scored against each other, top findings only
 *
 * Read-only: nothing here writes, so there is no POST/PUT counterpart.
 */

import { Router, Request, Response } from 'express';
import * as insightsModel from '../models/insights';
import { ComparisonWindow, ComparisonPeriod } from '../models/insights';
import { isValidDate } from '../middleware/validation';
import { Currency } from '../types/expense.types';
import * as CurrencyModel from '../models/currency';

const router = Router();

const VALID_WINDOWS: ComparisonWindow[] = ['rolling', 'calendar'];
const VALID_PERIODS: ComparisonPeriod[] = ['week', 'month', 'year'];

/**
 * `since` / `until`, shared by the two window reports below.
 *
 * The year floor is the same one `anchor` carries, for the same reason:
 * `getPatterns` divides by how many of each weekday the window holds, and
 * `Date.UTC` maps years 0-99 onto 1900-1999, so a two-digit year would be
 * counted against the wrong century. Applied to both endpoints so this router
 * does not end up with two different notions of a valid date.
 */
function windowErrors(since: unknown, until: unknown): string[] {
  const errors: string[] = [];

  const check = (value: unknown, name: string): void => {
    if (value === undefined) return;
    if (typeof value !== 'string' || !isValidDate(value) || value < '1000-01-01') {
      errors.push(`${name} must be a valid ISO date (YYYY-MM-DD) from year 1000 onward`);
    }
  };

  check(since, 'Since');
  check(until, 'Until');

  // ISO dates sort lexicographically, so this is a real chronological check —
  // but only once both are known to be well-formed.
  if (errors.length === 0 && typeof since === 'string' && typeof until === 'string' && since > until) {
    errors.push('Since must be before or equal to until');
  }

  return errors;
}

/**
 * `period` / `window`, shared by `/comparison` and `/summary`.
 *
 * Both answer over the same two-window comparison — `/summary` composes
 * `getComparison` and scores against the spend it reports — so they have to
 * accept exactly the same values. A summary that took a period the comparison
 * did not would rank findings over a window nothing else in the API could be
 * asked for.
 *
 * A repeated query param arrives as an array, which fails these checks too.
 */
function periodWindowErrors(period: unknown, window: unknown): string[] {
  const errors: string[] = [];

  if (window !== undefined && !VALID_WINDOWS.includes(window as ComparisonWindow)) {
    errors.push(`Window must be one of: ${VALID_WINDOWS.join(', ')}`);
  }

  if (period !== undefined && !VALID_PERIODS.includes(period as ComparisonPeriod)) {
    errors.push(`Period must be one of: ${VALID_PERIODS.join(', ')}`);
  }

  return errors;
}

/**
 * `exists`, not `isEnabled`: insights read history, and a disabled currency's
 * history is still there to be reported on.
 */
function currencyErrors(currency: unknown): string[] {
  if (currency === undefined || CurrencyModel.exists(currency)) return [];
  return [`Currency must be one of: ${CurrencyModel.getAll().map(c => c.code).join(', ')}`];
}

/**
 * Years below 1000 are refused rather than answered wrongly: `Date.UTC` maps
 * years 0-99 onto 1900-1999, so window arithmetic there silently lands in the
 * 20th century. No ledger has entries that far back either.
 */
function anchorErrors(anchor: unknown): string[] {
  if (anchor === undefined) return [];
  if (typeof anchor === 'string' && isValidDate(anchor) && anchor >= '1000-01-01') return [];
  return ['Anchor must be a valid ISO date (YYYY-MM-DD) from year 1000 onward'];
}

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
    const errors: string[] = [
      ...periodWindowErrors(period, window),
      ...anchorErrors(anchor),
      ...currencyErrors(currency)
    ];

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

/**
 * GET /api/insights/merchants
 * Query params: since, until (YYYY-MM-DD), currency, limit (1..100, default 20)
 *
 * Answers "twenty coffees at 15 zł is 300 zł a month" — spend that no category
 * total makes visible because every single charge looks trivial.
 */
router.get('/merchants', (req: Request, res: Response) => {
  try {
    const { since, until, currency, limit } = req.query;
    const errors: string[] = [...windowErrors(since, until), ...currencyErrors(currency)];

    // Clamping silently would answer a different question than the one asked,
    // so an out-of-range limit is refused rather than quietly reduced.
    let rowLimit: number | undefined;
    if (limit !== undefined) {
      rowLimit = Number(limit);
      if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > insightsModel.MAX_MERCHANT_LIMIT) {
        errors.push(`limit must be an integer between 1 and ${insightsModel.MAX_MERCHANT_LIMIT}`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(insightsModel.getMerchants({
      since: since as string | undefined,
      until: until as string | undefined,
      currency: currency as Currency | undefined,
      limit: rowLimit
    }));
  } catch (error) {
    console.error('Error building merchants insight:', error);
    res.status(500).json({ error: 'Failed to build merchant totals' });
  }
});

/**
 * GET /api/insights/patterns
 * Query params: since, until (YYYY-MM-DD), currency
 *
 * When the money goes out rather than what on. Every figure is per day, so a
 * week's 5:2 split of weekdays to weekend days cannot masquerade as a habit.
 */
router.get('/patterns', (req: Request, res: Response) => {
  try {
    const { since, until, currency } = req.query;
    const errors: string[] = [...windowErrors(since, until), ...currencyErrors(currency)];

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(insightsModel.getPatterns({
      since: since as string | undefined,
      until: until as string | undefined,
      currency: currency as Currency | undefined
    }));
  } catch (error) {
    console.error('Error building patterns insight:', error);
    res.status(500).json({ error: 'Failed to build spending patterns' });
  }
});

/**
 * GET /api/insights/summary
 * Query params: scope (primary|<code>), limit (1..10, default 3),
 *               anchor (YYYY-MM-DD), period (week|month|year), window (rolling|calendar)
 *
 * The only endpoint that ranks findings against each other, and therefore the
 * only one that has to know the currency scope: comparing a PLN finding with a
 * USD one means converting first, and the backend already owns both the rates
 * and the primary currency. `anchor` exists for the same reason it does on
 * /comparison — an "as of" answer that a test can pin down.
 *
 * `period` and `window` are the same pair /comparison takes, with the same
 * defaults, because Home's page-window control moves the spending sections and
 * the findings that head them together. The scoring is untouched; only the
 * window it scores over becomes a parameter.
 */
router.get('/summary', (req: Request, res: Response) => {
  try {
    const { scope, limit, anchor, period, window } = req.query;
    const errors: string[] = [...periodWindowErrors(period, window), ...anchorErrors(anchor)];

    // `exists` rather than `isEnabled`, like every other currency check here:
    // a summary of history recorded in a since-disabled currency is still a
    // summary someone can ask for.
    if (scope !== undefined && scope !== 'primary' && !CurrencyModel.exists(scope)) {
      errors.push(`Scope must be 'primary' or one of: ${CurrencyModel.getAll().map(c => c.code).join(', ')}`);
    }

    // Refused rather than clamped, as on /merchants: quietly answering a
    // different question than the one asked is worse than saying no.
    let rowLimit: number | undefined;
    if (limit !== undefined) {
      rowLimit = Number(limit);
      if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > insightsModel.MAX_SUMMARY_LIMIT) {
        errors.push(`limit must be an integer between 1 and ${insightsModel.MAX_SUMMARY_LIMIT}`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(insightsModel.getSummary({
      scope: scope as string | undefined,
      limit: rowLimit,
      anchor: anchor as string | undefined,
      period: period as ComparisonPeriod | undefined,
      window: window as ComparisonWindow | undefined
    }));
  } catch (error) {
    console.error('Error building insight summary:', error);
    res.status(500).json({ error: 'Failed to build summary' });
  }
});

export default router;

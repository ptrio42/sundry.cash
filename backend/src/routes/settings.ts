/**
 * Settings routes.
 *   GET /api/settings  -> current preferences (with defaults applied)
 *   PUT /api/settings  -> update one or more preferences
 */

import { Router, Request, Response } from 'express';
import { AppSettings, BtcUnit, Currency, ExpenseCategory } from '../types/expense.types';
import * as CategoryModel from '../models/category';
import * as CurrencyModel from '../models/currency';
import {
  getSettings,
  updateSettings,
  VALID_BTC_UNITS,
} from '../models/settings';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(getSettings());
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const { defaultCurrency, defaultCategory, defaultBtcUnit, primaryCurrency } = req.body ?? {};
    const errors: string[] = [];
    const partial: Partial<AppSettings> = {};

    if (defaultCurrency !== undefined) {
      if (!CurrencyModel.isEnabled(defaultCurrency)) errors.push(`defaultCurrency must be one of: ${CurrencyModel.enabledCodes().join(', ')}`);
      else partial.defaultCurrency = defaultCurrency as Currency;
    }
    if (defaultCategory !== undefined) {
      if (!CategoryModel.exists(defaultCategory)) errors.push(`defaultCategory must be one of: ${CategoryModel.allSlugs().join(', ')}`);
      else partial.defaultCategory = defaultCategory as ExpenseCategory;
    }
    if (defaultBtcUnit !== undefined) {
      if (!VALID_BTC_UNITS.includes(defaultBtcUnit)) errors.push(`defaultBtcUnit must be one of: ${VALID_BTC_UNITS.join(', ')}`);
      else partial.defaultBtcUnit = defaultBtcUnit as BtcUnit;
    }
    if (primaryCurrency !== undefined) {
      if (!CurrencyModel.isEnabled(primaryCurrency)) errors.push(`primaryCurrency must be one of: ${CurrencyModel.enabledCodes().join(', ')}`);
      else partial.primaryCurrency = primaryCurrency as Currency;
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(updateSettings(partial));
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;

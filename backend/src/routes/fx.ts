/**
 * FX routes — /api/fx
 *   GET /   -> { base: 'USD', rates: { USD, PLN, BTC } }
 *   PUT /   -> update one rate { currency, rate }
 */

import { Router, Request, Response } from 'express';
import * as FxModel from '../models/fx';
import { Currency } from '../types/expense.types';

const router = Router();
const VALID_CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ base: 'USD', rates: FxModel.getRates() });
  } catch (error) {
    console.error('Error fetching FX rates:', error);
    res.status(500).json({ error: 'Failed to fetch FX rates' });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const { currency, rate } = req.body;
    if (!VALID_CURRENCIES.includes(currency) || typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
      res.status(400).json({ error: 'A valid currency and a positive rate are required' });
      return;
    }
    FxModel.setRate(currency, rate);
    res.json({ base: 'USD', rates: FxModel.getRates() });
  } catch (error) {
    console.error('Error saving FX rate:', error);
    res.status(500).json({ error: 'Failed to save FX rate' });
  }
});

export default router;

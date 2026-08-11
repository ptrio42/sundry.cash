/**
 * FX routes — /api/fx
 *   GET /   -> { base: 'USD', rates: { USD, PLN, BTC } }
 *   PUT /   -> update one rate { currency, rate }
 */

import { Router, Request, Response } from 'express';
import * as FxModel from '../models/fx';
import * as CurrencyModel from '../models/currency';

const router = Router();

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
    // Not simply `isEnabled`: a rate is what converts *historical* amounts, so
    // a currency you have stopped using still needs one. Not simply `exists`
    // either — the catalogue carries every currency the app could ever offer,
    // and a rate for one you have neither enabled nor ever spent in converts
    // nothing.
    const relevant =
      CurrencyModel.exists(currency) &&
      (CurrencyModel.isEnabled(currency) || CurrencyModel.usage(currency).expenses > 0);

    if (!relevant || typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
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

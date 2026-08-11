/**
 * Currency routes — /api/currencies
 *   GET /                 the whole catalogue, enabled first
 *   PUT /:code            { enabled: boolean } — the only thing that can change
 *
 * There is no POST and no way to edit `minorUnits`, and that is the design, not
 * an omission. The exponent decides what every stored amount means, so a wrong
 * one silently reinterprets history instead of failing. Shipping the catalogue
 * (config/currencies.ts) and letting the user only switch entries on and off
 * makes the exponent right by construction. See
 * docs/categories-currencies-spec.md.
 */

import { Router, Request, Response } from 'express';
import * as CurrencyModel from '../models/currency';
import * as SettingsModel from '../models/settings';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(CurrencyModel.getAll());
  } catch (error) {
    console.error('Error fetching currencies:', error);
    res.status(500).json({ error: 'Failed to fetch currencies' });
  }
});

/**
 * PUT /api/currencies/:code  { enabled }
 *
 * Disabling is always allowed and never touches recorded expenses — it means
 * "stop offering this for new entries", not "hide the history". The one refusal
 * is disabling a currency the settings still point at, which would leave the
 * entry form defaulting to something it is not allowed to offer.
 */
router.put('/:code', (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const currency = CurrencyModel.getByCode(code);

    if (!currency) {
      res.status(404).json({ error: 'Currency not found' });
      return;
    }

    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Validation failed', details: ['enabled must be a boolean'] });
      return;
    }

    if (!enabled) {
      const settings = SettingsModel.getSettings();
      const usedBy: string[] = [];
      if (settings.defaultCurrency === code) usedBy.push('default currency');
      if (settings.primaryCurrency === code) usedBy.push('primary currency');

      if (usedBy.length > 0) {
        res.status(409).json({
          error: `${code} is still your ${usedBy.join(' and ')} — change that first`,
          usedBy,
        });
        return;
      }

      if (CurrencyModel.enabledCodes().length <= 1) {
        res.status(409).json({ error: 'At least one currency has to stay enabled' });
        return;
      }
    }

    res.json(CurrencyModel.setEnabled(code, enabled));
  } catch (error) {
    console.error('Error updating currency:', error);
    res.status(500).json({ error: 'Failed to update currency' });
  }
});

export default router;

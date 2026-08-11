/**
 * FX model — manual exchange rates for converting between currencies.
 * `rate` is the value of 1 unit of the currency in the USD base (USD = 1).
 * Rates are user-editable (this is an offline, self-hosted app — no live feed).
 */

import { db } from '../config/database';
import * as CurrencyModel from './currency';

/**
 * Every rate the UI needs to draw the conversion table.
 *
 * Enabled currencies always appear, at 0 when no rate has been set — a freshly
 * enabled EUR has none until the user types one. `utils/fx.convertAmount`
 * reads 0 as "cannot convert" and returns 0 rather than NaN or Infinity, so an
 * unset rate is visibly empty instead of quietly wrong.
 *
 * Stored rates for *disabled* currencies are included too: they are what
 * converts the history recorded in them, which disabling never removes.
 */
export function getRates(): Record<string, number> {
  const rates: Record<string, number> = {};

  for (const code of CurrencyModel.enabledCodes()) rates[code] = 0;

  const rows = db.prepare('SELECT currency, rate FROM fx_rates').all() as { currency: string; rate: number }[];
  for (const row of rows) rates[row.currency] = row.rate;

  // USD is the base by definition, whether or not it is enabled for new entries.
  rates.USD = 1;

  return rates;
}

export function setRate(currency: string, rate: number): void {
  db.prepare(
    `INSERT INTO fx_rates (currency, rate)
     VALUES (?, ?)
     ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate`
  ).run(currency, rate);
}

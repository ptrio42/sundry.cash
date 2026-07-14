/**
 * FX model — manual exchange rates for converting between currencies.
 * `rate` is the value of 1 unit of the currency in the USD base (USD = 1).
 * Rates are user-editable (this is an offline, self-hosted app — no live feed).
 */

import { db } from '../config/database';
import { Currency } from '../types/expense.types';

export function getRates(): Record<Currency, number> {
  const rows = db.prepare('SELECT currency, rate FROM fx_rates').all() as any[];
  const rates: Record<Currency, number> = { USD: 1, PLN: 0, BTC: 0 };
  for (const row of rows) rates[row.currency as Currency] = row.rate;
  return rates;
}

export function setRate(currency: Currency, rate: number): void {
  db.prepare(
    `INSERT INTO fx_rates (currency, rate)
     VALUES (?, ?)
     ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate`
  ).run(currency, rate);
}

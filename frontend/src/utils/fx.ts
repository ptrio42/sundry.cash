/**
 * FX conversion helper.
 *
 * Rates are the value of 1 unit of each currency in the USD base (USD = 1), so
 * converting `amount` from currency `from` to `to` is:
 *   amount * rates[from] / rates[to]
 * Returns 0 when a rate is missing/zero (avoids NaN/Infinity in the UI).
 */

import { Currency, FxRates } from '../types/expense.types';

export function convertAmount(amount: number, from: Currency, to: Currency, rates: FxRates): number {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return 0;
  return (amount * rf) / rt;
}

/**
 * Money helpers.
 *
 * Amounts are stored in the database as INTEGER *minor units* (cents for
 * USD/PLN, satoshis for BTC) so that sums are exact — floating-point `REAL`
 * columns accumulate binary rounding error (0.1 + 0.2 !== 0.3). The REST API
 * still speaks in *major units* (e.g. 50.99); conversion happens only at the
 * database boundary in the model layer.
 *
 * The per-currency exponent used to be a hardcoded three-key Record here. It is
 * a column on `currencies` now, read through a module-level cache in
 * `models/currency.ts` — the app is single-process and synchronous, so that is
 * enough. Nothing else about the contract changed.
 */

import { minorUnitsFor } from '../models/currency';
import { Currency } from '../types/expense.types';

/**
 * Minor units per major unit, or a thrown error for a currency the catalogue
 * does not have.
 *
 * Refusing is the whole point. Defaulting an unknown code to 100 would write a
 * number whose meaning nobody can recover later: the row would claim to be
 * cents and might be anything. A foreign key on `expenses.currency` makes this
 * unreachable through the API — this is the backstop for everything else.
 */
function unitsFor(currency: Currency): number {
  const units = minorUnitsFor(currency);
  if (units === undefined) {
    throw new Error(`Unknown currency "${currency}": no minor-unit exponent to store an amount with`);
  }
  return units;
}

/** Convert a major-unit amount (50.99) to integer minor units (5099). */
export function toMinorUnits(amount: number, currency: Currency): number {
  return Math.round(amount * unitsFor(currency));
}

/** Convert integer minor units (5099) back to a major-unit amount (50.99). */
export function toMajorUnits(minor: number, currency: Currency): number {
  return minor / unitsFor(currency);
}

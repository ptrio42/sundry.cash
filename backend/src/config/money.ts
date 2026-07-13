/**
 * Money helpers.
 *
 * Amounts are stored in the database as INTEGER *minor units* (cents for
 * USD/PLN, satoshis for BTC) so that sums are exact — floating-point `REAL`
 * columns accumulate binary rounding error (0.1 + 0.2 !== 0.3). The REST API
 * still speaks in *major units* (e.g. 50.99); conversion happens only at the
 * database boundary in the model layer.
 */

import { Currency } from '../types/expense.types';

// Smallest representable unit per currency.
export const MINOR_UNITS: Record<Currency, number> = {
  USD: 100,          // cents
  PLN: 100,          // grosze
  BTC: 100_000_000,  // satoshis
};

/** Convert a major-unit amount (50.99) to integer minor units (5099). */
export function toMinorUnits(amount: number, currency: Currency): number {
  return Math.round(amount * MINOR_UNITS[currency]);
}

/** Convert integer minor units (5099) back to a major-unit amount (50.99). */
export function toMajorUnits(minor: number, currency: Currency): number {
  return minor / MINOR_UNITS[currency];
}

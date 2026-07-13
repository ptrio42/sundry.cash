/**
 * Shared formatting helpers.
 *
 * Currency and date formatting used to be hand-rolled (string concatenation +
 * toFixed) and duplicated across every component, which rendered PLN as
 * "zł1234.56" instead of the correct "1234,56 zł". These use Intl so symbol
 * placement, decimal separator, and grouping are locale-correct.
 */

import { Currency } from '../types/expense.types';

export const SATS_PER_BTC = 100_000_000;

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  PLN: 'zł',
  BTC: '₿',
};

// Intl.NumberFormat picks symbol placement/separators from the locale, so pair
// each currency with an idiomatic one. BTC is not an ISO 4217 currency.
const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  USD: 'en-US',
  PLN: 'pl-PL',
  BTC: 'en-US',
};

/** Format a major-unit amount (e.g. 50.99) with locale-aware currency formatting. */
export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === 'BTC') {
    const n = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(amount);
    return `${CURRENCY_SYMBOLS.BTC}${n}`;
  }
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: 'currency',
    currency,
  }).format(amount);
}

/** Format an ISO `YYYY-MM-DD` string for display (parsed as UTC to avoid off-by-one). */
export function formatDate(iso: string, locale?: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

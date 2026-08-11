/**
 * Shared formatting helpers.
 *
 * Currency and date formatting used to be hand-rolled (string concatenation +
 * toFixed) and duplicated across every component, which rendered PLN as
 * "zł1234.56" instead of the correct "1234,56 zł". These use Intl so symbol
 * placement, decimal separator, and grouping are locale-correct.
 *
 * The symbol, locale and decimal count used to be three hardcoded maps here.
 * They are columns on the `currencies` table now, held in a module-level
 * registry that App refreshes when it loads the catalogue — the same shape as
 * the backend's `models/currency.ts` cache, and for the same reason: this is
 * called once per rendered amount, and threading the catalogue through every
 * call site would be a lot of noise for a value that changes about never.
 *
 * The registry starts populated with the currencies enabled out of the box, so
 * a first render (or a test) formats correctly before anything is fetched.
 */

import { Currency, CurrencyInfo } from '../types/expense.types';

export const SATS_PER_BTC = 100_000_000;

/** Matches the backend seed, so the pre-fetch render is not wrong, just narrow. */
const DEFAULT_REGISTRY: CurrencyInfo[] = [
  { code: 'USD', minorUnits: 100, symbol: '$', locale: 'en-US', isIso: true, enabled: true },
  { code: 'PLN', minorUnits: 100, symbol: 'zł', locale: 'pl-PL', isIso: true, enabled: true },
  { code: 'BTC', minorUnits: 100_000_000, symbol: '₿', locale: 'en-US', isIso: false, enabled: true },
];

let registry = new Map<string, CurrencyInfo>(DEFAULT_REGISTRY.map(c => [c.code, c]));

/** Point the formatter at the catalogue the backend actually holds. */
export function setCurrencyRegistry(currencies: CurrencyInfo[]): void {
  if (currencies.length === 0) return;
  registry = new Map(currencies.map(c => [c.code, c]));
}

/** What the formatter knows about `code`, or undefined for an unknown one. */
export function currencyInfo(code: Currency): CurrencyInfo | undefined {
  return registry.get(code);
}

/** The symbol for `code`, falling back to the code itself. */
export function currencySymbol(code: Currency): string {
  return registry.get(code)?.symbol ?? code;
}

/** Decimal places implied by the minor-unit exponent: 100 -> 2, 1 -> 0. */
function decimalsFor(info: CurrencyInfo): number {
  return Math.max(0, Math.round(Math.log10(info.minorUnits)));
}

/**
 * Format a major-unit amount (e.g. 50.99) with locale-aware currency formatting.
 *
 * Two paths, chosen by `isIso` rather than by a hardcoded currency check:
 * Intl accepts any well-formed three-letter code, so `style: 'currency'` with
 * 'BTC' does not throw — it renders "BTC 1.00", which is why the flag has to
 * come from the catalogue.
 *
 * The decimal count comes from `minorUnits`, the same number the backend stores
 * with. That is deliberate: it means the display can never imply more precision
 * than the column holds, and JPY shows ¥1,500 rather than ¥1,500.00.
 */
export function formatCurrency(amount: number, currency: Currency): string {
  const info = registry.get(currency);

  // Unknown code: show the number and the code, rather than guessing at a
  // symbol or silently formatting it as something else.
  if (!info) {
    return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`;
  }

  const decimals = decimalsFor(info);

  if (!info.isIso) {
    // Non-ISO (BTC): Intl has no symbol for it, so prefix ours. Keeps the
    // long-standing "at least 2, at most 8" rendering for satoshi amounts.
    const n = new Intl.NumberFormat(info.locale ?? undefined, {
      minimumFractionDigits: Math.min(2, decimals),
      maximumFractionDigits: decimals,
    }).format(amount);
    return `${info.symbol}${n}`;
  }

  return new Intl.NumberFormat(info.locale ?? undefined, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/** The month we are in, as `YYYY-MM` — the key Budgets filters and sums by. */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * A `YYYY-MM` key as a reader sees it ("August 2026").
 *
 * Shared because two screens print the same month for the same reason: Budgets
 * labels the spend it is comparing against a limit, and the shell's status line
 * states the window that screen is showing. One month, one spelling.
 */
export function monthLabel(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  if (isNaN(d.getTime())) return monthKey;
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
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

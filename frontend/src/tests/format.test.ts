/**
 * Tests for utils/format.ts.
 *
 * The symbol, locale and decimal count used to be hardcoded maps here; they
 * come from the currency catalogue now. What is worth pinning is that the
 * decimal count follows the *minor-unit exponent* — the same number the
 * backend stores with — so the display can never imply more precision than the
 * column holds.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { formatCurrency, currencySymbol, currencyInfo, setCurrencyRegistry, formatDate, monthLabel } from '../utils/format';
import { TEST_CURRENCIES } from './currencies.fixture';

// The registry is module-level state; put the shipped defaults back after any
// test that repoints it.
const DEFAULTS = [
  { code: 'USD', minorUnits: 100, symbol: '$', locale: 'en-US', isIso: true, enabled: true },
  { code: 'PLN', minorUnits: 100, symbol: 'zł', locale: 'pl-PL', isIso: true, enabled: true },
  { code: 'BTC', minorUnits: 100_000_000, symbol: '₿', locale: 'en-US', isIso: false, enabled: true },
];
afterEach(() => setCurrencyRegistry(DEFAULTS));

describe('formatCurrency', () => {
  it('formats the currencies enabled out of the box, without any setup', () => {
    expect(formatCurrency(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatCurrency(1234.5, 'PLN')).toMatch(/1\s*234,50\s*zł/);
  });

  it('prefixes the symbol for BTC rather than letting Intl render "BTC"', () => {
    // Intl accepts any well-formed three-letter code, so style:'currency' with
    // BTC yields "BTC 0.50" — the isIso flag is what avoids that.
    const formatted = formatCurrency(0.5, 'BTC');
    expect(formatted).toBe('₿0.50');
    expect(formatted).not.toContain('BTC');
  });

  it('keeps satoshi precision for small BTC amounts', () => {
    expect(formatCurrency(0.00012345, 'BTC')).toBe('₿0.00012345');
  });

  it('takes the decimal count from the minor-unit exponent', () => {
    setCurrencyRegistry(TEST_CURRENCIES);

    // JPY has no minor unit at all: 1500 yen, not 1500.00.
    const jpy = formatCurrency(1500, 'JPY');
    expect(jpy).toContain('1,500');
    expect(jpy).not.toContain('1,500.00');
  });

  it('formats a currency that is disabled but still in the catalogue', () => {
    // Disabling stops it being offered for new entries; the history recorded
    // in it still has to render.
    setCurrencyRegistry(TEST_CURRENCIES);
    expect(formatCurrency(99.5, 'EUR')).toMatch(/99,50\s*€/);
  });

  it('shows the number and the code for a currency it has never heard of', () => {
    // Better than guessing a symbol or silently formatting it as something else.
    expect(formatCurrency(12.3, 'ZZZ')).toBe('12.30 ZZZ');
  });
});

describe('the registry', () => {
  it('reports what it knows about a code', () => {
    setCurrencyRegistry(TEST_CURRENCIES);
    expect(currencyInfo('JPY')).toMatchObject({ minorUnits: 1, symbol: '¥' });
    expect(currencyInfo('ZZZ')).toBeUndefined();
  });

  it('falls back to the code itself for an unknown symbol', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('ZZZ')).toBe('ZZZ');
  });

  it('ignores an empty catalogue rather than blanking every amount', () => {
    // A failed fetch must not leave the app unable to format anything.
    setCurrencyRegistry([]);
    expect(formatCurrency(10, 'USD')).toBe('$10.00');
  });
});

/**
 * Dates (F19).
 *
 * These are the only cases that can prove the fix. `Intl` resolves `undefined`
 * to the host OS, and CI happens to run an English one — so every assertion
 * elsewhere in the suite passed both before and after. The third case here is
 * the load-bearing one: a locale the code decides is one another locale cannot
 * override by accident, and it is what an explicit argument still can.
 */
describe('dates', () => {
  it('renders a day in the interface language, not the operating system\'s', () => {
    expect(formatDate('2026-08-11')).toBe('11 Aug 2026');
  });

  it('renders a month heading the same way', () => {
    // The largest instance of F19: since wave 3c this string is a heading on
    // Budgets, so a Polish host printed "sierpień 2026" above an English page.
    expect(monthLabel('2026-08')).toBe('August 2026');
  });

  it('takes an explicit locale over the fixed one, which is the PL/EN seam', () => {
    expect(formatDate('2026-08-11', 'pl-PL')).toBe('11 sie 2026');
    expect(formatDate('2026-08-11', 'en-US')).toBe('Aug 11, 2026');
  });

  it('reads a date as a calendar day, not an instant', () => {
    // Parsed at UTC midnight on purpose: a local-time parse west of Greenwich
    // renders the 1st of a month as the last day of the previous one.
    expect(formatDate('2026-08-01')).toBe('1 Aug 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
  });

  it('hands back anything it cannot parse rather than printing "Invalid Date"', () => {
    expect(formatDate('nope')).toBe('nope');
    expect(monthLabel('garbage')).toBe('garbage');
  });
});

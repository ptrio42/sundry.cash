/**
 * The currency catalogue components are given in tests.
 *
 * The three the backend enables out of the box, plus two disabled entries that
 * make the interesting cases testable: EUR (a normal ISO currency the user has
 * not switched on) and JPY (which has no minor unit at all, so it catches
 * anything that assumes two decimal places).
 */

import { CurrencyInfo } from '../types/expense.types';

export const TEST_CURRENCIES: CurrencyInfo[] = [
  { code: 'BTC', minorUnits: 100_000_000, symbol: '₿', locale: 'en-US', isIso: false, enabled: true },
  { code: 'PLN', minorUnits: 100, symbol: 'zł', locale: 'pl-PL', isIso: true, enabled: true },
  { code: 'USD', minorUnits: 100, symbol: '$', locale: 'en-US', isIso: true, enabled: true },
  { code: 'EUR', minorUnits: 100, symbol: '€', locale: 'de-DE', isIso: true, enabled: false },
  { code: 'JPY', minorUnits: 1, symbol: '¥', locale: 'ja-JP', isIso: true, enabled: false },
];

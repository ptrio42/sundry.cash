/**
 * Choosing which currencies a control should offer.
 *
 * There are two different questions, and getting them mixed up is the bug this
 * file exists to prevent:
 *
 *   - "What can I record a *new* expense in?" — the enabled ones.
 *   - "What might the numbers on this screen already be in?" — the enabled
 *     ones plus anything the data actually uses. Disabling a currency means
 *     "stop offering it", never "hide the history", so a filter, a rate row or
 *     a report that dropped it would make old expenses unreachable.
 */

import { CurrencyInfo } from '../types/expense.types';

/** Currencies that may be used for a new entry, in catalogue order. */
export function offeredCurrencies(currencies: CurrencyInfo[]): CurrencyInfo[] {
  return currencies.filter(currency => currency.enabled);
}

/**
 * Currencies worth showing on a screen that displays existing data: everything
 * enabled, plus every code in `inUse` — including ones the catalogue has since
 * been switched off, and ones it does not know at all (which stay visible as a
 * bare code rather than vanishing).
 */
export function relevantCurrencies(currencies: CurrencyInfo[], inUse: Iterable<string>): CurrencyInfo[] {
  const used = new Set(inUse);
  const known = new Set(currencies.map(currency => currency.code));

  const unknown = Array.from(used)
    .filter(code => !known.has(code))
    .sort()
    .map(code => ({ code, minorUnits: 100, symbol: code, locale: null, isIso: false, enabled: false }));

  return [...currencies.filter(currency => currency.enabled || used.has(currency.code)), ...unknown];
}

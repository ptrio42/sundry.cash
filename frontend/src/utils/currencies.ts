/**
 * Choosing which currencies a control should offer.
 *
 * There are three different questions, and getting them mixed up is the bug this
 * file exists to prevent:
 *
 *   - "What can I record a *new* expense in?" — the enabled ones.
 *   - "What might the numbers on this screen already be in?" — the enabled
 *     ones plus anything the data actually uses. Disabling a currency means
 *     "stop offering it", never "hide the history", so a filter, a rate row or
 *     a report that dropped it would make old expenses unreachable.
 *   - "What can this report be *scoped* to?" — only what the report has numbers
 *     in. This is the narrowest of the three and the one F9 in
 *     `docs/ux-review-findings.md` was about: Analytics offered a currency the
 *     ledger had never seen, so one of its buttons was a guaranteed blank screen.
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

/**
 * Currencies a report's scope control should offer: the ones its own numbers are
 * actually in, in catalogue order, and nothing else.
 *
 * The single option set the report asks for (change 14) — one rule rather than
 * one literal list, because what a screen's numbers are in differs by screen.
 * Home passes the ledger's currencies; a screen holding standing limits passes
 * those too, since a limit can exist in a currency nothing has been spent in
 * yet. What no scope control may offer is a currency that is merely *enabled*:
 * `relevantCurrencies` includes those on purpose, because a filter or a rate row
 * needs them, but as a scope button it is a guaranteed empty screen.
 */
export function scopeCurrencies(currencies: CurrencyInfo[], inUse: Iterable<string>): CurrencyInfo[] {
  const used = new Set(inUse);
  return relevantCurrencies(currencies, used).filter(currency => used.has(currency.code));
}

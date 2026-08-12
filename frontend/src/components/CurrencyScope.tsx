/**
 * CurrencyScope
 *
 * The one currency-scope control. Four screens grew their own and no two agreed
 * (F9 in `docs/ux-review-findings.md`): Dashboard and Insights offered
 * "All → primary" plus the currencies the ledger actually used, Analytics
 * offered "All Currencies" plus everything merely *relevant* — a set that
 * included currencies the ledger had never seen, so one of its buttons was a
 * guaranteed blank screen — and Budgets offered no combined option at all.
 *
 * **Change 14 is closed as of wave 4, and this comment is the record of it.**
 * Three screens have a scope now — Home, Expenses, Budgets — and all three ask
 * `scopeCurrencies` (`utils/currencies.ts`) for the option set: the currencies
 * that screen's own numbers are in, and nothing else. All three also hide the
 * control when there is no choice to make. Wave 4 verified both on the demo
 * install (three currencies) and the empty one, and changed nothing here.
 *
 * Two things that look like leftovers and are not:
 *
 * - **The visibility test lives at the call sites, not here.** It is not the
 *   same test on each: Home and Budgets ask "more than one currency present?",
 *   while Expenses also keeps the control up when a scope is *in force* over a
 *   ledger that no longer holds it, so the pressed button can be unpressed.
 *   Folding a length check into this component would delete that case.
 * - **The combined option's value differs by screen** — `'primary'` on Home and
 *   Budgets, `'all'` on Expenses. Both render "All → <primary>". `'all'` is a
 *   value inside `LedgerQuery.currency`, read by `filterExpenses`, `EMPTY_QUERY`
 *   and `isEmptyQuery`; unifying the two would be a query-object migration for
 *   no visible difference.
 *
 * This renders the control. The plumbing underneath stays per screen: Home
 * refetches its findings when the scope changes, because ranking a PLN finding
 * against a USD one has to convert before it scores; its four data endpoints and
 * both other screens scope client-side, because nothing there is ranked across
 * currencies. Same control, same markup, different mechanics.
 */

import { CurrencyInfo } from '../types/expense.types';

interface CurrencyScopeProps<Scope extends string> {
  /** The currencies to offer, in the order they should appear. */
  currencies: CurrencyInfo[];
  /** The scope in force: a currency code, or `combined.value` where one is offered. */
  value: Scope;
  onChange: (scope: Scope) => void;
  /**
   * The "everything at once" option, or omitted on screens that have none.
   * Both its label and its value differ per screen today — "All → PLN" carrying
   * `'primary'` on the Dashboard, "All Currencies" carrying `'all'` on
   * Analytics — so the caller supplies both.
   */
  combined?: { value: Scope; label: string; title?: string };
}

export default function CurrencyScope<Scope extends string>({
  currencies,
  value,
  onChange,
  combined
}: CurrencyScopeProps<Scope>) {
  return (
    <div className="currency-buttons">
      {combined && (
        <button
          className={value === combined.value ? 'active' : ''}
          onClick={() => onChange(combined.value)}
          title={combined.title}
        >
          {combined.label}
        </button>
      )}
      {currencies.map(currency => (
        <button
          key={currency.code}
          className={value === currency.code ? 'active' : ''}
          onClick={() => onChange(currency.code as Scope)}
        >
          {currency.code} ({currency.symbol})
        </button>
      ))}
    </div>
  );
}

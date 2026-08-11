/**
 * CurrencyScope
 *
 * The one currency-scope control. Four screens grew their own and no two agree
 * (F9 in `docs/ux-review-findings.md`): Dashboard and Insights offer
 * "All → primary" plus the currencies the ledger actually uses, Analytics
 * offers "All Currencies" plus everything relevant, Budgets offers no combined
 * option at all.
 *
 * This renders the control. It deliberately does **not** choose the option set:
 * the caller passes the currencies to offer, because those sets are still
 * different and unifying them belongs to the wave that owns each screen. What
 * is shared today is the markup, the active state and the emitted value — which
 * is the point, since three of these screens are about to be rebuilt and should
 * be rebuilt against one implementation rather than against four.
 *
 * The plumbing underneath stays as it is. The Dashboard strip refetches when the
 * scope changes because ranking a PLN finding against a USD one has to convert
 * before it scores; the Insights tab scopes client-side because it only displays
 * per-currency lists. Same control, same markup, different mechanics.
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

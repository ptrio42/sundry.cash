/**
 * Budgets — the screen that states a verdict.
 *
 * It used to answer "did I blow anything?" with ten cards, six of which had no
 * limit and still occupied full height around an empty box, and when nothing was
 * over **no element on the screen said so** (F4 in `docs/ux-review-findings.md`):
 * the user did the work and received an absence. This is that rebuild — changes
 * 6, 7, 8, 9 and 14 — and the order below is the answer first, the evidence
 * after:
 *
 *   1. the month, with a stepper;
 *   2. the verdict — "2 over · 1 close · 5 on track" — with the exceptions listed
 *      and the on-track ones collapsed to a count;
 *   3. pace, because nothing in the product said whether 43% on day 11 is good;
 *   4. the cumulative chart, as before;
 *   5. the category list, **read-only**, with the limitless ones collapsed;
 *   6. the currency scope, which now offers "All → primary".
 *
 * **Reading and configuring are no longer the same widget** (F11, change 9). The
 * limit was an input that saved on blur, and a blank, NaN or ≤ 0 value meant
 * *delete this budget* — no confirmation, no undo. Clicking into a figure to read
 * it closely was one stray keystroke from silently removing it. The list is now
 * text until **Edit limits** is pressed, so the destructive control is not the
 * thing you click in order to read.
 *
 * **A past month is compared against today's limits, and the screen says so.**
 * Budgets have no month dimension — `/api/budgets` is a flat set of standing
 * `{category, currency, amount}` rows — so the stepper moves the *spending*
 * window and nothing else. That inaccuracy did not exist while past months were
 * simply unreachable; it is the price of the feature, and printing the caveat is
 * what makes the price fair.
 *
 * **Combined scope is read-only.** A limit is held in one currency, so "All →
 * primary" can compare but cannot write: converting an edit back would silently
 * rewrite a limit at today's rate. The screen says which currency to pick
 * instead of failing on save.
 *
 * The verdict itself comes from `budgetVerdict` in `utils/home.ts` — the same
 * function Home's budget section calls. Two screens making the same claim about
 * the same limits must not be able to disagree about it.
 */

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { BudgetsProps, Budget, Currency, ExpenseCategory } from '../types/expense.types';
import { getBudgets, setBudget as apiSetBudget, deleteBudget as apiDeleteBudget } from '../services/api';
import { formatCurrency, currencySymbol, monthLabel } from '../utils/format';
import { categoryLabel } from '../utils/categories';
import { scopeCurrencies } from '../utils/currencies';
import { budgetVerdict, todayISO } from '../utils/home';
import { Scope, displayCurrency } from '../utils/insights';
import {
  PACE_LABEL,
  canStepForward,
  cumulativeByDay,
  daysInMonth,
  elapsedInMonth,
  isPastMonth,
  limitsByCategory,
  monthOf,
  paceOf,
  spendByCategory,
  statusByCategory,
  stepMonth,
  verdictSentence
} from '../utils/budgets';
import CurrencyScope from './CurrencyScope';

export default function Budgets({ expenses, settings, categories, currencies, rates }: BudgetsProps) {
  const primary = settings.primaryCurrency;

  // Fixed for the life of the mount, as on Home: "today" moving mid-session
  // would shift the pace line under a reader who did not touch anything.
  const today = useMemo(() => todayISO(), []);

  const [month, setMonth] = useState<string>(() => monthOf(today));
  /**
   * Opens combined, and collapses to the single currency when there is only one.
   *
   * The old screen opened on `settings.defaultCurrency` because a hardcoded USD
   * greeted a PLN-only ledger with "Budgeted $0.00 / no limits" — and that case
   * is now handled by the collapse below, which shows the one currency present
   * without offering a choice nobody has. What the default fixes instead is the
   * other half of F9: a single-currency screen presented "BUDGETED 3250,00 zł"
   * as *the* budget when it was one slice of it, so a user could read an
   * all-clear that covered one currency out of four.
   */
  const [chosenView, setChosenView] = useState<Currency | 'primary'>('primary');
  const [editRequested, setEditRequested] = useState<boolean>(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setBudgets(await getBudgets());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /**
   * The currencies this screen has numbers in — spending *and* standing limits.
   *
   * A limit can exist in a currency nothing has been spent in yet, and dropping
   * it from the option set would hide the only place it can be edited. This is
   * the case `scopeCurrencies` was written for (change 14).
   */
  const presentCurrencies = useMemo(
    () => Array.from(new Set([...expenses.map(e => e.currency), ...budgets.map(b => b.currency)])),
    [expenses, budgets]
  );

  const view: Currency | 'primary' = presentCurrencies.length === 1 ? presentCurrencies[0] : chosenView;
  const combined = view === 'primary';
  const scope = useMemo<Scope>(() => ({ view, primary, rates }), [view, primary, rates]);
  const display = displayCurrency(scope);
  const fmt = (value: number) => formatCurrency(value, display);

  // Combined cannot be edited, so a scope switch also closes the editor rather
  // than leaving a toggle pressed against a list with no inputs in it.
  const editing = editRequested && !combined;

  const spent = useMemo(() => spendByCategory(expenses, month, scope), [expenses, month, scope]);
  const limits = useMemo(() => limitsByCategory(budgets, scope), [budgets, scope]);
  const verdict = useMemo(
    () => budgetVerdict({ budgets, spent, months: 1, scope }),
    [budgets, spent, scope]
  );
  const status = useMemo(() => statusByCategory(verdict), [verdict]);
  const days = daysInMonth(month);
  const elapsed = elapsedInMonth(month, today);
  const series = useMemo(
    () => cumulativeByDay(expenses, month, scope, elapsed),
    [expenses, month, scope, elapsed]
  );

  const past = isPastMonth(month, today);
  const elapsedShare = days === 0 ? 0 : elapsed / days;

  /**
   * Spend measured against limits, not against everything.
   *
   * The old "Remaining" card divided *all* spending in the currency by the sum
   * of the limits, so a category nobody had limited could push the figure past
   * 100% and report an overspend against a budget it was never part of. What the
   * pace line answers is "how much of what I limited have I used", and the line
   * says so — with the count of limits it covers, since that is the other half
   * of the question.
   */
  const allowance = Array.from(limits.values()).reduce((sum, value) => sum + value, 0);
  const spentOnLimits = Array.from(limits.keys()).reduce((sum, category) => sum + (spent.get(category) ?? 0), 0);
  const usedShare = allowance === 0 ? 0 : spentOnLimits / allowance;
  const pace = paceOf(usedShare, elapsedShare);

  const monthSpend = Array.from(spent.values()).reduce((sum, value) => sum + value, 0);

  const label = (slug: string): string => categoryLabel(categories, slug);

  const changeScope = (next: Currency | 'primary') => {
    setChosenView(next);
    // A draft is a figure typed in the previous currency; carrying it across
    // would offer to save 250 PLN as 250 USD.
    setDrafts({});
    if (next === 'primary') setEditRequested(false);
  };

  /** The row as it is stored, in its own currency — never the converted one. */
  const nativeLimit = (category: ExpenseCategory): number | undefined =>
    budgets.find(b => b.category === category && b.currency === view)?.amount;

  const saveDraft = async (category: ExpenseCategory) => {
    const raw = drafts[category];
    if (raw === undefined) return; // untouched
    if (combined) return;          // cannot happen: the editor is closed in combined scope
    const amount = parseFloat(raw);
    try {
      if (raw.trim() === '' || isNaN(amount) || amount <= 0) {
        if (nativeLimit(category) !== undefined) await apiDeleteBudget(category, view);
      } else {
        await apiSetBudget(category, view, amount);
      }
      await load();
      setDrafts(prev => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save budget');
    }
  };

  const clearBudget = async (category: ExpenseCategory) => {
    if (combined) return;
    try {
      await apiDeleteBudget(category, view);
      await load();
      setDrafts(prev => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear budget');
    }
  };

  // Read-only shows the limits and collapses the rest; editing shows every
  // category, because a category with no limit is exactly what you came to fix.
  const listed = editing ? categories : categories.filter(category => limits.has(category.slug));
  const withoutLimit = categories.filter(category => !limits.has(category.slug));

  return (
    <div className="budgets">
      <div className="budgets-head">
        {/*
          The month. Standing limits have no month of their own, so this steps
          the spending window only — see the caveat below, which is not optional
          for any month but this one.
        */}
        <div className="month-stepper" role="group" aria-label="Month">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(stepMonth(month, -1))}>
            ‹
          </button>
          <span className="month-current">{monthLabel(month)}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canStepForward(month, today)}
            onClick={() => setMonth(stepMonth(month, 1))}
          >
            ›
          </button>
        </div>

        {/* Only when there is a choice to make, and only between currencies this
            screen has numbers in — the one option set the report asks for, and
            the "All" that Budgets alone never had (F9, change 14). */}
        {presentCurrencies.length > 1 && (
          <CurrencyScope
            currencies={scopeCurrencies(currencies, presentCurrencies)}
            value={view}
            onChange={changeScope}
            combined={{
              value: 'primary',
              label: `All → ${primary}`,
              title: 'All currencies converted to your primary currency'
            }}
          />
        )}
      </div>

      {past && (
        <p className="budgets-caveat">
          {monthLabel(month)} spending, compared with your current limits — Sundry keeps one standing
          limit per category, not one per month.
        </p>
      )}

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">Loading budgets…</div>
      ) : (
        <>
          {verdict.limits === 0 ? (
            <p className="no-data">
              No limits set{combined ? '' : ` in ${view}`}. Set one below and this screen will tell you
              whether you are over it.
            </p>
          ) : (
            <section className="budget-verdict" aria-labelledby="budget-verdict-heading">
              <h2 id="budget-verdict-heading" className="sr-only">Verdict</h2>
              <p className="finding">{verdictSentence(verdict)}</p>

              <ul className="verdict-list">
                {verdict.over.map(row => (
                  <li key={row.category} className="verdict-row over">
                    <span className="verdict-name">{label(row.category)}</span>
                    <span className="verdict-figures">
                      <strong>{fmt(row.spent)}</strong>
                      <span className="muted-text"> of {fmt(row.allowance)}</span>
                      <span className="over-badge">{row.pct - 100}% over</span>
                    </span>
                  </li>
                ))}
                {verdict.close.map(row => (
                  <li key={row.category} className="verdict-row close">
                    <span className="verdict-name">{label(row.category)}</span>
                    <span className="verdict-figures">
                      <strong>{fmt(row.spent)}</strong>
                      <span className="muted-text"> of {fmt(row.allowance)}</span>
                      <span className="close-badge">{row.pct}% used</span>
                    </span>
                  </li>
                ))}
                {/* One line, whatever the count: the categories that behaved are
                    the least newsworthy thing on the screen, and they used to
                    take a full-height card each. */}
                {verdict.onTrack > 0 && (
                  <li className="verdict-row on-track">
                    <span className="verdict-name muted-text">
                      {verdict.onTrack} on track
                    </span>
                  </li>
                )}
              </ul>

              {/* Pace: the reading nothing in the product performed. A month that
                  has ended has no pace left to keep, so it states its length
                  instead of pretending the calendar is still running. */}
              <p className="budget-pace">
                <strong>{Math.round(usedShare * 100)}% used</strong>
                {past ? (
                  <> · the whole of {monthLabel(month)}</>
                ) : (
                  <> · day {elapsed} of {days} · {PACE_LABEL[pace]}</>
                )}
                <span className="muted-text">
                  {' '}— {fmt(spentOnLimits)} of {fmt(allowance)} across {verdict.limits}{' '}
                  {verdict.limits === 1 ? 'limit' : 'limits'}
                </span>
              </p>
            </section>
          )}

          {monthSpend > 0 && (
            <div className="chart-box chart-full" style={{ marginBottom: '18px' }}>
              <h3>Spending in {monthLabel(month)}{allowance > 0 ? ' vs. your limits' : ''}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: number) => String(d)} minTickGap={16} />
                  <YAxis width={56} tickFormatter={(v: number) => `${currencySymbol(display)}${Math.round(v)}`} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v, display)}
                    labelFormatter={(d) => `Day ${d}`}
                  />
                  {allowance > 0 && (
                    // `extendDomain`, or the line the chart's own title promises
                    // is clipped away in exactly the case it matters most: a
                    // month whose spending has not reached its limits yet leaves
                    // the axis topping out below them, and "vs. your limits"
                    // renders with no limits on it.
                    <ReferenceLine
                      y={allowance}
                      ifOverflow="extendDomain"
                      stroke="var(--danger)"
                      strokeDasharray="5 4"
                      label={{ value: 'Limits', fill: 'var(--danger)', fontSize: 11, position: 'insideTopRight' }}
                    />
                  )}
                  <Line type="monotone" dataKey="cumulative" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="budget-list-head">
            <h2>Limits</h2>
            <button
              type="button"
              className="btn-secondary"
              aria-pressed={editing}
              disabled={combined}
              title={combined ? 'Pick a single currency to edit its limits' : undefined}
              onClick={() => setEditRequested(value => !value)}
            >
              {editing ? 'Done' : 'Edit limits'}
            </button>
          </div>

          {/* Not a failed save: a limit is stored in one currency, and writing an
              edit made against a converted figure would rewrite it at today's
              rate. Say which currency to pick rather than let the button lie. */}
          {combined && (
            <p className="muted-text budget-edit-hint">
              A limit is held in its own currency. Pick {presentCurrencies.join(', ')} above to edit one.
            </p>
          )}

          {editing && (
            <p className="muted-text budget-edit-hint">
              A limit is a standing monthly figure — it applies to every month, not just this one.
              Emptying a box removes the limit.
            </p>
          )}

          <ul className="budget-list">
            {listed.map(category => {
              const slug = category.slug;
              const limit = limits.get(slug);
              const used = spent.get(slug) ?? 0;
              const rowStatus = limit === undefined ? undefined : status.get(slug) ?? 'on-track';
              const fill = limit ? Math.min(100, (used / limit) * 100) : 0;
              const draft = drafts[slug] !== undefined
                ? drafts[slug]
                : nativeLimit(slug) !== undefined ? String(nativeLimit(slug)) : '';

              return (
                <li key={slug} className={`budget-row ${rowStatus ?? ''}`}>
                  <div className="budget-row-head">
                    <span className="budget-cat">
                      <span className="category-dot" style={{ background: category.color }} />
                      {category.label}
                    </span>
                    <span className="budget-figures">
                      <strong>{fmt(used)}</strong>
                      {limit !== undefined && <span className="muted-text"> / {fmt(limit)}</span>}
                      {rowStatus === 'over' && <span className="over-badge">over</span>}
                      {rowStatus === 'close' && <span className="close-badge">close</span>}
                    </span>
                  </div>

                  <div className="budget-bar-track">
                    <div
                      className="budget-bar-fill"
                      style={{ width: `${fill}%`, background: rowStatus === 'over' ? 'var(--danger)' : 'var(--accent)' }}
                    />
                    {/* Where the calendar is. One pixel, on every bar that has a
                        limit, so "43% used" can be read against the month
                        without arithmetic — and gone once the month has ended,
                        when it would sit on the end of the track saying nothing. */}
                    {limit !== undefined && !past && (
                      <span
                        className="budget-bar-pace"
                        style={{ left: `${elapsedShare * 100}%` }}
                        title={`Day ${elapsed} of ${days}`}
                      />
                    )}
                  </div>

                  {editing && (
                    <div className="budget-row-actions">
                      <div className="budget-input">
                        <span className="budget-input-symbol">{currencySymbol(display)}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="No limit"
                          aria-label={`Monthly limit for ${category.label}`}
                          value={draft}
                          onChange={e => setDrafts(prev => ({ ...prev, [slug]: e.target.value }))}
                          onBlur={() => saveDraft(slug)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </div>
                      {nativeLimit(slug) !== undefined && (
                        <button type="button" className="btn-link" onClick={() => clearBudget(slug)}>
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}

            {/* Six cards that each said "No limit" around an empty box was the
                bulk of what made the old screen unreadable (F4). One line. */}
            {!editing && withoutLimit.length > 0 && (
              <li className="budget-row budget-nolimit">
                <span className="budget-cat">{withoutLimit.length} with no limit</span>
                <span className="muted-text">{withoutLimit.map(category => category.label).join(' · ')}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

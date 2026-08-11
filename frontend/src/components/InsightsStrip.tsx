/**
 * InsightsStrip
 *
 * At most three sentences at the top of the Dashboard answering "what changed?".
 * Deliberately not a tab: an insight you have to navigate to is an insight you
 * never read, and a fifth tab would cost more than it gives. Same progressive
 * disclosure as the currency buttons below it — when there is nothing worth
 * saying, the strip renders nothing at all.
 *
 * It follows the dashboard's own currency scope: a single native currency, or
 * everything converted into the primary currency through the user's FX rates.
 * Amounts from different currencies are only ever added together in the latter,
 * where the conversion is explicit and the caveat is already on screen.
 */

import { useEffect, useMemo, useState } from 'react';
import { getInsightsComparison, getInsightsRecurring } from '../services/api';
import { Currency, ExpenseCategory, FxRates, ComparisonResult, RecurringCharge } from '../types/expense.types';
import { formatCurrency } from '../utils/format';
import { convertAmount } from '../utils/fx';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  groceries: 'Groceries',
  transport: 'Transport',
  media: 'Media',
  entertainment: 'Entertainment',
  utilities: 'Utilities',
  maintenance: 'Maintenance',
  other: 'Other'
};

interface InsightsStripProps {
  /** The currency the dashboard is showing, or 'primary' for the combined view. */
  view: Currency | 'primary';
  primary: Currency;
  rates: FxRates;
}

/** Inclusive length of a window in days, e.g. 2026-07-12..2026-08-10 -> 30. */
function windowDays(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

export default function InsightsStrip({ view, primary, rates }: InsightsStripProps) {
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);

  // Fetched once, unfiltered: switching the currency buttons re-scopes the same
  // rows in the memo below rather than making another round trip.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [comparisonResult, recurringResult] = await Promise.all([
          getInsightsComparison(),
          getInsightsRecurring()
        ]);
        if (cancelled) return;
        setComparison(comparisonResult);
        setRecurring(recurringResult.recurring);
      } catch {
        // The strip is an enhancement on top of the dashboard, not part of it.
        // If insights cannot be loaded, stay silent rather than push an error
        // banner over charts that are working perfectly well.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const sentences = useMemo(() => {
    const displayCurrency: Currency = view === 'primary' ? primary : view;
    const inScope = (currency: Currency) => view === 'primary' || currency === view;
    const amount = (value: number, from: Currency) =>
      view === 'primary' ? convertAmount(value, from, primary, rates) : value;
    const fmt = (value: number) => formatCurrency(value, displayCurrency);

    const lines: string[] = [];

    if (comparison) {
      const days = windowDays(comparison.current.start, comparison.current.end);

      // Merge the per-currency rows down to one entry per category, in whatever
      // currency is on screen. `isNew` is re-derived rather than carried over:
      // a category new in one currency may not be new once they are combined.
      const totals = new Map<ExpenseCategory, { current: number; previous: number }>();
      comparison.byCategory.forEach(entry => {
        if (!inScope(entry.currency)) return;
        const accumulated = totals.get(entry.category) ?? { current: 0, previous: 0 };
        totals.set(entry.category, {
          current: accumulated.current + amount(entry.current, entry.currency),
          previous: accumulated.previous + amount(entry.previous, entry.currency)
        });
      });

      const entries = Array.from(totals.entries());

      // Biggest mover, among categories that existed in both windows. Below one
      // percent there is no story worth a sentence.
      const moved = entries
        .filter(([, value]) => value.previous > 0)
        .map(([category, value]) => ({
          category,
          ...value,
          pct: Math.round(((value.current - value.previous) / value.previous) * 100)
        }))
        .filter(entry => Math.abs(entry.pct) >= 1)
        .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous));

      if (moved.length > 0) {
        const mover = moved[0];
        lines.push(
          `${CATEGORY_LABELS[mover.category]} is ${mover.pct > 0 ? 'up' : 'down'} ${Math.abs(mover.pct)}% ` +
          `over the last ${days} days — ${fmt(mover.current)}, against ${fmt(mover.previous)} before.`
        );
      }

      // Something you did not spend on at all last period.
      const newcomers = entries
        .filter(([, value]) => value.previous === 0 && value.current > 0)
        .sort((a, b) => b[1].current - a[1].current);

      if (newcomers.length > 0) {
        const [category, value] = newcomers[0];
        lines.push(
          `${CATEGORY_LABELS[category]} is new — ${fmt(value.current)} in the last ${days} days, ` +
          `nothing in the ${days} before that.`
        );
      }
    }

    // Charges that stopped are not what anything costs you now, so they are left
    // out of the monthly figure. `totalPaid` is the number that makes someone act.
    const active = recurring.filter(charge => !charge.likelyCancelled && inScope(charge.currency));
    if (active.length > 0) {
      const monthly = active.reduce((sum, charge) => sum + amount(charge.monthlyCost, charge.currency), 0);
      const paid = active.reduce((sum, charge) => sum + amount(charge.totalPaid, charge.currency), 0);
      lines.push(
        active.length === 1
          ? `1 recurring charge costs about ${fmt(monthly)} a month — ${fmt(paid)} so far.`
          : `${active.length} recurring charges cost about ${fmt(monthly)} a month — ${fmt(paid)} so far.`
      );
    }

    return lines.slice(0, 3);
  }, [comparison, recurring, view, primary, rates]);

  if (sentences.length === 0) return null;

  return (
    <section className="insights-strip" aria-label="What changed">
      {sentences.map(sentence => (
        <p className="insight" key={sentence}>{sentence}</p>
      ))}
    </section>
  );
}

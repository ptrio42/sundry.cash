/**
 * InsightsStrip
 *
 * At most three sentences at the top of the Dashboard answering "what changed?".
 * Deliberately not a tab: an insight you have to navigate to is an insight you
 * never read, so these are seen whether or not anyone goes looking. Same
 * progressive disclosure as the currency buttons below it — when there is
 * nothing worth saying, the strip renders nothing at all.
 *
 * There *is* an Insights tab now (`Insights.tsx`), and it does not replace this.
 * The two do different jobs: the strip is what you are shown, the tab is where
 * you dig. The argument above is about navigation, and it never extended to a
 * detail view for the people who want one.
 *
 * It used to pick the sentences itself, merging two payloads and converting
 * currencies client-side. It no longer chooses anything: `/insights/summary`
 * scores every candidate finding against the user's own spending and returns
 * the few that survive. What is left here is the half that has to be here —
 * turning numbers and identifiers into English, which is where PL/EN will
 * eventually branch, and where the API deliberately refuses to go.
 */

import { useEffect, useState } from 'react';
import { getInsightsSummary } from '../services/api';
import { Category, Currency, Expense, Finding, SummaryResult } from '../types/expense.types';
import { formatCurrency, formatDate } from '../utils/format';
import { categoryLabel } from '../utils/categories';

interface InsightsStripProps {
  /** The currency the dashboard is showing, or 'primary' for the combined view. */
  view: Currency | 'primary';
  /** Names the sentences use — the API answers in slugs. */
  categories: Category[];
  /**
   * The ledger the dashboard is drawing. Only its length and identity are read:
   * App replaces the array on every add, edit and delete, so a new reference
   * means what the server computed is now stale.
   *
   * Today the dashboard is rendered conditionally and unmounts whenever the user
   * goes to a tab that can change expenses, so a remount already refreshes this.
   * The dependency is here so the strip stays correct the day that stops being
   * true — quick entry on the dashboard itself would silently freeze it.
   */
  expenses: Expense[];
}

/**
 * A merchant key is a fold of what was typed or scanned ('żabka'), not a name,
 * so it is capitalised for the sentence rather than shown as stored.
 */
function asName(key: string): string {
  return key.charAt(0).toLocaleUpperCase() + key.slice(1);
}

/** One finding, as a sentence. The only place in the app that writes prose about money. */
function sentence(finding: Finding, categories: Category[], currency: Currency): string {
  const fmt = (value: number) => formatCurrency(value, currency);
  const label = (slug: string) => categoryLabel(categories, slug);

  switch (finding.kind) {
    case 'category_moved': {
      const { category, current, previous, deltaPct, days } = finding.data;
      // Rounded here, not by the API: the payload keeps a decimal so a future
      // view can be more precise than a sentence wants to be.
      return `${label(category)} is ${deltaPct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(deltaPct))}% ` +
        `over the last ${days} days — ${fmt(current)}, against ${fmt(previous)} before.`;
    }

    case 'category_new': {
      const { category, current, days, previousDays } = finding.data;
      return `${label(category)} is new — ${fmt(current)} in the last ${days} days, ` +
        `nothing in the ${previousDays} before that.`;
    }

    case 'recurring_total': {
      const { count, monthlyCost, totalPaid } = finding.data;
      return count === 1
        ? `1 recurring charge costs about ${fmt(monthlyCost)} a month — ${fmt(totalPaid)} so far.`
        : `${count} recurring charges cost about ${fmt(monthlyCost)} a month — ${fmt(totalPaid)} so far.`;
    }

    case 'recurring_stopped': {
      const { label: charge, monthlyCost, totalPaid, lastSeen } = finding.data;
      return `${asName(charge)} looks like it stopped — nothing since ${formatDate(lastSeen)}, ` +
        `after ${fmt(totalPaid)} at about ${fmt(monthlyCost)} a month.`;
    }

    case 'merchant_drip': {
      const { key, total, count, average, days } = finding.data;
      return `${asName(key)} adds up — ${fmt(total)} across ${count} purchases in the last ${days} days, ` +
        `about ${fmt(average)} each.`;
    }

    case 'weekend_skew': {
      const { weekendPerDay, weekdayPerDay, ratio, days } = finding.data;
      // The window belongs in the sentence, exactly as it does in the five
      // templates above. The Insights tab makes this same claim over 12 months
      // while `/insights/summary` scores over 30 days — deliberately, since
      // `materiality` divides by spend *in the window* and a weekday needs more
      // than four samples. Without the window the two read as the app
      // contradicting itself (F10).
      return ratio > 1
        ? `Weekends cost more — about ${fmt(weekendPerDay)} a day over the last ${days} days, ` +
          `against ${fmt(weekdayPerDay)} on weekdays.`
        : `Weekdays cost more — about ${fmt(weekdayPerDay)} a day over the last ${days} days, ` +
          `against ${fmt(weekendPerDay)} at the weekend.`;
    }
  }
}

export default function InsightsStrip({ view, categories, expenses }: InsightsStripProps) {
  const [summary, setSummary] = useState<SummaryResult | null>(null);

  // The scope is part of the question now, not something to re-apply to an
  // answer: ranking a PLN finding against a USD one needs the conversion, so
  // the server does the merge and a currency switch costs a round trip.
  const scope = view === 'primary' ? 'primary' : view;

  useEffect(() => {
    let cancelled = false;

    // An empty ledger has nothing to compare and nothing that repeats, so a
    // fresh install should not spend a request learning that.
    if (expenses.length === 0) {
      setSummary(null);
      return;
    }

    (async () => {
      try {
        const result = await getInsightsSummary({ scope });
        if (cancelled) return;
        setSummary(result);
      } catch {
        // The strip is an enhancement on top of the dashboard, not part of it.
        // If insights cannot be loaded, stay silent rather than push an error
        // banner over charts that are working perfectly well.
      }
    })();

    return () => { cancelled = true; };
  }, [expenses, scope]);

  if (!summary || summary.findings.length === 0) return null;

  return (
    <section className="insights-strip" aria-label="What changed">
      {/* One finding per kind, so the kind is a stable key for the list. */}
      {summary.findings.map(finding => (
        <p className="insight" key={finding.kind}>{sentence(finding, categories, summary.currency)}</p>
      ))}
    </section>
  );
}

/**
 * Tests for the dashboard insights strip.
 *
 * The component no longer decides anything — the backend ranks the findings and
 * the strip turns each one into a sentence. So these are tests about prose:
 * that every kind of finding says something, that the numbers are formatted in
 * the currency the payload came back in, and that an empty list renders nothing
 * at all rather than an empty box. The endpoint is mocked so the fixtures are
 * exact and the assertions can be about the words.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InsightsStrip from '../components/InsightsStrip';
import { TEST_CATEGORIES } from './categories.fixture';
import { Expense, Finding, SummaryResult } from '../types/expense.types';

vi.mock('../services/api', () => ({
  getInsightsSummary: vi.fn()
}));

import { getInsightsSummary } from '../services/api';

const summaryMock = vi.mocked(getInsightsSummary);

// The strip never reads these rows — the findings come from the API. It reads
// the array's length, to know whether asking is worth a request, and its
// identity, to know when the answer it holds has gone stale. One row is enough.
const ledger: Expense[] = [
  { id: 1, amount: 10, date: '2026-08-01', description: 'x', category: 'groceries', currency: 'PLN' }
];

const summary = (findings: Finding[], currency = 'PLN'): SummaryResult => ({
  scope: currency,
  currency,
  windowDays: 30,
  findings
});

const strip = (view: string = 'PLN', expenses: Expense[] = ledger) => (
  <InsightsStrip view={view} categories={TEST_CATEGORIES} expenses={expenses} />
);

beforeEach(() => {
  summaryMock.mockReset();
  summaryMock.mockResolvedValue(summary([]));
});

describe('InsightsStrip', () => {
  it('says which way a category moved, in percent and in money', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'PLN',
        data: { category: 'groceries', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, days: 30, previousDays: 30 }
      }
    ]));

    render(strip());

    const sentence = await screen.findByText(/Groceries is up 34%/);
    expect(sentence).toHaveTextContent('over the last 30 days');
    expect(sentence).toHaveTextContent(/1\s*412,00\s*zł/);
    expect(sentence).toHaveTextContent(/1\s*053,50\s*zł/);
  });

  it('says "down" when spending fell', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'PLN',
        data: { category: 'transport', current: 50, previous: 200, delta: -150, deltaPct: -75, days: 30, previousDays: 30 }
      }
    ]));

    render(strip());

    expect(await screen.findByText(/Transport is down 75%/)).toBeInTheDocument();
  });

  it('names a category that had no spending at all last period', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_new',
        severity: 0.4,
        currency: 'PLN',
        // The two windows are not assumed to be the same length: a calendar
        // March against February is 31 days against 28.
        data: { category: 'utilities', current: 40, days: 31, previousDays: 28 }
      }
    ]));

    render(strip());

    // No previous spend means no percentage — the sentence must not invent one.
    const sentence = await screen.findByText(/Utilities is new/);
    expect(sentence).toHaveTextContent('in the last 31 days');
    expect(sentence).toHaveTextContent('nothing in the 28 before that');
    expect(sentence).not.toHaveTextContent('%');
  });

  it('counts the recurring charges and what they have cost', async () => {
    summaryMock.mockResolvedValue(summary([
      { kind: 'recurring_total', severity: 0.3, currency: 'PLN', data: { count: 2, monthlyCost: 142.8, totalPaid: 884 } }
    ]));

    render(strip());

    const sentence = await screen.findByText(/2 recurring charges/);
    expect(sentence).toHaveTextContent(/142,80\s*zł a month/);
    expect(sentence).toHaveTextContent(/884,00\s*zł so far/);
  });

  it('uses the singular for a single charge', async () => {
    summaryMock.mockResolvedValue(summary([
      { kind: 'recurring_total', severity: 0.3, currency: 'PLN', data: { count: 1, monthlyCost: 43, totalPaid: 344 } }
    ]));

    render(strip());

    expect(await screen.findByText(/1 recurring charge costs about/)).toHaveTextContent(/43,00\s*zł a month/);
  });

  it('names a charge that stopped, and what it had cost by then', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'recurring_stopped',
        severity: 0.3,
        currency: 'PLN',
        data: { label: 'old gazette', cadence: 'monthly', monthlyCost: 25, totalPaid: 100, lastSeen: '2026-04-10' }
      }
    ]));

    render(strip());

    const sentence = await screen.findByText(/Old gazette looks like it stopped/);
    expect(sentence).toHaveTextContent('Apr 10, 2026');
    expect(sentence).toHaveTextContent(/100,00\s*zł/);
  });

  it('adds up the small purchases at one place', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'merchant_drip',
        severity: 0.2,
        currency: 'PLN',
        // Merchant keys are a case-folded grouping key, not a name.
        data: { key: 'żabka', total: 300, count: 20, average: 15, days: 30 }
      }
    ]));

    render(strip());

    const sentence = await screen.findByText(/Żabka adds up/);
    expect(sentence).toHaveTextContent('across 20 purchases in the last 30 days');
    expect(sentence).toHaveTextContent(/300,00\s*zł/);
    expect(sentence).toHaveTextContent(/15,00\s*zł each/);
  });

  it('says which side of the week costs more, whichever side it is', async () => {
    summaryMock.mockResolvedValue(summary([
      { kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 } }
    ]));

    const { rerender } = render(strip());
    expect(await screen.findByText(/Weekends cost more/)).toHaveTextContent(/111,11\s*zł a day/);

    // A ratio below 1 is the same finding pointing the other way.
    summaryMock.mockResolvedValue(summary([
      { kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 20, weekdayPerDay: 80, ratio: 0.25, days: 30 } }
    ]));
    rerender(strip('PLN', [...ledger]));

    expect(await screen.findByText(/Weekdays cost more/)).toHaveTextContent(/80,00\s*zł a day/);
  });

  it('renders one paragraph per finding, in the order the server ranked them', async () => {
    summaryMock.mockResolvedValue(summary([
      { kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 } },
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'PLN',
        data: { category: 'groceries', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, days: 30, previousDays: 30 }
      },
      { kind: 'category_new', severity: 0.39, currency: 'PLN', data: { category: 'utilities', current: 300, days: 30, previousDays: 30 } }
    ]));

    const { container } = render(strip());

    await screen.findByText(/Weekends cost more/);
    const rendered = Array.from(container.querySelectorAll('.insight')).map(p => p.textContent ?? '');
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toMatch(/Weekends/);
    expect(rendered[1]).toMatch(/Groceries/);
    expect(rendered[2]).toMatch(/Utilities/);
  });

  it('formats every amount in the currency the payload came back in', async () => {
    // The strip does no conversion of its own any more; the server has already
    // decided what currency the findings are in, and says so.
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'USD',
        data: { category: 'groceries', current: 150, previous: 75, delta: 75, deltaPct: 100, days: 30, previousDays: 30 }
      }
    ], 'USD'));

    render(strip('primary'));

    const sentence = await screen.findByText(/Groceries is up 100%/);
    expect(sentence).toHaveTextContent('$150.00');
    expect(sentence).toHaveTextContent('$75.00');
  });

  it('renders nothing when there is nothing worth saying', async () => {
    const { container } = render(strip());

    await waitFor(() => expect(summaryMock).toHaveBeenCalled());
    expect(container.querySelector('.insights-strip')).toBeNull();
  });

  it('stays silent when the insights cannot be loaded', async () => {
    // A broken strip must not take the charts down with it, or shout about it.
    summaryMock.mockRejectedValue(new Error('HTTP error 500'));

    const { container } = render(strip());

    await waitFor(() => expect(summaryMock).toHaveBeenCalled());
    expect(container.querySelector('.insights-strip')).toBeNull();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('asks the server for the currency the dashboard is showing', async () => {
    const { rerender } = render(strip('PLN'));

    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith({ scope: 'PLN' }));

    // Switching the currency buttons is a new question, not a re-render of the
    // old answer: ranking across currencies needs the conversion the server does.
    rerender(strip('primary'));
    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith({ scope: 'primary' }));
    expect(summaryMock).toHaveBeenCalledTimes(2);

    // The same scope twice is not new information.
    rerender(strip('primary'));
    expect(summaryMock).toHaveBeenCalledTimes(2);
  });

  it('asks the server again when the ledger changes underneath it', async () => {
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'PLN',
        data: { category: 'groceries', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, days: 30, previousDays: 30 }
      }
    ]));

    const { rerender } = render(strip());
    await screen.findByText(/Groceries is up 34%/);
    expect(summaryMock).toHaveBeenCalledTimes(1);

    // A re-render with the same ledger is not new information.
    rerender(strip());
    expect(summaryMock).toHaveBeenCalledTimes(1);

    // App replaces the array on every add, edit and delete; that is the signal.
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'category_moved',
        severity: 0.4,
        currency: 'PLN',
        data: { category: 'groceries', current: 2000, previous: 1053.5, delta: 946.5, deltaPct: 89.8, days: 30, previousDays: 30 }
      }
    ]));
    rerender(strip('PLN', [...ledger]));

    expect(await screen.findByText(/Groceries is up 90%/)).toBeInTheDocument();
    expect(summaryMock).toHaveBeenCalledTimes(2);
  });

  it('does not call the server at all for an empty ledger', async () => {
    const { container } = render(strip('PLN', []));

    await waitFor(() => expect(container.querySelector('.insights-strip')).toBeNull());
    expect(summaryMock).not.toHaveBeenCalled();
  });
});

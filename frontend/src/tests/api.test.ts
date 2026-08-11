/**
 * Tests for the API service wrapper (src/services/api.ts).
 *
 * This module owns every network call plus the auth-expiry path, so the tests
 * drive it through the real exported functions with a stubbed global fetch and
 * assert on what the wrapper actually sends (URL, headers) and what it returns
 * or throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getExpenses,
  getExpense,
  createExpense,
  deleteExpense,
  login,
  getSettings,
  getToken,
  getInsightsComparison,
  getInsightsRecurring,
  createReceiptExpense,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrencies,
  setCurrencyEnabled
} from '../services/api';

const TOKEN_KEY = 'sundry-token';

/** A minimal Response stand-in: only the bits handleResponse touches. */
const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as unknown as Response;

/** A response whose body is not JSON (e.g. an nginx HTML error page). */
const brokenBodyResponse = (status: number) =>
  ({
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    }
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

/** The URL passed to fetch for the Nth call (0-based). */
const requestedUrl = (n = 0): string => String(fetchMock.mock.calls[n][0]);

/** The headers the wrapper built for the Nth call. */
const requestedHeaders = (n = 0): Headers => new Headers(fetchMock.mock.calls[n][1].headers);

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('apiFetch: bearer token', () => {
  it('attaches the stored token as a bearer header', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123');
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getExpenses();

    expect(requestedHeaders().get('Authorization')).toBe('Bearer tok-123');
  });

  it('sends no Authorization header when no token is stored', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getExpenses();

    expect(requestedHeaders().has('Authorization')).toBe(false);
  });

  it('keeps caller-supplied headers alongside the token', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123');
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));

    await createExpense({
      amount: 12.5,
      date: '2024-01-15',
      description: 'Coffee',
      category: 'other',
      currency: 'USD'
    });

    const headers = requestedHeaders();
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok-123');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});

describe('apiFetch: 401 handling', () => {
  it('clears the stored token and dispatches auth-expired on a 401', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    const onExpired = vi.fn();
    window.addEventListener('auth-expired', onExpired);

    // The 401 still travels on to handleResponse, so the call rejects too.
    await expect(getExpenses()).rejects.toThrow('Unauthorized');

    expect(getToken()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth-expired', onExpired);
  });

  it('does not dispatch auth-expired for other error statuses', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123');
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));
    const onExpired = vi.fn();
    window.addEventListener('auth-expired', onExpired);

    await expect(getExpense(99)).rejects.toThrow('Not found');

    expect(onExpired).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-123');
    window.removeEventListener('auth-expired', onExpired);
  });
});

describe('handleResponse: errors', () => {
  it("surfaces the server's error message rather than a generic one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Amount must be greater than 0' }, 400));

    await expect(
      createExpense({
        amount: 0,
        date: '2024-01-15',
        description: 'Nothing',
        category: 'other',
        currency: 'USD'
      })
    ).rejects.toThrow('Amount must be greater than 0');
  });

  it('still throws a usable Error when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(brokenBodyResponse(500));

    await expect(getExpenses()).rejects.toThrow('HTTP error 500');
  });

  it('resolves with undefined for a 204 No Content', async () => {
    // A 204 body must never be parsed; json() here would reject if called.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('no body');
      }
    } as unknown as Response);

    await expect(deleteExpense(7)).resolves.toBeUndefined();
    expect(requestedUrl()).toBe('/api/expenses/7');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('getExpenses: query string', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse([]));
  });

  it('requests the bare path when no filters are given', async () => {
    await getExpenses();
    expect(requestedUrl()).toBe('/api/expenses');
  });

  it('omits filters that are unset', async () => {
    await getExpenses({ category: 'groceries' });
    expect(requestedUrl()).toBe('/api/expenses?category=groceries');
  });

  it('includes every supplied filter', async () => {
    await getExpenses({
      category: 'transport',
      currency: 'PLN',
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    const url = new URL(requestedUrl(), 'http://localhost');
    expect(url.pathname).toBe('/api/expenses');
    expect(url.searchParams.get('category')).toBe('transport');
    expect(url.searchParams.get('currency')).toBe('PLN');
    expect(url.searchParams.get('startDate')).toBe('2024-01-01');
    expect(url.searchParams.get('endDate')).toBe('2024-01-31');
  });
});

describe('happy paths', () => {
  it('returns the parsed expense list', async () => {
    const expenses = [
      { id: 1, amount: 11.18, date: '2024-01-15', description: 'Biedronka', category: 'groceries', currency: 'PLN' }
    ];
    fetchMock.mockResolvedValue(jsonResponse(expenses));

    await expect(getExpenses()).resolves.toEqual(expenses);
  });

  it('returns the parsed settings payload', async () => {
    const settings = {
      defaultCurrency: 'PLN',
      defaultCategory: 'groceries',
      defaultBtcUnit: 'BTC',
      primaryCurrency: 'PLN'
    };
    fetchMock.mockResolvedValue(jsonResponse(settings));

    await expect(getSettings()).resolves.toEqual(settings);
    expect(requestedUrl()).toBe('/api/settings');
  });

  it('login posts the password and stores the returned token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: 'fresh-token' }));

    await login('hunter2');

    expect(requestedUrl()).toBe('/api/auth/login');
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ password: 'hunter2' }));
    expect(getToken()).toBe('fresh-token');
  });

  it('login leaves no token behind when the password is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Invalid password' }, 401));

    await expect(login('wrong')).rejects.toThrow('Invalid password');
    expect(getToken()).toBeNull();
  });
});

describe('insights', () => {
  it('sends no query string when no options are given, leaving the defaults to the backend', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ byCategory: [] }));

    await getInsightsComparison();

    expect(requestedUrl()).toBe('/api/insights/comparison');
  });

  it('puts the comparison options in the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ byCategory: [] }));

    await getInsightsComparison({ window: 'calendar', period: 'week', anchor: '2026-08-10', currency: 'PLN' });

    expect(requestedUrl()).toBe('/api/insights/comparison?window=calendar&period=week&anchor=2026-08-10&currency=PLN');
  });

  it('returns the parsed comparison payload', async () => {
    const payload = {
      window: 'rolling',
      period: 'month',
      current: { start: '2026-07-12', end: '2026-08-10' },
      previous: { start: '2026-06-12', end: '2026-07-11' },
      byCategory: [
        { category: 'groceries', currency: 'PLN', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, currentCount: 22, previousCount: 19, isNew: false }
      ]
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(getInsightsComparison()).resolves.toEqual(payload);
  });

  it('requests recurring charges with and without options', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ recurring: [] }));

    await getInsightsRecurring();
    expect(requestedUrl()).toBe('/api/insights/recurring');

    await getInsightsRecurring({ since: '2025-01-01', minOccurrences: 2 });
    expect(requestedUrl(1)).toBe('/api/insights/recurring?since=2025-01-01&minOccurrences=2');
  });

  it('surfaces a rejected insight request as an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Validation failed' }, 400));

    await expect(getInsightsComparison({ anchor: 'nope' })).rejects.toThrow('Validation failed');
  });
});

describe('receipts', () => {
  const fields = {
    amount: 11.18,
    date: '2024-01-15',
    description: "beer for Ada's party",
    category: 'groceries',
    currency: 'PLN'
  };

  /** The multipart body the wrapper built for the Nth call. */
  const sentForm = (n = 0): FormData => fetchMock.mock.calls[n][1].body as FormData;

  it('carries the detected merchant alongside the description', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));

    await createReceiptExpense({ ...fields, merchant: 'Żabka' });

    expect(requestedUrl()).toBe('/api/receipts');
    expect(sentForm().get('description')).toBe("beer for Ada's party");
    expect(sentForm().get('merchant')).toBe('Żabka');
  });

  it('omits the merchant entirely when the scan found none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));

    await createReceiptExpense({ ...fields, merchant: null });

    // Absent, not an empty string: the column is nullable and the backend falls
    // back to the description.
    expect(sentForm().has('merchant')).toBe(false);
  });
});

describe('categories', () => {
  it('reads the list from /api/categories', async () => {
    const payload = [{ slug: 'groceries', label: 'Groceries', color: '#34d399', sortOrder: 0, isBuiltin: true }];
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(getCategories()).resolves.toEqual(payload);
    expect(requestedUrl()).toBe('/api/categories');
  });

  it('posts a new category as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ slug: 'pet-food' }, 201));

    await createCategory({ slug: 'pet-food', label: 'Pet food', color: '#f472b6' });

    expect(requestedUrl()).toBe('/api/categories');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ slug: 'pet-food', label: 'Pet food', color: '#f472b6' });
  });

  it('escapes the slug in the path when updating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ slug: 'pet-food' }));

    await updateCategory('pet food', { label: 'Pet food' });

    expect(requestedUrl()).toBe('/api/categories/pet%20food');
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });

  it('sends reassignTo as a query parameter only when given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    await deleteCategory('pet-food');
    expect(requestedUrl()).toBe('/api/categories/pet-food');

    await deleteCategory('pet-food', 'other');
    expect(requestedUrl(1)).toBe('/api/categories/pet-food?reassignTo=other');
  });

  it('surfaces the 409 a still-in-use category answers with', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: '"Pet food" is still in use — pass reassignTo to move what uses it' }, 409));

    await expect(deleteCategory('pet-food')).rejects.toThrow(/still in use/);
  });
});

describe('currencies', () => {
  it('reads the catalogue from /api/currencies', async () => {
    const payload = [{ code: 'USD', minorUnits: 100, symbol: '$', locale: 'en-US', isIso: true, enabled: true }];
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(getCurrencies()).resolves.toEqual(payload);
    expect(requestedUrl()).toBe('/api/currencies');
  });

  it('sends enabled as a boolean body, and nothing else', async () => {
    // The exponent is not editable by design, so there is no other field.
    fetchMock.mockResolvedValue(jsonResponse({ code: 'EUR', enabled: true }));

    await setCurrencyEnabled('EUR', true);

    expect(requestedUrl()).toBe('/api/currencies/EUR');
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ enabled: true });
  });

  it('surfaces the 409 that guards the currency the settings point at', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'USD is still your default currency — change that first' }, 409));

    await expect(setCurrencyEnabled('USD', false)).rejects.toThrow(/default currency/);
  });
});

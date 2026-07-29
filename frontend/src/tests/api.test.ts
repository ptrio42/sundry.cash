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
  getToken
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

/**
 * Unit tests for the FX conversion helper.
 */

import { describe, it, expect } from 'vitest';
import { convertAmount } from '../utils/fx';
import { FxRates } from '../types/expense.types';

const RATES: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

describe('convertAmount', () => {
  it('returns the amount unchanged for the same currency', () => {
    expect(convertAmount(42, 'USD', 'USD', RATES)).toBe(42);
  });

  it('converts USD -> PLN using the USD-based rates', () => {
    // 100 USD = $100; 1 PLN = $0.25 -> 400 PLN
    expect(convertAmount(100, 'USD', 'PLN', RATES)).toBe(400);
  });

  it('converts PLN -> USD', () => {
    expect(convertAmount(400, 'PLN', 'USD', RATES)).toBe(100);
  });

  it('converts BTC -> USD', () => {
    expect(convertAmount(1, 'BTC', 'USD', RATES)).toBe(65000);
  });

  it('returns 0 when a rate is missing or zero', () => {
    expect(convertAmount(100, 'USD', 'PLN', { USD: 1, PLN: 0, BTC: 65000 })).toBe(0);
  });
});

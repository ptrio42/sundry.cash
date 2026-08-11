/**
 * Tests for utils/currencies.ts — which currencies a control should offer.
 *
 * The distinction under test is the one the spec insists on: disabling a
 * currency means "stop offering it for new entries", never "hide the history".
 */

import { describe, it, expect } from 'vitest';
import { offeredCurrencies, relevantCurrencies } from '../utils/currencies';
import { TEST_CURRENCIES } from './currencies.fixture';

describe('offeredCurrencies', () => {
  it('is the enabled ones only — what a new expense may use', () => {
    expect(offeredCurrencies(TEST_CURRENCIES).map(c => c.code)).toEqual(['BTC', 'PLN', 'USD']);
  });
});

describe('relevantCurrencies', () => {
  it('adds a disabled currency back when the data still uses it', () => {
    const codes = relevantCurrencies(TEST_CURRENCIES, ['USD', 'EUR']).map(c => c.code);

    expect(codes).toContain('EUR');
    expect(codes).toEqual(['BTC', 'PLN', 'USD', 'EUR']);
  });

  it('leaves out a disabled currency nothing uses', () => {
    expect(relevantCurrencies(TEST_CURRENCIES, ['USD']).map(c => c.code)).not.toContain('JPY');
  });

  it('keeps a code the catalogue does not know at all, rather than dropping the rows', () => {
    const extra = relevantCurrencies(TEST_CURRENCIES, ['ZZZ']).find(c => c.code === 'ZZZ');

    expect(extra).toMatchObject({ code: 'ZZZ', symbol: 'ZZZ', enabled: false });
  });

  it('deduplicates and does not care how often a code appears in the data', () => {
    const codes = relevantCurrencies(TEST_CURRENCIES, ['EUR', 'EUR', 'USD']).map(c => c.code);
    expect(codes.filter(c => c === 'EUR')).toHaveLength(1);
  });
});

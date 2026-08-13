/**
 * Tests for `utils/who.ts` — what this device calls itself when it records an
 * expense.
 *
 * The three states are the whole point and the thing most likely to regress:
 * absent (nobody has been asked), a name, and the empty *skip* sentinel. Only
 * the first of those may be asked again, which is why "not now" writes a value
 * rather than leaving the key alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_WHO_LENGTH,
  hasAnsweredWho,
  normaliseWho,
  readWho,
  setWho,
  skipWho,
} from '../utils/who';

const KEY = 'sundry-who';

beforeEach(() => {
  localStorage.clear();
});

describe('normaliseWho', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normaliseWho('   Ania   ')).toBe('Ania');
    expect(normaliseWho('Ania    z   Krakowa')).toBe('Ania z Krakowa');
    expect(normaliseWho('\tAnia\n')).toBe('Ania');
  });

  it('caps the length, because the ledger renders this in a table column', () => {
    const long = 'Katarzyna Aleksandra Nowakowska-Wiśniewska';
    expect(normaliseWho(long)).toHaveLength(MAX_WHO_LENGTH);
    expect(long.startsWith(normaliseWho(long))).toBe(true);
  });

  it('keeps the case it was typed in — people want to see "Ania", not "ania"', () => {
    expect(normaliseWho('ANIA')).toBe('ANIA');
    expect(normaliseWho('ania')).toBe('ania');
  });
});

describe('the three states of the key', () => {
  it('is unanswered while the key is absent, and asks for a name', () => {
    expect(hasAnsweredWho()).toBe(false);
    expect(readWho()).toBeNull();
  });

  it('remembers a name, normalised', () => {
    setWho('  Ania   Kowalska  ');

    expect(localStorage.getItem(KEY)).toBe('Ania Kowalska');
    expect(readWho()).toBe('Ania Kowalska');
    expect(hasAnsweredWho()).toBe(true);
  });

  /**
   * The distinction the sentinel exists for. `readWho` cannot tell "not now"
   * from "not yet" — both mean an unlabelled row — so the prompt is gated on
   * `hasAnsweredWho`, and skipping has to leave something behind.
   */
  it('treats a skip as answered, so the prompt never returns', () => {
    skipWho();

    expect(localStorage.getItem(KEY)).toBe('');
    expect(readWho()).toBeNull();
    expect(hasAnsweredWho()).toBe(true);
  });

  it('reads a name that was stored with stray whitespace as the name', () => {
    // Written by an older build, or by hand: the reader normalises rather than
    // trusting what is on disk.
    localStorage.setItem(KEY, '   Alex  ');
    expect(readWho()).toBe('Alex');
  });

  it('reads a whitespace-only value as nobody, not as a name', () => {
    localStorage.setItem(KEY, '   ');
    expect(readWho()).toBeNull();
    expect(hasAnsweredWho()).toBe(true);
  });

  it('takes an empty name as a skip, so no caller has to check first', () => {
    setWho('   ');

    expect(localStorage.getItem(KEY)).toBe('');
    expect(hasAnsweredWho()).toBe(true);
    expect(readWho()).toBeNull();
  });
});

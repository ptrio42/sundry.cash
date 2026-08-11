/**
 * The route table's pure half. The hook itself is covered through the shell in
 * `App.test.tsx`, where a route only matters if it actually renders something.
 */

import { describe, it, expect } from 'vitest';
import { DESTINATIONS, hashFor, parseHash } from '../utils/route';

describe('parseHash', () => {
  it('reads every destination the app has', () => {
    for (const destination of DESTINATIONS) {
      expect(parseHash(`#/${destination}`)).toBe(destination);
    }
  });

  it('accepts the shapes a URL bar and a copy-paste actually produce', () => {
    expect(parseHash('#/expenses')).toBe('expenses');
    expect(parseHash('#expenses')).toBe('expenses');
    expect(parseHash('#/Expenses')).toBe('expenses');
    expect(parseHash('#/expenses/')).toBe('expenses');
  });

  it('rejects anything it does not own, rather than guessing', () => {
    // Including the routes that existed before the shell was rebuilt: a stale
    // bookmark must land on the boot destination, not on a blank screen.
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#/')).toBeNull();
    expect(parseHash('#/analytics')).toBeNull();
    expect(parseHash('#/fx')).toBeNull();
    expect(parseHash('#/home-page')).toBeNull();
  });

  it('round-trips with hashFor', () => {
    for (const destination of DESTINATIONS) {
      expect(parseHash(hashFor(destination))).toBe(destination);
    }
  });
});

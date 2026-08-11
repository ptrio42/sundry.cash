/**
 * The route table's pure half. The hook itself is covered through the shell in
 * `App.test.tsx`, where a route only matters if it actually renders something.
 */

import { describe, it, expect } from 'vitest';
import { DESTINATIONS, hashFor, parseRoute } from '../utils/route';

describe('parseRoute', () => {
  it('reads every destination the app has', () => {
    for (const destination of DESTINATIONS) {
      expect(parseRoute(`#/${destination}`)).toEqual({ destination, addOpen: false });
    }
  });

  it('reads the Add sheet as a state of the destination it is over', () => {
    // Not a fifth destination: you are still on Expenses with a sheet on top,
    // which is what closing it has to put you back to (change 10).
    expect(parseRoute('#/expenses/add')).toEqual({ destination: 'expenses', addOpen: true });
    expect(parseRoute('#/home/add')).toEqual({ destination: 'home', addOpen: true });
    expect(parseRoute('#/home/ADD')).toEqual({ destination: 'home', addOpen: true });
  });

  it('accepts the shapes a URL bar and a copy-paste actually produce', () => {
    expect(parseRoute('#/expenses')?.destination).toBe('expenses');
    expect(parseRoute('#expenses')?.destination).toBe('expenses');
    expect(parseRoute('#/Expenses')?.destination).toBe('expenses');
    expect(parseRoute('#/expenses/')?.destination).toBe('expenses');
  });

  it('rejects anything it does not own, rather than guessing', () => {
    // Including the routes that existed before the shell was rebuilt: a stale
    // bookmark must land on the boot destination, not on a blank screen.
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#/')).toBeNull();
    expect(parseRoute('#/analytics')).toBeNull();
    expect(parseRoute('#/fx')).toBeNull();
    expect(parseRoute('#/home-page')).toBeNull();
  });

  it('no longer answers for #/add, which wave 3a stopped being a place', () => {
    // Waves 0–2 shipped `add` as the fifth destination. The bookmark is dead,
    // so it has to fall through to the boot destination like any other.
    expect(parseRoute('#/add')).toBeNull();
  });

  it('ignores a second segment it does not recognise', () => {
    expect(parseRoute('#/budgets/nonsense')).toEqual({ destination: 'budgets', addOpen: false });
  });

  it('round-trips with hashFor, sheet open and closed', () => {
    for (const destination of DESTINATIONS) {
      expect(parseRoute(hashFor(destination))).toEqual({ destination, addOpen: false });
      expect(parseRoute(hashFor(destination, true))).toEqual({ destination, addOpen: true });
    }
  });
});

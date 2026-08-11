/**
 * The route table, and the whole routing mechanism.
 *
 * Until now the URL never changed: a reload always landed on the blank Add
 * Expense form, nothing was bookmarkable, and browser Back left the app
 * (F13 in `docs/ux-review-findings.md`). This fixes that with four destinations
 * plus the Add action, and nothing else — filter and scope parameters belong to
 * the waves that build the screens owning them.
 *
 * **No router dependency**, in a repo that deliberately has neither a router nor
 * a state library (CLAUDE.md). Parse the hash, listen for `hashchange`, write it
 * back when a nav button is pressed. That is all of it.
 *
 * **Hash rather than `pushState`**, deliberately. A `pushState` route needs the
 * server to answer every path with `index.html`. `frontend/nginx.conf` does —
 * but Sundry is self-hosted and nothing promises that whatever serves someone's
 * `dist/` folder does too, so a reload on `/expenses` would 404. That is the
 * exact failure this file exists to remove, so it must not be reintroduced for
 * a prettier URL. A hash never reaches the server.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Four destinations and one action. `add` is a route in this wave because the
 * Add sheet does not exist yet — wave 3 turns it into an overlay, at which point
 * this entry becomes the sheet's open/closed state and Back keeps closing it.
 */
export const DESTINATIONS = ['home', 'expenses', 'budgets', 'settings', 'add'] as const;

export type Destination = typeof DESTINATIONS[number];

const isDestination = (slug: string): slug is Destination =>
  (DESTINATIONS as readonly string[]).includes(slug);

/** `'#/expenses'` -> `'expenses'`. Anything unrecognised — including no hash at all — is null. */
export function parseHash(hash: string): Destination | null {
  const slug = hash.replace(/^#\/?/, '').split(/[/?]/)[0].toLowerCase();
  return isDestination(slug) ? slug : null;
}

export function hashFor(destination: Destination): string {
  return `#/${destination}`;
}

/**
 * The current destination, and a way to go somewhere else.
 *
 * `fallback` is where an unrecognised URL lands — the boot destination, which is
 * `home` from wave 2 onward (change 2). The caller decides; this file only has
 * to know that something has to answer for a URL naming nothing.
 */
export function useRoute(fallback: Destination): [Destination, (next: Destination) => void] {
  const [destination, setDestination] = useState<Destination>(
    () => parseHash(window.location.hash) ?? fallback
  );

  useEffect(() => {
    // A URL with no route in it is not addressable, and surviving a reload is
    // the point of this file — so name the destination we are on. `replaceState`
    // rather than an assignment: the first history entry should not be a
    // routeless URL the user can press Back into.
    if (!parseHash(window.location.hash)) {
      window.history.replaceState(null, '', hashFor(fallback));
    }

    const onHashChange = () => setDestination(parseHash(window.location.hash) ?? fallback);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [fallback]);

  const navigate = useCallback((next: Destination) => {
    // Set the state as well as the hash: `hashchange` fires a task later, and a
    // tab that highlights on the next tick reads as lag. The event then arrives
    // and sets the same value, which is a no-op re-render.
    setDestination(next);
    if (parseHash(window.location.hash) !== next) {
      window.location.hash = hashFor(next);
    }
  }, []);

  return [destination, navigate];
}

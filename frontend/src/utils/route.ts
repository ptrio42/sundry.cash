/**
 * The route table, and the whole routing mechanism.
 *
 * Until wave 1 the URL never changed: a reload always landed on the blank Add
 * Expense form, nothing was bookmarkable, and browser Back left the app
 * (F13 in `docs/ux-review-findings.md`). This fixes that with four destinations
 * and the Add sheet's open/closed state, and nothing else — filter and scope
 * parameters belong to the waves that build the screens owning them.
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

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Four destinations. `add` used to be the fifth, because the Add sheet did not
 * exist yet; wave 3 (change 10) made recording an input method rather than a
 * place, so it is a *state of a destination* now — see `ADD_SEGMENT`. A stale
 * `#/add` bookmark therefore names nothing and lands on the boot destination,
 * which is what `parseRoute` returning null is for.
 */
export const DESTINATIONS = ['home', 'expenses', 'budgets', 'settings'] as const;

export type Destination = typeof DESTINATIONS[number];

/**
 * The Add sheet in the URL: `#/expenses/add` is Expenses with the sheet over it.
 *
 * A second segment rather than a fifth destination, because that is what the
 * sheet is — you are still on Expenses, and closing it must put you back there
 * rather than somewhere the app chose. It also buys Back for free: opening the
 * sheet pushes an entry, so the gesture that means "undo the last thing that
 * happened to the screen" closes it instead of leaving the app.
 */
const ADD_SEGMENT = 'add';

const isDestination = (slug: string): slug is Destination =>
  (DESTINATIONS as readonly string[]).includes(slug);

/** Where you are, and whether the Add sheet is over it. */
export interface Route {
  destination: Destination;
  addOpen: boolean;
}

/**
 * `'#/expenses/add'` -> `{ destination: 'expenses', addOpen: true }`.
 * Anything whose first segment is not a destination — including no hash at
 * all — is null, and the caller decides what answers for it.
 */
export function parseRoute(hash: string): Route | null {
  const segments = hash.replace(/^#\/?/, '').split(/[?#]/)[0].split('/').filter(Boolean);
  const slug = (segments[0] ?? '').toLowerCase();
  if (!isDestination(slug)) return null;
  return { destination: slug, addOpen: (segments[1] ?? '').toLowerCase() === ADD_SEGMENT };
}

export function hashFor(destination: Destination, addOpen = false): string {
  return addOpen ? `#/${destination}/${ADD_SEGMENT}` : `#/${destination}`;
}

/** What `useRoute` hands back: where you are, and every way of changing it. */
export interface Routing extends Route {
  navigate: (next: Destination) => void;
  openAdd: () => void;
  closeAdd: () => void;
}

/**
 * The current route, and the four ways it can change.
 *
 * `fallback` is where an unrecognised URL lands — the boot destination, which is
 * `home` from wave 2 onward (change 2). The caller decides; this file only has
 * to know that something has to answer for a URL naming nothing.
 */
export function useRoute(fallback: Destination): Routing {
  const [route, setRoute] = useState<Route>(
    () => parseRoute(window.location.hash) ?? { destination: fallback, addOpen: false }
  );

  /**
   * Did *we* push the sheet's history entry?
   *
   * Closing has to know: an entry we pushed must be popped, or the Back press
   * after closing would reopen the sheet. But a URL that arrived with `/add`
   * already in it — a reload, a shared link — has nothing of ours behind it,
   * and popping would take the visitor out of the app entirely.
   */
  const pushedAdd = useRef(false);

  useEffect(() => {
    // A URL with no route in it is not addressable, and surviving a reload is
    // the point of this file — so name the destination we are on. `replaceState`
    // rather than an assignment: the first history entry should not be a
    // routeless URL the user can press Back into.
    if (!parseRoute(window.location.hash)) {
      window.history.replaceState(null, '', hashFor(fallback));
    }

    const onHashChange = () => {
      const next = parseRoute(window.location.hash) ?? { destination: fallback, addOpen: false };
      // However the sheet closed — Back, a nav button, a hand-edited URL — the
      // entry we pushed is behind us now and is not ours to pop again.
      if (!next.addOpen) pushedAdd.current = false;
      setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [fallback]);

  /**
   * The URL is the source of truth for all three of these, not `route`: it is
   * what a hand-edited hash, a Back press and our own writes all agree on, and
   * reading it here keeps the callbacks free of the state they change.
   */
  const current = useCallback(
    (): Route => parseRoute(window.location.hash) ?? { destination: fallback, addOpen: false },
    [fallback]
  );

  const navigate = useCallback((next: Destination) => {
    // Set the state as well as the hash: `hashchange` fires a task later, and a
    // tab that highlights on the next tick reads as lag. The event then arrives
    // and sets the same value, which is a no-op re-render.
    pushedAdd.current = false;
    setRoute({ destination: next, addOpen: false });
    const target = hashFor(next);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, []);

  const openAdd = useCallback(() => {
    const { destination, addOpen } = current();
    if (addOpen) return;
    pushedAdd.current = true;
    setRoute({ destination, addOpen: true });
    // An assignment pushes, which is the whole point: Back now closes the sheet.
    window.location.hash = hashFor(destination, true);
  }, [current]);

  const closeAdd = useCallback(() => {
    const { destination, addOpen } = current();
    if (!addOpen) return;
    setRoute({ destination, addOpen: false });
    if (pushedAdd.current) {
      pushedAdd.current = false;
      window.history.back();
    } else {
      // Nothing of ours to pop — rewrite in place so the sheet does not come
      // back on the next Back press either.
      window.history.replaceState(null, '', hashFor(destination));
    }
  }, [current]);

  return { ...route, navigate, openAdd, closeAdd };
}

/**
 * What this device calls itself when it records an expense.
 *
 * **A label, not a login.** Several people already share one instance and one
 * password; this says which of them added a row. Anyone who can reach the app
 * can add an expense as anyone, and nothing here is authentication, a permission
 * or an audit trail. See docs/who-label-spec.md.
 *
 * **Per device, never per instance.** The name lives in `localStorage` under
 * `sundry-who`, beside `sundry-token`, `sundry-theme`, `sundry-sidebar` and
 * `sundry-add-method`. A value in the server's settings table would be one name
 * for everyone, which is precisely the thing this feature exists to stop — so
 * there is deliberately no server-side fallback for an empty key. An unanswered
 * device asks; it never inherits somebody else's answer.
 *
 * **Three states, not two.** The key can be absent (nobody has been asked yet —
 * the Add sheet asks), hold a name, or hold the empty string. The empty string
 * is the *skip sentinel*: "Not now" writes it and the prompt never comes back,
 * because a question that reappears on every save is worse than no feature.
 * Settings is where someone changes their mind, in both directions.
 *
 * **The iOS caveat is accepted, not worked around.** Safari deletes all
 * script-writable storage after seven days of Safari use without interaction
 * with the site; web apps added to the home screen are exempt and keep their own
 * counter. So on an iPhone the name survives in the installed app and can vanish
 * in a browser tab. That costs one re-entry in Settings — no data and no access —
 * which is exactly what a label being a label buys us.
 * https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
 */

const WHO_KEY = 'sundry-who';

/**
 * Longest label worth storing — a first name or a nickname, not a sentence. The
 * same cap the backend applies in `models/expense.ts`; enforced here as well so
 * the field cannot accept characters the save would silently drop.
 */
export const MAX_WHO_LENGTH = 24;

/**
 * A typed name as it will be stored: trimmed, inner whitespace collapsed, capped
 * — and left in the case it was typed in, because people want to see "Ania"
 * rather than "ania". Mirrors `normalizeWho` in the backend model.
 */
export function normaliseWho(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_WHO_LENGTH);
}

/** Reading `localStorage` can throw (Safari private mode); nothing here is worth a crash. */
function read(): string | null {
  try {
    return localStorage.getItem(WHO_KEY);
  } catch {
    return null;
  }
}

function write(value: string): void {
  try {
    localStorage.setItem(WHO_KEY, value);
  } catch {
    // A device that cannot remember its name simply keeps being asked, which is
    // the same place an unanswered device is in.
  }
}

/**
 * The name to stamp on what this device records, or `null` for "nobody said".
 *
 * Called at save time by all three creation paths rather than threaded through
 * props: the answer is a fact about the browser, not application state, and it
 * can be written by the Add sheet's prompt a moment before the save that reads
 * it.
 */
export function readWho(): string | null {
  const stored = read();
  if (stored === null) return null;
  const name = normaliseWho(stored);
  return name.length === 0 ? null : name;
}

/**
 * Whether the question has been answered *at all* — a name or a deliberate skip.
 *
 * This is what the prompt is gated on, and it is why the skip sentinel is an
 * empty string rather than an absent key: `readWho` cannot tell "not now" from
 * "not yet", and only one of those should be asked again.
 */
export function hasAnsweredWho(): boolean {
  return read() !== null;
}

/** Remember a name. Empty input is a skip, so the caller never has to check. */
export function setWho(name: string): void {
  write(normaliseWho(name));
}

/**
 * "Not now", permanently: rows save unlabelled and the prompt does not return.
 * Settings still offers a name, which is the only route back.
 */
export function skipWho(): void {
  write('');
}

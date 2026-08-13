# Who added it — a per-device label

One instance already serves a household: everyone points a phone at the same address and types the
same password. What is missing is the smallest possible thing — knowing which of them added a row.

This spec adds that, and nothing more. **It is a label, not a login.** Anyone who knows the password
can add an expense as anyone; the field is informational, like a category. If a future feature needs
accountability rather than convenience, it needs accounts, which this is deliberately not.

## The shape

- The name lives in **`localStorage`**, per device, under `sundry-who` (the existing key convention:
  `sundry-token`, `sundry-theme`, `sundry-sidebar`).
- Every expense carries a nullable `who` column, stamped from that value at creation.
- The set of names is **whatever is already in the ledger**, served back to the client, so the second
  phone picks "Ania" from a button instead of typing it and inventing "ania".

Per device rather than per instance is the whole point: a value in the server's settings table would
be one name for everyone, which is the thing we are trying to stop.

## Data model

`expenses.who TEXT`, nullable, no default. NULL means "nobody said" — existing rows stay NULL and are
**never backfilled**.

The `ALTER TABLE` must run **after** the enum migrations in `backend/src/config/database.ts`, which
rebuild `expenses` from an explicit column list. `expenses.merchant` is the precedent and the trap is
recorded in `CLAUDE.md`; a column added before them is silently dropped on the next rebuild.

Unlike `merchant`, this one is read by the UI, so it goes on the `Expense` type — in **both**
packages, which duplicate their types on purpose and keep them in sync by hand.

Normalisation: trim, collapse inner whitespace, cap at 24 characters, store as typed. Deduplicate the
*suggestion list* case-insensitively; do not lowercase what you store, because people want to see
"Ania" and not "ania".

## API

`GET /api/expenses/people` → `{ "people": ["Ania", "Alex"] }` — distinct non-null `who` values,
ordered by how often they appear. **Behind `requireAuth` like everything else**: a public endpoint
listing the names of the people in a household is a small, needless leak.

`who` becomes an optional field on the three creation paths, all of which must stamp it:
`POST /expenses` (typed), `POST /receipts` (scanned) and `POST /import/confirm` (spreadsheet). An
import that lands unlabelled while everything else is labelled is the kind of gap that makes the
filter useless.

`PUT /expenses/:id` accepts it too. This is the deliberate opposite of `merchant`, which is
write-only so an edit cannot overwrite what the receipt said — `who` has no external source, so a
typo has to be fixable.

## Interface

**Asking.** At the first *save*, not at the first visit. A blocking "how should we call you?" before
someone has seen the app is the worst possible place for a question, and for the many people who use
this alone it is friction for nothing. So: the Add sheet asks once, inline, when `sundry-who` is
unset — existing names as buttons, plus a free field.

**Skipping is permanent, not repeated.** "Not now" writes an empty sentinel, and the prompt never
returns; Settings is where someone changes their mind. A prompt that reappears on every save is worse
than no feature.

**Settings** carries the permanent control: *"This device is…"*, changeable and clearable, with one
line of help saying it labels what you add here and is not a login.

**Expenses** gains a person filter, client-side, through the existing `LedgerQuery` — that screen
computes everything in the browser from one query object and nothing about this changes it.

**The ledger column renders only when the ledger holds more than one distinct name.** A column
repeating the same name on every row is noise in a table that is already dense.

**Home is untouched.** Home answers "what should I know that I did not ask about", and a per-person
breakdown is a question you ask — that belongs on Expenses, and putting it on Home would re-open a
ruling the UX rebuild already settled.

**The demo never asks.** `DEMO_MODE` is already exposed through `GET /api/config`; the prompt is off
when it is set. The demo is a shop window and the seed stays one fictional person's life.

## The iOS caveat, verified

Safari deletes all script-writable storage — localStorage, IndexedDB, sessionStorage, service worker
registrations — "after seven days of Safari use without user interaction on the site". **Web apps
added to the home screen are exempt**: they keep their own counter of days of use, and WebKit states
it does not expect their website data to be deleted. Introduced in Safari 13.1 / iOS 13.4 and still
current.

So on an iPhone the name persists in the installed app and can vanish in a browser tab. That is
acceptable precisely because this is a label: losing it costs one re-entry in Settings, no data and
no access. Do not build a server-side fallback for it — that would be the per-instance single name
this spec exists to avoid.

Source: [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), WebKit.

## What this changes outside the feature

Four places currently claim something narrower than the truth, and they change with it:

1. **`landing/index.html`** — "One person per account. There is no shared household ledger." Becomes
   the opposite, and it is a better sales line: the whole household uses one instance for the same
   €5, because we do not sell seats. Keep it honest about what it is not — one password, shared.
2. **`SECURITY.md`** — the opening "single-user by design", and the login-throttle paragraph's "the
   only person it locks out is you", which with a household locks the household.
3. **`docs/hosted-security.md`** — the threat model says "one person's expense history"; it is now a
   household's, which also feeds the open controller/processor question in §6.
4. **`README.md`** — check its feature list for the same claim.

## Out of scope

Accounts, per-person passwords, per-person permissions, per-person revocation, seeding the demo with
household names, and any per-person view on Home. All of them are a different product; the first four
would also invalidate the per-instance login backstop that shipped in `feat/auth-hardening`, which is
legitimate **because** one credential means one blast radius.

## Definition of done

The repo's: `npm run lint` clean, `npm run build` passing under strict TypeScript, `npm run test`
passing, output shown. Every component here has an existing suite, so extend rather than add where
one exists, and update the counts in `CLAUDE.md`.

Two behaviours worth a test each beyond the obvious: an expense created before the column exists
still reads and edits (NULL is a value, not a missing field), and the prompt does not appear when
`demoMode` is true.

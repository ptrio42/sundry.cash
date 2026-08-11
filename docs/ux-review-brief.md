# UX review — brief

## What Sundry is for

> **Sundry tells you what your money is doing, without you having to ask.**

The owner built it because every other tracker had too much: too many features, too much setup, too
much thinking before it was useful. That is the product, not a nice-to-have.

Four questions it exists to answer:

1. Where am I burning money?
2. Where could I save?
3. What are my spending habits?
4. **What am I missing?**

The fourth is the differentiator. Competitors organise around categories and budgets — around
*managing*. Sundry has machinery for *noticing*, and that machinery is currently buried.

## The success criterion

**Less thinking per task — not fewer things.**

Do not treat "remove items" as the goal. The navigation is organised by implementation rather than
by intent (three ways to enter data are three menu items; three ways to look at data are three menu
items), so the fix is re-organisation, and re-organisation may require something that does not exist
yet.

**Additions are allowed, with one condition: name the question it answers that nothing today
answers.** That condition is the counterweight. Without it a UX pass reliably produces a design
system, a five-step tour, theme settings and a fifth chart — because adding is visible work, and
this product dies of exactly that.

Two checks, both floors rather than targets:

- **Recognition, not recall.** Show someone only the navigation for five seconds and ask where they
  would go to record a receipt, or to see if they overspent on food. Hesitation means the structure
  is wrong — renaming will not fix it.
- **Nothing frequent is buried.** Recording an expense happens twenty times a week; importing a
  spreadsheet happens twice a year. They are currently peers in the menu.

## You must run the app, not read it

Judging layout from JSX is guessing. A demo database with 18 months of fictional data is seeded and
a preview config exists:

```
preview_start with name "demo-preview"     # frontend :5175, backend :5176, ./data/demo.db
```

Click through it. Do the three jobs above as a first-time user would and record where you hesitated.
Findings that could have been written without opening the app are not what this review is for.

## What is already known

Observed in the running app, so no need to rediscover:

- **The app opens on "Add Expense"** — a blank form. For a product whose thesis is *telling you
  things*, the first screen asks you to work instead.
- **Ten navigation items**, plus a theme toggle and **"Wipe Database" in red, permanently in the
  primary sidebar** — a destructive action in primary navigation.
- Mobile already needs a **"More" overflow**: the menu does not fit, and that was solved by hiding
  things rather than by having fewer.
- Every screen repeats the tagline **"Track your spending, stay on budget"** — which pitches
  budgeting, not the actual thesis.
- Dashboard leads with four stat tiles: Total Spent, **Expenses (a count of 662)**, Average,
  Largest. Easy to compute; hard to act on.
- Currency scope buttons plus a two-line caveat occupy prime space above the fold.
- The insights strip is the most useful content on the page and is styled like a notice box.

## Specific questions to answer

- **Dashboard / Analytics / Insights** — three destinations organised by technique (overview /
  query / ranking) rather than by question. How should they collapse, and what is lost?
- **Scan Receipt** as a menu item: destination or an input method inside adding an expense?
- **Import Excel** is a menu item; **Export is a button inside the expenses table.** Same job, two
  levels of hierarchy.
- **Currencies** is an FX-rate editor — configuration, not a place you visit.
- Should the app open on an overview rather than a form? What is the home screen?
- **Does the insights strip still earn its place** now that an Insights tab exists, or do they
  duplicate?
- **First run**: with zero data every chart is empty. No tour — if it needs a tour the UI failed.
  The seed script can load 18 months of demo data into a fresh install; Excel import already exists.
  What is the first-run screen?

## Decided — do not reopen

- **Income: a single number in Settings** ("typical monthly income"), not an income ledger. It
  unlocks savings rate, spend as a share of income, and a sanity check against the budget total.
  Income as transactions is a different product.
- Categories and currencies are user-editable rows already; treat them as data.
- No bank sync, ever. It contradicts the privacy positioning and the free tier is gone.
- The strip's sentences come from the server as data, never as prose — PL/EN is coming.

## Output

A **proposal, not code**: findings ranked by how much thinking they cost the user, a recommended
information architecture, and for each change a one-line justification tied to one of the four
questions. Anything added must carry the question it answers.

Implementation follows as a spec, reviewed separately.

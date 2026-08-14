/**
 * A test sequencer that lets you pin the file order, for reproducing an
 * order-dependent failure.
 *
 * Jest's default sequencer orders files by each one's *previous* runtime, cached
 * in the OS temp dir. That is good for wall-clock and terrible for debugging: the
 * order moves between runs, so a suite that leaks state into the next file fails
 * intermittently and re-running until it passes proves nothing. Naming the order
 * turns such a failure into a deterministic one.
 *
 * Set JEST_FORCE_ORDER to a comma-separated list of file substrings. Files whose
 * path contains one run first, in the order given; everything else follows in the
 * default order behind them. Unset, this behaves exactly like the default
 * sequencer, so it is safe to leave wired up in jest.config.js.
 *
 *   JEST_FORCE_ORDER=auth.test.ts,auth-required.test.ts npm test --prefix backend
 *
 * That pair is the specific one worth remembering: `auth.test.ts` ends by
 * exhausting the login throttle on purpose, and before every suite had its own
 * database (see src/tests/db-per-file.ts) that made `auth-required.test.ts`'s
 * "refuses to mint a token" answer 429 instead of 503. It is also the run that
 * demonstrates the isolation still holds.
 *
 * Plain CommonJS on purpose: jest loads the sequencer through its own require
 * before the transform chain is in play, so ts-jest does not apply here and a
 * `.ts` file would fail to load.
 */
const Sequencer = require('@jest/test-sequencer').default;

/** The substrings named in JEST_FORCE_ORDER, in the order given. */
function forcedPatterns() {
  return (process.env.JEST_FORCE_ORDER || '')
    .split(',')
    .map(pattern => pattern.trim())
    .filter(Boolean);
}

class ForcedOrderSequencer extends Sequencer {
  async sort(tests) {
    const patterns = forcedPatterns();
    // Fall through to the default entirely rather than re-implementing it: with
    // no patterns this class must be indistinguishable from the stock sequencer.
    const sorted = await super.sort(tests);
    if (patterns.length === 0) return sorted;

    // A pattern that matches nothing is a typo, and silently running the default
    // order would look like the repro simply passing.
    const pinned = patterns.map(pattern => {
      const match = sorted.find(test => test.path.includes(pattern));
      if (!match) {
        throw new Error(
          `JEST_FORCE_ORDER names "${pattern}", which matches no test file. ` +
          'Order was not forced, so the run would not have proved anything.'
        );
      }
      return match;
    });

    const rest = sorted.filter(test => !pinned.includes(test));
    return [...pinned, ...rest];
  }
}

module.exports = ForcedOrderSequencer;

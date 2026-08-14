/**
 * Jest `setupFilesAfterEnv` hook — gives this test FILE a database of its own.
 *
 * Every backend suite used to share one SQLite file, with `--runInBand` the only
 * thing sequencing them and `globalSetup` wiping the data directory once per
 * *run* rather than once per file. So each suite inherited whatever the previous
 * ones had written, and that shipped twice as an intermittent failure:
 *
 *   - `import.test.ts` looks its imported rows up *by date* through
 *     `Object.fromEntries`, so a row of the same currency written by another
 *     suite on one of those dates silently replaced the entry being asserted on.
 *     Which row won was a `created_at` tie at one-second resolution.
 *   - `auth.test.ts` ends by exhausting the login throttle on purpose. Both
 *     counters live in the database, and `POST /api/auth/login` runs
 *     `loginBackstop` *before* the handler that chooses between 503, 401 and a
 *     token — so the next suite to assert on that route got 429 instead of its
 *     own expectation.
 *
 * Neither is reachable once no two files can see each other's rows, which is
 * cheaper than remembering the rule. It also removes the reason the failures
 * looked random: Jest's default sequencer orders files by their previous runtime
 * from a cache in the OS temp dir, so adding cases anywhere reshuffles the order
 * and wakes up a coupling that had been dormant.
 *
 * Three facts make this the hook that can do it, and each was checked rather
 * than assumed:
 *
 *   1. `setupFiles` runs too early — `expect` does not exist there, so the test
 *      path is not knowable. `env.ts` is that hook, and can only set a floor.
 *   2. A `setupFilesAfterEnv` module is evaluated *before* the test file's own
 *      imports, and `expect.getState().testPath` is already populated at module
 *      evaluation time (not merely inside `beforeEach`). `config/database.ts`
 *      reads DB_PATH once, at module load, and that load is triggered by the
 *      test file importing `../server` — i.e. strictly after this runs.
 *   3. Jest resets the module registry between files, so each one genuinely
 *      re-evaluates `config/database.ts` and opens its own connection against
 *      its own path. What Jest does *not* reset is `process.env`, which is the
 *      other half of why writing to it here works at all.
 *
 * The cost is a full `initializeDatabase()` per suite instead of the idempotent
 * re-run each one used to do over an already-built database. Measured on the
 * compiled module, loading it against an empty path costs about 11 ms more than
 * against a populated one (39 ms against 28 ms, medians of 12) — roughly 180 ms
 * across the 16 suites that open a database at all, the other two never
 * importing `../server`. That does not show up in wall clock: interleaved full
 * runs after a warm-up came out at 8.4 s shared against 8.6 s per-file, with
 * each config's own spread several seconds wider than the gap. It is cheap
 * because every statement is `CREATE TABLE IF NOT EXISTS` or `INSERT OR IGNORE`
 * against a 64 KB file on a temp filesystem.
 *
 * `RECEIPTS_DIR` is *cleared* rather than set: `services/receipt/storage.ts`
 * derives the receipts directory from DB_PATH lazily, so images follow the
 * database here without being told. Clearing it matters because `process.env`
 * outlives the file boundary — a suite that set the variable for itself would
 * otherwise hand its own directory to every file that ran after it.
 */
import { testDbPathFor } from './paths';

const { testPath } = expect.getState();

// An empty test path would quietly put every suite back on one shared database,
// which is the defect this file exists to make impossible. Refuse instead: a
// silent return here would restore the exact bug, and looking random again.
if (!testPath) {
  throw new Error(
    'db-per-file: expect.getState().testPath is empty, so this suite cannot be given its own ' +
    'database. Check that this module is listed under `setupFilesAfterEnv` in jest.config.js — ' +
    'under `setupFiles` it runs before `expect` exists and the path is never populated.'
  );
}

process.env.DB_PATH = testDbPathFor(testPath);
delete process.env.RECEIPTS_DIR;

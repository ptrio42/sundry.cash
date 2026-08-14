/**
 * Where the test suite's throwaway databases live.
 *
 * `TEST_DATA_DIR` is the root for the whole run. `globalSetup` empties it before
 * the run and `globalTeardown` deletes it after, and both execute in a different
 * process context than the tests — so the path has to be computable from nothing
 * but the OS temp dir, which is why it is deterministic rather than PID-based.
 *
 * Under that root, every test *file* gets its own subdirectory holding its own
 * database and its own receipt images (see `db-per-file.ts`). Deleting the root
 * therefore still cleans up all of them in one call, and adding a suite adds
 * nothing to clean up by hand.
 */
import crypto from 'crypto';
import os from 'os';
import path from 'path';

export const TEST_DATA_DIR = path.join(os.tmpdir(), 'sundry-test-data');

/**
 * The directory a suite that has not been assigned one falls back to.
 *
 * `env.ts` points DB_PATH here so the suite can never reach the developer's real
 * database, even for the moment before `db-per-file.ts` narrows it. Nothing
 * should end up using it: if a run leaves rows in here, the per-file hook did not
 * run, and the name is the diagnosis.
 */
export const UNASSIGNED_DATA_DIR = path.join(TEST_DATA_DIR, 'unassigned');

/**
 * The data directory belonging to one test file.
 *
 * Named after the file so a failure stays debuggable: `ls $TMPDIR/sundry-test-data`
 * during a run names the suites that have run, and the database of the one that
 * failed can be opened directly. The 8-hex suffix is a digest of the *full* path,
 * so two test files sharing a basename in different directories still get
 * different directories even though the readable half of the name matches — the
 * guarantee is structural rather than a property of today's flat `src/tests/`.
 */
export function testDataDirFor(testPath: string): string {
  const slug = path.basename(testPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const digest = crypto.createHash('sha1').update(testPath).digest('hex').slice(0, 8);
  return path.join(TEST_DATA_DIR, `${slug}-${digest}`);
}

/** The database file inside that directory. */
export function testDbPathFor(testPath: string): string {
  return path.join(testDataDirFor(testPath), 'expenses.db');
}

/**
 * Removes everything the run wrote: one database per test file, the WAL sidecars
 * beside each, and any receipt images those suites stored.
 *
 * Deleting the root covers all of it, which is deliberate — a per-file layout
 * would otherwise need this hook to enumerate the suites, and a suite added
 * without a matching line here would leak a database into the OS temp dir on
 * every run. See `paths.ts` for why the root is deterministic.
 */
import fs from 'fs';
import { TEST_DATA_DIR } from './paths';

export default async function globalTeardown(): Promise<void> {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

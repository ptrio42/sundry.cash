/**
 * Starts every run from an empty data directory, so results never depend on
 * leftovers from a previous run.
 *
 * It empties the *root*, not one database file: each test file creates its own
 * database underneath (see `db-per-file.ts`), and none of them exists yet at this
 * point. Removing the whole tree is what makes that work without this hook
 * needing to know how many suites there are.
 */
import fs from 'fs';
import { TEST_DATA_DIR } from './paths';

export default async function globalSetup(): Promise<void> {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

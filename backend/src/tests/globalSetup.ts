/**
 * Starts every run from an empty database so results never depend on leftovers
 * from a previous run.
 */
import fs from 'fs';
import { TEST_DATA_DIR } from './paths';

export default async function globalSetup(): Promise<void> {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

/**
 * Removes the temp database and any receipt images the suite wrote.
 */
import fs from 'fs';
import { TEST_DATA_DIR } from './paths';

export default async function globalTeardown(): Promise<void> {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

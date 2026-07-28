/**
 * Single source of truth for the throwaway directory the test suite uses.
 *
 * Deliberately deterministic rather than PID-based: `globalTeardown` runs in a
 * different process context than the tests, so it needs to be able to compute
 * the same path in order to clean up.
 */
import os from 'os';
import path from 'path';

export const TEST_DATA_DIR = path.join(os.tmpdir(), 'sundry-test-data');

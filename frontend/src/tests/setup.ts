/**
 * Test setup file for Vitest
 * Configures testing environment
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// jsdom implements no layout and no ResizeObserver, but recharts'
// <ResponsiveContainer> constructs one on mount. Without this stub it throws
// during the passive-effect flush, which takes down the whole render — so a
// component that merely *contains* a chart appears to render nothing at all,
// and every query against it fails for a reason that has nothing to do with
// what is being tested.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

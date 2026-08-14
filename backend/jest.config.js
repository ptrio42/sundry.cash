module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Two hooks, in this order, and the order is the point.
  //
  // `env.ts` runs first and only sets a floor: DB_PATH lands in a temp dir, so
  // the suite can never touch the developer's real expenses.db. It cannot do
  // better, because `expect` does not exist yet and the test path is unknowable.
  //
  // `db-per-file.ts` runs next — still before the test file's own imports, but
  // late enough to read `expect.getState().testPath` — and narrows DB_PATH to a
  // database belonging to this one file. That is what stops the suites from
  // seeing each other's rows; read the header of that file for why it has to be
  // `setupFilesAfterEnv` and not `setupFiles`.
  setupFiles: ['<rootDir>/src/tests/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/db-per-file.ts'],
  globalSetup: '<rootDir>/src/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/src/tests/globalTeardown.ts',
  // A no-op until JEST_FORCE_ORDER is set, at which point it pins the file
  // order so an order-dependent failure can be reproduced instead of re-run.
  // See jest.sequencer.js.
  testSequencer: '<rootDir>/jest.sequencer.js',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',
  ],
};

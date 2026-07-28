module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Redirect DB_PATH to a temp dir BEFORE any test file imports the app, so the
  // suite never touches the developer's real expenses.db. See src/tests/env.ts.
  setupFiles: ['<rootDir>/src/tests/env.ts'],
  globalSetup: '<rootDir>/src/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/src/tests/globalTeardown.ts',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',
  ],
};

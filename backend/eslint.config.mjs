// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // `_`-prefixed parameters are the established convention here for the
      // arguments Express hands you but you do not use (`_req`, `_next`), and
      // tsconfig's noUnusedParameters already enforces the rest.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // better-sqlite3 rows and xlsx cells arrive untyped, and migration code
    // catches driver errors of unknown shape, so these layers cast through
    // `any` deliberately. Warn rather than error: visible, but not blocking.
    files: ['src/models/**/*.ts', 'src/routes/**/*.ts', 'src/config/**/*.ts', 'src/services/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  },
  {
    files: ['src/tests/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);

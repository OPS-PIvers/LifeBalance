import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';

export default tseslint.config(
  // e2e/ + playwright.config.ts are linted/transpiled by Playwright's own
  // pipeline (and type-checked via e2e/tsconfig.json), so keep them out of the
  // required `validate` job's `eslint .` run.
  { ignores: ['dist', 'functions', 'coverage', 'e2e', 'playwright.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react': reactPlugin
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          'argsIgnorePattern': '^_',
          'varsIgnorePattern': '^_',
          'caughtErrorsIgnorePattern': '^_'
        }
      ],
      // Parity with the functions/ workspace, which enforces this as an error.
      // Prefer proper types or `unknown` + narrowing over `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      'react/prop-types': 'off',
      // Enforce the @/ alias over parent-relative imports (see todo #7).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../**'],
              message: 'Use the "@/" alias instead of parent-relative imports (e.g. "@/utils/cn").',
            },
          ],
        },
      ],
    },
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
);

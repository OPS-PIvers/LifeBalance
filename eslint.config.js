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
  // .claude/ holds the Claude Code harness's git-ignored agent worktrees (full
  // repo copies); linting them double-counts errors from throwaway scratch code,
  // so keep them out of `eslint .` (mirrors the vitest exclude in vite.config.ts).
  { ignores: ['dist', 'functions', 'coverage', 'e2e', 'playwright.config.ts', '.claude', '.design-sync'] },
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
  {
    files: ['components/budget/TransactionMasterList.tsx'],
    rules: {
      // Third-party library issue (CLAUDE.md suppression policy §2).
      //
      // `useVirtualizer` returns an internally-mutable object whose methods
      // (`scrollToIndex`, `measureElement`, …) cannot be memoized safely, so
      // eslint-plugin-react-hooks@7.x's recommended set reports
      // "Compilation Skipped: Use of incompatible library" on the call site.
      // Upstream: https://github.com/TanStack/virtual/issues/1119 (open).
      //
      // The report is a WARNING, and `pnpm lint` runs `eslint .` with no
      // --max-warnings, so nothing is failing today — this only removes
      // permanent noise from an otherwise clean run. Note also that the rule
      // ships in the v7 recommended preset regardless of React Compiler, which
      // this project does NOT run (no babel-plugin-react-compiler); the
      // skipped-memoization consequence it warns about therefore does not apply
      // to us at all.
      //
      // Scoped to the single `useVirtualizer` consumer so a genuinely
      // incompatible library elsewhere still gets flagged.
      // TODO: remove when TanStack/virtual#1119 is resolved upstream, or
      // revisit wholesale if React Compiler is ever adopted (at which point the
      // warning becomes real and needs a `'use no memo'` fix, not a disable).
      'react-hooks/incompatible-library': 'off',
    },
  },
);

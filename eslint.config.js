import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/** Invariant 11: Saoirse is portable. §32 */
const PORTABILITY = {
  patterns: [
    {
      group: ['**/shells/**', '**/tenants/**'],
      message:
        'Invariant 11 (§32): portable code must not import a tenant or a shell. Inject tenant config instead.',
    },
  ],
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      // Agent worktrees are whole copies of the repo; scanning them runs eslint out of memory.
      '.claude/**',
      // Its own package with its own lint config and tsconfig.
      'services/**',
      // Brand tooling: standalone render scripts, not part of the app.
      'brand/**',
      'dev-dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'src/components/ui/**', // shadcn-generated
      // Shipped from public/ as-is, so nothing compiles it and there is no project to
      // typecheck it against. It is two event listeners, kept small for that reason.
      'public/push-sw.js',
      // Generated from the linked project by `npm run db:types`.
      'supabase/functions/_shared/db/database.types.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Engineering standards: no `any`, no non-null assertions outside tests.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---- Browser app ----
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ---- Invariant 11: portable Saoirse UI ----
  {
    files: ['src/saoirse/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', PORTABILITY] },
  },

  // ---- Pure domain: no tenant, no shell, no platform APIs ----
  {
    files: ['supabase/functions/_shared/domain/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            ...PORTABILITY.patterns,
            {
              group: ['@/**', '**/src/**'],
              message:
                'The domain is pure TypeScript imported by Deno and the browser: it cannot import app code.',
            },
          ],
        },
      ],
      // "No Deno or browser APIs in this folder." (CLAUDE.md > Domain model)
      'no-restricted-globals': [
        'error',
        ...[
          'Deno',
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'fetch',
          'navigator',
        ].map((name) => ({
          name,
          message: 'The domain folder must stay free of Deno and browser APIs.',
        })),
      ],
    },
  },

  // ---- Tests ----
  {
    files: [
      '**/*.test.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
      'e2e/**/*.ts',
      'evals/**/*.ts',
      // CLI scripts: printing is the point.
      'scripts/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  // This file is plain JS outside any TS project, so type-aware rules cannot run on it.
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ---- Node-side config and scripts ----
  {
    files: ['*.config.{ts,js}', 'eslint.config.js', 'evals/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
)

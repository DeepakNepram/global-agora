import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Import-boundary groups.
 *
 * `src/globe/` and `src/core/` must never reach into `src/ui/`. That one rule is
 * what keeps the render layer and the domain layer portable to a native shell
 * later: if UI types leak downward, the "port" becomes a rewrite. See CLAUDE.md.
 *
 * Patterns cover every spelling of the same target: the `@/` alias, relative
 * hops (`../ui`, `../../ui/x`), and a bare `src/ui/x`.
 */
const uiLayer = ['@/ui', '@/ui/*', '@/ui/**', '**/ui', '**/ui/*', '**/ui/**'];

const boundaryMessage =
  'Layer violation: src/globe and src/core must not import from src/ui. ' +
  'Pass data down through an interface instead. This boundary is what makes ' +
  'the later native port possible — see CLAUDE.md "Directory rules".';

/** src/core is framework-agnostic: no React, no DOM, no renderer, no backend SDK. */
const coreForbidden = [
  {
    group: uiLayer,
    message: boundaryMessage,
  },
  {
    group: ['react', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
    message:
      'src/core must stay framework-agnostic. Keep React and store code in src/ui or src/state.',
  },
  {
    group: ['three', 'three/*', '@react-three/*'],
    message: 'src/core must not depend on the renderer. Three.js belongs in src/globe.',
  },
];

/** src/globe is the pure render layer: Three.js and r3f only, never UI or backend. */
const globeForbidden = [
  {
    group: uiLayer,
    message: boundaryMessage,
  },
  {
    group: ['@supabase/*', 'zustand', 'zustand/*'],
    message:
      'src/globe is a pure render layer. It must not fetch or own state — take it as props/args from src/ui.',
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.wrangler/**', 'public/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // CLAUDE.md style rules, enforced rather than hoped for.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // --- The boundary. Everything above is style; this is architecture. ---
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: coreForbidden }],
    },
  },
  {
    files: ['src/globe/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: globeForbidden }],
    },
  },

  // React Fast Refresh only applies to the component layer.
  {
    files: ['src/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Node-side code: workers, tests, build config.
  {
    files: [
      'workers/**/*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
      'vite.config.ts',
      '*.config.{js,ts}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
);

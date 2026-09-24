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

/** src/core is framework-agnostic: no React, no DOM, no renderer. */
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

/**
 * The Supabase SDK lives behind one seam, src/core/db. Everything else goes
 * through its interface, which keeps the ~54 kB SDK out of the main bundle and
 * leaves one file to swap when a native shell arrives.
 */
const supabaseSeam = {
  group: ['@supabase/*'],
  message:
    'Only src/core/db may import the Supabase SDK. Import createDbClient from @/core/db ' +
    '(dynamically, so the SDK stays out of the main bundle).',
};

/** src/globe is the pure render layer: Three.js only, never React, UI or backend. */
const globeForbidden = [
  {
    group: uiLayer,
    message: boundaryMessage,
  },
  {
    group: ['react', 'react-dom', 'react-dom/*', '@react-three/*'],
    message:
      'src/globe is Three.js only — no React, not even r3f. Return Object3Ds with dispose() and let src/ui mount them via <primitive>.',
  },
  {
    group: ['@supabase/*', 'zustand', 'zustand/*'],
    message:
      'src/globe is a pure render layer. It must not fetch or own state — take it as props/args from src/ui.',
  },
];

/**
 * Workers run on Cloudflare with service keys. They may share src/core (models,
 * categories, generated types) but never the app's UI, renderer or stores.
 */
const workersForbidden = [
  {
    group: [
      '@/ui',
      '@/ui/*',
      '@/globe',
      '@/globe/*',
      '@/state',
      '@/state/*',
      '**/src/ui',
      '**/src/ui/**',
      '**/src/globe',
      '**/src/globe/**',
      '**/src/state',
      '**/src/state/**',
    ],
    message: 'Workers may import src/core only. UI, renderer and store code stay in the app.',
  },
  {
    group: ['react', 'react-dom', 'react-dom/*', 'three', 'three/*', '@react-three/*', 'zustand'],
    message: 'Workers never render. Keep React, Three.js and Zustand in the app.',
  },
];

/** The app must never bundle Worker code: that is where the service key lives. */
const workersFromApp = {
  group: ['**/workers', '**/workers/**'],
  message: 'src/ must not import workers/. Worker code holds service keys (CLAUDE.md #9).',
};

const clockMessage =
  'Do not read the wall clock here. Render the time store value (src/state/timeStore.ts); ' +
  'only src/state/clock.ts may call wallClockNow().';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/.wrangler/**', 'public/**'],
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
    ignores: ['src/core/db/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...coreForbidden, supabaseSeam, workersFromApp] },
      ],
    },
  },
  {
    files: ['src/core/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...coreForbidden, workersFromApp] },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/**', 'src/globe/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [supabaseSeam, workersFromApp] },
      ],
    },
  },
  {
    files: ['src/globe/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...globeForbidden, workersFromApp] },
      ],
    },
  },

  {
    files: ['workers/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: workersForbidden }],
    },
  },

  // The rendered time is the store's time, never "now", or the scrubber cannot
  // replay the past. src/state/clock.ts is the one sanctioned wall-clock read;
  // tests/clock.test.ts backs this up in case a rule is disabled inline.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/state/clock.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: clockMessage },
        { object: 'performance', property: 'now', message: clockMessage },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
        { selector: "CallExpression[callee.name='Date']", message: clockMessage },
      ],
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

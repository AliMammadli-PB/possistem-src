// Static checks for the JavaScript that holds the trust boundaries: the Market
// Electron main process (IPC, licensing, hardware, LAN sync) and the build and
// patch scripts. TypeScript sources are covered by strict `tsc` (npm run
// typecheck). Run from restoranpos/: npm run lint (lints from the repository root)
import js from '@eslint/js';
import globals from 'globals';

const security = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-proto': 'error',
  'no-extend-native': 'error',
  'no-with': 'error',
  'no-caller': 'error',
  'no-unsafe-finally': 'error',
  'no-throw-literal': 'error',
  eqeqeq: ['error', 'smart'],
};

export default [
  {
    ignores: ['**/node_modules/**', '**/*.bak-*', '**/out/**', '**/dist/**', '**/release*/**', 'restoranpos/packaged-renderer/**', '**/demo-web/dist/**',
      // generated from the vendored Nayuki QR library / a code fragment spliced into the bundle
      'restoranpos/scripts/lib/ps-qr.mjs', 'restoranpos/scripts/catalog-return-snippet.js'],
  },
  {
    files: ['marketpos/electron/**/*.{cjs,js}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      ...security,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    // The live-demo bridges run in the browser in place of Electron main.
    files: ['restoranpos/demo-web/**/*.{js,mjs}', 'marketpos/demo-web/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: { ...security, 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error' },
  },
  {
    files: ['restoranpos/scripts/**/*.mjs'],
    // QA/capture scripts pass callbacks to page.evaluate(), which run in the page.
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser, qa: 'readonly', qaMount: 'readonly' } },
    rules: { ...security, 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error' },
  },
];

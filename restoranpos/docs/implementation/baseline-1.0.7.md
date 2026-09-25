# Maison Aurelia POS 1.0.7 baseline

Recorded on 2026-08-01 from the repository root before Task 1 implementation.

## Build prerequisites

- `npm run build:core` — PASS (exit 0). The Release core and Catch2 binary built successfully. Migration generation reported `up to date`, with 1 migration, 1 seed script, 8 literal chunks, and schema v1.
- `npm run build:desktop` — PASS (exit 0). Main, preload, and renderer production bundles built successfully.

## Verification

- `npm run typecheck` — PASS (exit 0). Both `tsconfig.node.json` and `tsconfig.web.json` completed without diagnostics.
- `npm run test:core` — PASS (exit 0). CTest ran `core_tests`: 1/1 test executable passed, 0 failed.
- `npm run test:unit` — PASS (exit 0). Vitest 4.1.10 ran 1 file and 3 tests; all passed.
- `npm run test:e2e` — FAIL (exit 1). Playwright ran 1 test and failed after 60 seconds at `tests/e2e/acceptance.spec.ts:37`, waiting for `/Maison Aurelia/i`. The captured page was the detached DevTools window showing `Not found`, so the test never reached its already-stale Aysel/1001 login steps.
- `node scripts/test-receipt-preview.mjs <database>` — NOT RUN. No repository-owned receipt database fixture exists. Omitting the argument targets operator application data, so the smoke was not run against potentially live data.

The Electron failure is a baseline failure, not a passing result hidden by a skip.

# SUNMI pilot verification — 2026-10-23

Candidate versions: Restaurant1.9.10 / Market1.5.63. Fiscal registration is opt-in and disabled by default. No real SUNMI credentials, fiscal device, bank or physical printer was available. No live fiscal document was created by these checks.

- Node22.22.1: **19/19** integration regressions passed. Includes real localhost HTTP response loss after simulated commit, identical retry UUID/body,15 concurrent process requests creating one simulated fiscal document, native ACK failure/restart, tenant switch, serial mismatch, role/frame restrictions, save callback failure, cumulative refund limits after105 subsequent documents, cash drawer failure, all21 API envelopes, and unknown UUID-less command protection. Fixtures are not a substitute for provider hardware acceptance.
- Shared real settings renderer: Playwright Chromium, widths360/390/768/1366/1920. No page errors or horizontal overflow; controls≥48px, rapid connect submits once, unsaved edits survive polling. Bank RRN rejects short input and accepts12 digits.
- TypeScript check passed for Restaurant and all four retail applications.
- Linux Market native suite: **47 test cases /22733 assertions** passed (ctest green). Windows x64 Market suite under Wine: **47/47**,207 assertions passed.
- Linux Restaurant full suite: **323/324** cases passed; one existing raster-preview case requires Windows (`Receipt raster unavailable`). Running the supported subset excluding that Windows-only preview yielded **323/323**,2338 assertions passed. Targeted payment/refund tests:25 cases,147 assertions passed; SUNMI native capture tests:2 cases,14 assertions passed.
- Windows x64 Restaurant full suite under Wine: **325/326**,2430/2431 assertions. One refund-code lookup case failed in the full randomized run and passed in isolation (1 case,6 assertions). This unresolved Wine/full-suite failure is disclosed; the entire native suite is not claimed green.
- Existing Vitest suite:237 passed,27 failed in11 files. A fresh archive of unchanged base commit `a07e7398523de108da21ca85cfd6029a8802ce76` produced the **same27 failure names**. These pre-existing bundle-string/domain expectations are not hidden or rewritten by this integration. No new failure names were introduced.
- MinGW Release Windows x64 cores built. Restaurant assembler97/97 patches passed; Market Vite build passed. Packaged SDK/preload/renderer/native hashes and updater dependency closure are checked with `node scripts/verify-sunmi-package.mjs`; build manifests include SHA-256 for all four pilot executables.

## Deployment boundary

These are **unsigned pilot packages**, not a certified fiscal production release. Source versions are bumped to prevent confusion with installed1.9.9/1.5.62. The production automatic-update manifests are not switched by this work. Before production use, finish the physical acceptance checklist in `QURASDIRMA-AZ.md`, resolve provider-specific behavior and meet the repository's signing/release requirements. The API SDK covers21 operation names; automatic business integration scope and intentionally unmapped advance/debt/correction flows are explicitly listed in the setup guide.

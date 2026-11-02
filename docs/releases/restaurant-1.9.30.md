# Restaurant POS 1.9.30

PIN entry now uses four evenly spaced rounded rectangular slots across the same width as the numeric keypad. The heading and actual trial/paid-access notice share the keypad's center line. The active slot is highlighted individually; filled slots retain masked dots. Keypad spacing and radii match the PIN controls, and key height adapts to short POS displays without falling below 56 CSS px. The ten-digit layout keeps the same outer width and touch input height.

The real password input, four/ten-digit prefix detection, native verification, mandatory PIN change, tenant logout, trial/license checks and till rules are unchanged. Scope is the Restaurant LoginPage and its own styles; no business data or credentials change.

## Checks

- Chromium 151.0.7922.34, real shipped LoginPage with the actual access-notice provider and isolated authentication fixture: before/after screenshots at 360, 768, 1366×735 and 1920×1080; additional 390 px layout. Filled three-digit and extended-code states inspected.
- Shared PIN/keypad left and right edges, overflow, touch target height and real trial notice verified; numeric filtering, one masked input, local and long PIN login, slow/failed prefix calls, rapid keypad/keyboard, wrong PIN clearing, Enter fallback and PIN change/confirmation passed.
- Saved-branch/till readiness and PIN-only subscription-notice checks passed.
- Native business/auth code unchanged from 1.9.28, with version rebuilt to 1.9.30. The 355-case native suite was run for 1.9.28; this visual change does not claim a fresh full native suite or physical Windows/printer/bank testing.
- Final installer archive, packaged dependencies/printer SDK and renderer/CSS/core resource hashes checked before publication.

## Use and rollback

Restart Desktop Possistem NEWEST, or install 1.9.30 from https://possistem.az/download/pos/ on Windows. Version 1.9.29 and previous website/owner builds are retained. Database schema, roles, personal PINs, subscriptions and till assignments are unchanged.

EXE: 356300573 bytes.
SHA-256: `aba2a1b003f7f8b10191b194df9939e7f1e0121ec42e4ca5aecb88208e6a6a3a`.

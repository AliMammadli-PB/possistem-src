# Restaurant POS 1.9.29

Restores the four circular PIN indicators above the keypad. Each entered digit fills a circle. The same single password input remains available for keyboard, touch, paste, focus and assistive technology; the digits are never rendered as plaintext. PIN-change confirmation keeps four circles. A long administrator PIN expands the indicator to ten circles when the fifth digit is entered, preserving the existing prefix check, native PIN verification and ten-digit auto-submit. No PIN mode button or seed-code hints are reintroduced.

## Validation

- Real shipped LoginPage in Chromium 151.0.7922.34: local four-digit sign-in, administrator ten-digit sign-in, failed/delayed prefix checks, rapid hardware/touch entry, Enter fallback, wrong PIN clearing and mandatory PIN change/confirmation passed.
- Actual circles, filled count, long-code expansion, numeric filtering, one masked input, no removed hints/mode buttons and no renderer exceptions verified. Screenshots inspected at 360, 390, 768, 1366 and 1920 px.
- PIN-only billing notice and saved-branch/assigned-till readiness regression checks passed.
- Native business/authentication code is unchanged from 1.9.28; native version rebuilt as 1.9.29. The full 355-case native suite was run for 1.9.28, not rerun for this visual-only change.
- Installer archive integrity and packaged local require/SDK checks run before publication. Final renderer, stylesheet and compiled core compared to packaged resources.

## Use

Restart Possistem NEWEST to load the new local sources. On Windows, install 1.9.29 from https://possistem.az/download/pos/ or accept the signed update. The previously published 1.9.28 build remains available for rollback. No customer data, roles, PINs, till assignments or subscription rules are changed.

EXE: 356300116 bytes.
SHA-256: `c5834c00c97e30e1145df6f1a4da9ff704ddd3ab29e9022816e15a3bea021a12`.

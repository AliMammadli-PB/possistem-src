# Restaurant POS 1.9.37

## Fixed

- **Printers that answered with pages of "This command is not supported".** Found on a real Aclass printer (`0483:5840`, firmware 1.027) over USB. Two separate causes:
  - Every print began with `1B 37 05` (density). This printer does not know `ESC 7`, and the standard form of it takes three parameters, so it was wrong for other printers too. Removed. No screen offered this setting.
  - Pictures went in 128-row `GS v 0` bands. This printer did not accept them and read the picture bytes as text and commands, which is where `1C 38`, `1C 01`, `1C F8` and the rest came from. Sending slowly did not help. Bands are now 24 rows.

## Changed

- **Logo and QR only on the guest's paper:** customer receipt, customer bill, refund slip and the test page. Kitchen tickets, X/Z and period reports and warehouse slips carry neither.

## Technical

- `encodeRaster` default band 24; `EscPosOptions::density` removed. The stored `printer.density` setting no longer does anything.
- `receiptShowsBrand(kind)` in `EscPos.hpp`, read by `escPosOptionsFor`.

## Checks

- Full native suite under Wine: 379 cases pass, with new cases for the band height, no `ESC 7`, and which kinds carry the brand.
- On the real Aclass printer, read by the owner from paper: the same page in 128-row bands failed, at full speed and slow; in 24-row bands it printed clean. The test page from the rebuilt core printed clean.
- Real core, order written directly into a test database, logo configured: the kitchen ticket has no picture and prints `QEYD: ...`; the test page still has the logo. The ticket went to the printer; the owner has not reported on that paper.

## Not tested

- The note through the order screen on a till, which was not run in 1.9.36 either.
- Other printer models, including Xprinter. The band threshold on this printer was not measured, only that 24 works and 128 does not.
- Why the printer dropped off USB twice during 128-row test sheets. It did not happen with the new bytes.
- The installer on real Windows.

## Not included

- On a kitchen ticket in text mode "ə" prints as "e", as before.

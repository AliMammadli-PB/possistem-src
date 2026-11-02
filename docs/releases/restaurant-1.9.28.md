# Restaurant POS 1.9.28

PIN sign-in uses the terminal's existing branch assignment. It no longer opens a branch confirmation frame or reassigns a till during sign-in. Explicit branch browsing remains under Anbar. Native authentication and branch/operator permissions remain in force.

Trading requires an active named till assigned to the calling physical terminal and an explicitly open business day. New orders, additions, quantity changes, kitchen submission, credit closure, cash/card/mixed payments, QR acceptance and transfers cannot silently open a day. Refund helpers also require an open till; X reports cannot open one. Existing read-only screens remain accessible. Tables and bills show a native readiness notice with a link to till setup or an explicit opening action. Cashiers with `shift.manage` may open a day without gaining Z-close permission. Requests and repeated opening use native transactions and idempotency.

The initial `usr-admin` login is named “Yerli administrator”; its role and PIN are unchanged. Migration 065 marks only its unused default payroll artifact as a system login. Custom employee names, salaries, debt, salary/ledger/order history remain intact and visible. Actual employee roles, including Kassir and Ofisiant, appear in the partner list. No new cashier PIN is seeded.

## Verification

- Full Windows native test binary under Wine: 355 cases / 2671 assertions passed. Extended focused sale-access cases subsequently check direct cash/card/mixed payment rejection, actual cashier payroll role, opening permissions and historical data preservation.
- Chromium 151.0.7922.34: real shipped shell at 360, 768, 1366, 1920 px; saved-branch sign-in, missing/closed till, explicit opening and waiter permissions.
- Existing QR sidebar accept/reject, hover/keyboard navigation, stock branch selection, PIN-only subscription notices and touch rail checks passed. Owner iframe create/edit and read-only guard checks passed; 16 subscription access checks passed.
- Installer archive integrity; 25 packaged local require edges; printer SDK checksum; packaged renderer/CSS/native hashes match final sources/build. No physical Windows or real printer/bank transactions claimed.

## Installation and rollback

Use https://possistem.az/download/pos/ . Restart the Desktop Possistem NEWEST launcher to load the new local sources; an existing running process keeps its loaded code until restarted. On another Windows PC install 1.9.28 or use the signed update feed.

On a fresh till, a manager creates/assigns its cash account in İdarə → Anbar → Kassalar, then a cashier/manager chooses “Kassanı aç”. Employee logins are created with their actual role and a personal PIN; the local administrator is not converted into a cashier.

Previous 1.9.27 installers and prior website/owner builds are retained. Native migration metadata is additive; keep the automatic database backup before any database rollback.

EXE: `Possistem-Setup-1.9.28.exe`, 356299946 bytes.
SHA-256: `64efd402f41e17a66cadc37409523593f8915ef5a3392e5e34d8683d37a4666d`.

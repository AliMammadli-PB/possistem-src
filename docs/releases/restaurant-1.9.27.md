# Restaurant POS 1.9.27 — QR inbox in the sidebar

QR orders now use a single launcher in the left navigation, next to the existing table/kitchen/admin controls. The launcher uses the same collapsed-icon and hover/focus-label behavior. A badge shows the real pending/accepting order count; the accessible name includes its full count. The former bottom-right fixed button is removed.

The existing inbox dialog is rendered through a React DOM portal to the document body so the sidebar's overflow and stacking context cannot clip it. Polling, permissions, notifications, accept/reject calls, table navigation, focus handling and keyboard close behavior remain in the existing component. No QR API, payment, database or native business-rule change is introduced.

Validation: real shipped AppShell at 360 (touch), 768, 1366 and 1920 px; exactly one launcher inside the sidebar nav; collapsed icon and expanded label; real badge updates; full viewport dialog; one reject and one accept request and correct table navigation; no launcher for a warehouse-only user. Existing QR settings/publish/print-export/accept tests passed at 768/1366/1920. Existing hover/branch-switch and 360–3840 touch/delivery checks passed; 16 access tests passed. Chromium 151.0.7922.34. Native version rebuilt; package/module closure, final renderer/style/core equality, installer archive and public download checks are recorded in the task artifacts. No live customer order or physical printer was used for UI fixtures.

Install 1.9.27 using the official `/download/pos/` page. For the local Possistem NEWEST source launcher, close and reopen the running application. Previous releases are retained for rollback.

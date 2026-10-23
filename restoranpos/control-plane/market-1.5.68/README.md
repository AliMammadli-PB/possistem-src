# Portal fixes deployed with Market 1.5.68

Apply the adjacent patches from the control-plane root.

- `market.ts.patch`: accept an empty configured store name (older tills permit it), preserve real sales snapshots during a `license-check` ping, and log invalid field paths/codes without request values.
- `receipt.css.patch`: use the active theme surface behind KPI numbers and the payment ring so dark-mode text remains readable.
- Restore `warehouse-20261020/{remote,remote-market,extra}` to owner-web/public before building. It was previously only in dist and disappeared on the next Vite build. Production was restored from the existing owner-web release copy at `/var/www/.possistem-support-info-20261022/control/apps/owner-web/dist/warehouse-20261020`.

Verification: owner-web typecheck/build passed; native iframe HTML and bridge script are HTTP 200 with actual POS contents; API health and DB are up. The physical till's subsequent signed heartbeat stored sales=4000 and count=1 instead of the license-only zero snapshot.

The full API TypeScript build is blocked by pre-existing missing mail-profiles/mail-unlock/mail-sync source files. The changed market route was transpiled independently, the service restarted, and its real heartbeat result verified. No claim of a passing full API build is made.

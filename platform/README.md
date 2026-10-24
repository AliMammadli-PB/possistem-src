# Possistem control platform

Canonical API, admin and customer panel sources. Existing production deployment lives at `/opt/possistem-pos-control`; these sources supersede historical `restoranpos/control-plane` snapshots.

Use Node 22 and pnpm 9.15: `pnpm install --frozen-lockfile`, `pnpm build:packages`, then `pnpm --filter @milioner/api build`, `pnpm --filter @possistem/admin-web build`, `pnpm --filter @milioner/owner-web build`. The website is in `../website` and desktop apps are in `../marketpos`, `../restoranpos`.

Set protected environment variables separately; `.env.example` contains names only. Run database migrations with the configured `DATABASE_URL` using `pnpm migrate`. Migration `0042_epoint_billing.sql` is additive, leaves legacy customers unenrolled and initializes payment switches to false.

The existing customer warehouse renderer under `apps/owner-web/public/warehouse-20261020` is retained during deployment. It is a generated copy of the POS renderer with the existing portal bridge; never remove it during a panel-only release. POS source/bundles live in the root Restaurant project. Large demo applications remain deployed under the website's `public/pos-demo-app`; rebuild via the POS demo scripts when changing those applications.

Billing tests use `scripts/test-billing-isolated.mjs` on the control host. It creates and drops a separate test database and uses a fake bank transport. It does not charge cards or change production customer records. Never set `BILLING_TEST_DATABASE_URL` to a production database.

See [Epoint setup and release notes](../docs/EPOINT-BILLING-20261024.md).

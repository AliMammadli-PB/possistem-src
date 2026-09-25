# AGENTS.md — start here

CyberPlus POS: an offline-first restaurant till (Windows, Electron + C++20 core
+ SQLite) plus a multi-tenant control platform (Fastify + Postgres + MySQL live
mirror + WhatsApp bot) that sells and supervises it.

The till keeps working with the network down. The control platform is where a
reseller creates a customer, an owner watches their restaurant from a phone,
and the WhatsApp bot answers "MASA 1 ZAL" with what is on that table.

## Read this first

Detailed conventions live in `.cursor/rules/`:

| Rule | Covers |
|---|---|
| `project-map.mdc` | folder layout, **two package managers**, generated files |
| `build-and-test.mdc` | what to run after a change, in either workspace |
| `release-and-deploy.mdc` | 3-file version bump, update feed, which deploy script |
| `multi-tenancy.mdc` | `customer_id` isolation rules for `control/**` |
| `native-core.mdc` | C++ handlers, money, audit, migrations |

## The one thing that trips everyone up

**Root is npm. `control/` is pnpm.** `npm install` in `control/` produces a
broken tree; `pnpm install` at the root ignores the desktop lockfile. Two
separate `node_modules`, two separate build commands.

## After you change something

```bash
# desktop / C++
npm run typecheck && npm run build:core && npm run test:core && npm run test:unit

# control platform
cd control && pnpm -r run build && pnpm test
```

If you changed the control API and you are **on the control server**:

```bash
sudo bash control/scripts/deploy-local-api.sh
journalctl -u cyberplus-pos-control -n 50 --no-pager
```

If you changed the desktop app, bump the version in **three** files
(`package.json`, `native/CMakeLists.txt`, `electron-builder.yml`), run
`npm run package:win`, then update `latest.yml` and the `releases` row — see
`docs/releases/` for the newest playbook.

## Things that look wrong but are intentional

- `restaurant-pos-core.exe` is the output name even when cross-compiled on
  Linux — the target is always Windows.
- The data folder is still `%APPDATA%\Maison Aurelia POS\` (the product was
  renamed; the path is kept so upgrades don't orphan databases).
- `audit_logs` cannot be UPDATEd or DELETEd — a trigger enforces it. Sync uses
  a watermark, retention uses an explicit opt-in flag.
- Databases are per restaurant: `data/tenants/<customerId>/pos.db`. One PC can
  serve several customers over its life.
- Money is `int64` qəpik. `19.99 ₼` is `1999`.
- A fresh database seeds the Milioner menu by default. That is a default, not an
  assumption: `POS_SEED_DEMO_MENU=0` skips it, and activation replaces the seeded
  restaurant name with the customer's real one.
- A version pin **holds a till back**; it does not downgrade one that already
  upgraded (`allowDowngrade = false`, and migrations are forward-only).

## Language

UI and owner-facing text is **Azerbaijani** (tr/en also shipped). Currency AZN,
tax 18%, service 10%. Keep new user-facing strings in all three locales.

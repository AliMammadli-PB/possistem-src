#!/usr/bin/env bash
# Deploy the partner (bayi) credit system to possistem.az. Run from this folder:
#   bash deploy-reseller-credits.sh
# Uses the `pos` SSH alias (key auth). Stops at the first error.
#
# Rollback (on the VPS, as root):
#   cd /opt/possistem-pos-control
#   for f in $(find apps packages -name '*.bak-*' -newer /tmp/cp-reseller/apply-reseller-credits.mjs); do cp "$f" "${f%.bak-*}"; done
#   rm -rf apps/api/dist && mv apps/api/dist.bak-reseller-credits apps/api/dist   (same for contracts, admin-web, reseller-web)
#   systemctl restart possistem-pos-control
# The migration only adds columns/tables and can stay.
set -euo pipefail
cd "$(dirname "$0")"

ssh -o BatchMode=yes pos 'rm -rf /tmp/cp-reseller && mkdir -p /tmp/cp-reseller'
scp -q -r apply-reseller-credits.mjs reseller-credits pos:/tmp/cp-reseller/

ssh -o BatchMode=yes pos 'bash -s' <<'REMOTE'
set -euo pipefail
ROOT=/opt/possistem-pos-control
cd /tmp/cp-reseller

echo "== 1/6 check (writes nothing)"
node apply-reseller-credits.mjs "$ROOT" --check

echo "== 2/6 backups"
mkdir -p /var/backups/possistem
DUMP=/var/backups/possistem/pos_control-before-reseller-credits-$(date -u +%Y%m%dT%H%M%SZ).dump
(cd /tmp && sudo -u postgres pg_dump -Fc possistem_pos_control > "$DUMP")
ls -la "$DUMP"
for d in apps/api/dist apps/admin-web/dist apps/reseller-web/dist packages/contracts/dist; do
  rm -rf "$ROOT/$d.bak-reseller-credits"
  cp -a "$ROOT/$d" "$ROOT/$d.bak-reseller-credits"
done

echo "== 3/6 source files"
node apply-reseller-credits.mjs "$ROOT"

echo "== 4/6 migration 0032 (additive), run as the tables' owner"
OWNER=$(cd /tmp && sudo -u postgres psql -At possistem_pos_control -c "select tableowner from pg_tables where schemaname='public' and tablename='resellers'")
(cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -q possistem_pos_control \
  -c "SET ROLE \"$OWNER\"" -f /tmp/cp-reseller/reseller-credits/0032_reseller_credits.sql)
(cd /tmp && sudo -u postgres psql -At possistem_pos_control -c "select count(*) from information_schema.columns where table_name='resellers' and column_name in ('trial_limit','max_devices','password_changed_at')")

echo "== 5/6 build"
cd "$ROOT"
pnpm --filter @possistem/contracts build
(cd apps/api && npx tsc -p tsconfig.json)
pnpm --filter @possistem/admin-web run build | tail -3
pnpm --filter @possistem/reseller-web run build | tail -3
chown -R --reference=apps/api/src apps/api/dist packages/contracts/dist

echo "== 6/6 restart"
systemctl restart possistem-pos-control
for i in $(seq 1 20); do curl -fsS -o /dev/null localhost:3210/pos/api/health && break; sleep 1; done
curl -fsS localhost:3210/pos/api/health; echo
systemctl is-active possistem-pos-control
echo "deploy ok"
REMOTE

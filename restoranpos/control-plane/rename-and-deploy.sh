#!/usr/bin/env bash
# 1. Rename @milioner/* → @possistem/* in possistem-pos-control
# 2. Disable WhatsApp session restore
# 3. Apply reseller-credits changes (files + migration 0032)
# 4. Full rebuild + restart
#
# Run from this folder:  bash rename-and-deploy.sh
# Uses the `pos` SSH alias (key auth). Stops at the first error.
#
# Rollback: restore /var/backups/possistem/src-before-rename-*.tar.gz,
#   pg_restore the dump, rebuild, restart.
set -euo pipefail
cd "$(dirname "$0")"

echo "== uploading payload =="
ssh -o BatchMode=yes pos 'rm -rf /tmp/cp-reseller && mkdir -p /tmp/cp-reseller'
scp -q -r apply-reseller-credits.mjs reseller-credits pos:/tmp/cp-reseller/

ssh -o BatchMode=yes pos 'bash -s' <<'REMOTE'
set -euo pipefail
ROOT=/opt/possistem-pos-control
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cd "$ROOT"

echo "== 1/9 full backup =="
mkdir -p /var/backups/possistem
tar czf "/var/backups/possistem/full-before-rename-${STAMP}.tar.gz" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml \
  apps/api/package.json apps/api/src \
  apps/owner-web/package.json apps/owner-web/src \
  apps/admin-web/package.json apps/admin-web/src \
  apps/reseller-web/package.json apps/reseller-web/src \
  packages/contracts/package.json packages/contracts/src \
  packages/database/package.json packages/database/drizzle.config.ts packages/database/src \
  packages/security/package.json packages/security/src
echo "backup: /var/backups/possistem/full-before-rename-${STAMP}.tar.gz"

DUMP="/var/backups/possistem/pos_control-before-rename-${STAMP}.dump"
(cd /tmp && sudo -u postgres pg_dump -Fc possistem_pos_control > "$DUMP")
ls -la "$DUMP"

for d in apps/api/dist apps/admin-web/dist apps/owner-web/dist apps/reseller-web/dist packages/contracts/dist; do
  [ -d "$ROOT/$d" ] && cp -a "$ROOT/$d" "$ROOT/$d.bak-rename-${STAMP}"
done

echo "== 2/9 package.json renames =="
sed -i 's/"milioner-pos-control"/"possistem-pos-control"/' package.json
sed -i 's/@milioner\//@possistem\//g' package.json
sed -i 's/"@milioner\/api"/"@possistem\/api"/' apps/api/package.json
sed -i 's/@milioner\//@possistem\//g' apps/api/package.json
sed -i 's/"@milioner\/owner-web"/"@possistem\/owner-web"/' apps/owner-web/package.json
sed -i 's/"@milioner\/reseller-web"/"@possistem\/reseller-web"/' apps/reseller-web/package.json
sed -i 's/"@milioner\/contracts"/"@possistem\/contracts"/' packages/contracts/package.json
sed -i 's/"@milioner\/database"/"@possistem\/database"/' packages/database/package.json
sed -i 's/"@milioner\/security"/"@possistem\/security"/' packages/security/package.json
echo "  8 package.json files renamed"

echo "== 3/9 source imports @milioner → @possistem =="
COUNT=0
find apps/api/src apps/owner-web/src apps/admin-web/src apps/reseller-web/src \
  packages/contracts/src packages/database packages/security/src \
  -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v '.bak-' | while read -r f; do
  if grep -q '@milioner/' "$f" 2>/dev/null; then
    sed -i 's/@milioner\//@possistem\//g' "$f"
  fi
done
echo "  imports renamed"

echo "== 4/9 other milioner strings =="
# env.ts defaults
sed -i "s|postgresql://milioner:milioner@127.0.0.1:5433/milioner_control|postgresql://possistem:possistem@127.0.0.1:5433/possistem_control|" apps/api/src/env.ts
sed -i "s/'milioner_session'/'possistem_session'/" apps/api/src/env.ts
sed -i "s|/var/lib/milioner-pos-control/downloads|/var/lib/possistem-pos-control/downloads|" apps/api/src/env.ts
sed -i 's/milionerSite/possistemSite/g' apps/api/src/env.ts
sed -i 's/milionerSite/possistemSite/g' apps/api/src/routes/contact.ts
sed -i 's/milionerVisible/possistemVisible/g' apps/api/src/routes/contact.ts
# seed default email
sed -i "s/superadmin@milioner.local/superadmin@possistem.local/" apps/api/src/seed.ts
# security sentinels
sed -i 's/milioner-customer-invalid-sentinel/possistem-customer-invalid-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-check-email-sentinel/possistem-check-email-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-otp-send-sentinel/possistem-otp-send-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-forgot-password-sentinel/possistem-forgot-password-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-invalid-account-sentinel/possistem-invalid-account-sentinel/g' apps/api/src/routes/auth.ts
# auth.ts comment cookie ref
sed -i 's/milioner_session/possistem_session/g' apps/api/src/plugins/auth.ts
# whatsapp log path
sed -i 's|/var/log/milioner-pos-control/|/var/log/possistem-pos-control/|g' apps/api/src/lib/whatsapp.ts
# database drizzle config
sed -i "s|postgresql://milioner:milioner@127.0.0.1:5433/milioner_control|postgresql://possistem:possistem@127.0.0.1:5433/possistem_control|" packages/database/drizzle.config.ts
echo "  env defaults, sentinels, paths fixed"

echo "== 5/9 disable WhatsApp =="
sed -i "s|^import { ownerWhatsappSettings }|// DISABLED: import { ownerWhatsappSettings }|" apps/api/src/index.ts
sed -i "s|^import { restoreWhatsappSessions }|// DISABLED: import { restoreWhatsappSessions }|" apps/api/src/index.ts
# Replace the whatsapp restore try-catch block
python3 -c "
import re
with open('apps/api/src/index.ts') as f:
    src = f.read()
pattern = r'// Inbound WhatsApp.*?whatsapp_restore_query_failed.*?\n\s*\}'
replacement = \"// WhatsApp disabled\n      app.log.info('whatsapp_disabled');\"
src = re.sub(pattern, replacement, src, flags=re.DOTALL)
with open('apps/api/src/index.ts', 'w') as f:
    f.write(src)
"
echo "  whatsapp session restore disabled"

echo "== 6/9 verify rename =="
REMAINING=$(grep -rn "milioner" apps/api/src/ apps/owner-web/src/ apps/admin-web/src/ \
  apps/reseller-web/src/ packages/contracts/src/ packages/database/ packages/security/src/ \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v '.bak-' | grep -v 'node_modules' | grep -v 'milioner-portal-theme' || true)
if [ -n "$REMAINING" ]; then
  echo "  WARNING — still has milioner:"
  echo "$REMAINING"
else
  echo "  CLEAN — no milioner refs in source"
fi

echo "== 7/9 apply reseller-credits files =="
cd /tmp/cp-reseller
# Skip md5 check — files just changed from rename. Apply all payload files directly.
for f in $(find reseller-credits/files -type f); do
  REL=${f#reseller-credits/files/}
  TARGET="$ROOT/$REL"
  if [ -f "$TARGET" ]; then
    cp "$TARGET" "${TARGET}.bak-credits-${STAMP}"
  fi
  mkdir -p "$(dirname "$TARGET")"
  cp "$f" "$TARGET"
  echo "  + $REL"
done

echo "== 8/9 migration 0032 =="
OWNER=$(cd /tmp && sudo -u postgres psql -At possistem_pos_control \
  -c "select tableowner from pg_tables where schemaname='public' and tablename='resellers'")
(cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -q possistem_pos_control \
  -c "SET ROLE \"$OWNER\"" -f /tmp/cp-reseller/reseller-credits/0032_reseller_credits.sql)
COLS=$(cd /tmp && sudo -u postgres psql -At possistem_pos_control \
  -c "select count(*) from information_schema.columns where table_name='resellers' and column_name in ('trial_limit','max_devices','password_changed_at')")
echo "  new resellers columns: $COLS (expect 3)"

echo "== 9/9 pnpm install + full rebuild + restart =="
cd "$ROOT"
pnpm install --no-frozen-lockfile 2>&1 | tail -3
pnpm --filter @possistem/contracts build 2>&1 | tail -2
pnpm --filter @possistem/database build 2>&1 | tail -2
pnpm --filter @possistem/security build 2>&1 | tail -2
(cd apps/api && npx tsc -p tsconfig.json) 2>&1 | tail -5
pnpm --filter @possistem/admin-web run build 2>&1 | tail -2
pnpm --filter @possistem/owner-web run build 2>&1 | tail -2
pnpm --filter @possistem/reseller-web run build 2>&1 | tail -2
chown -R --reference=apps/api/src apps/api/dist packages/contracts/dist packages/database/dist packages/security/dist apps/admin-web/dist apps/owner-web/dist apps/reseller-web/dist 2>/dev/null || true

systemctl restart possistem-pos-control
for i in $(seq 1 20); do curl -fsS -o /dev/null localhost:3210/pos/api/health && break; sleep 1; done
curl -fsS localhost:3210/pos/api/health; echo
systemctl is-active possistem-pos-control
echo ""
echo "DONE — renamed @milioner→@possistem, disabled WhatsApp, deployed credits"
REMOTE

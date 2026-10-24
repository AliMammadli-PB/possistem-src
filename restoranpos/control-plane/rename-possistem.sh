#!/usr/bin/env bash
# Rename @milioner/* → @possistem/* in possistem-pos-control, disable WhatsApp, rebuild.
set -euo pipefail
cd /opt/possistem-pos-control
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

echo "== 1/7 backup =="
tar czf "/var/backups/possistem/src-before-rename-${STAMP}.tar.gz" \
  package.json pnpm-lock.yaml \
  apps/api/package.json apps/api/src \
  apps/owner-web/package.json apps/owner-web/src \
  apps/admin-web/package.json \
  apps/reseller-web/package.json \
  packages/contracts/package.json packages/contracts/src \
  packages/database/package.json packages/database/drizzle.config.ts \
  packages/security/package.json
echo "backup: /var/backups/possistem/src-before-rename-${STAMP}.tar.gz"

echo "== 2/7 package.json renames =="
# Root
sed -i 's/"milioner-pos-control"/"possistem-pos-control"/' package.json
sed -i 's/@milioner\//@possistem\//g' package.json
# Apps
sed -i 's/"@milioner\/api"/"@possistem\/api"/' apps/api/package.json
sed -i 's/@milioner\//@possistem\//g' apps/api/package.json
sed -i 's/"@milioner\/owner-web"/"@possistem\/owner-web"/' apps/owner-web/package.json
sed -i 's/"@milioner\/reseller-web"/"@possistem\/reseller-web"/' apps/reseller-web/package.json
# Packages
sed -i 's/"@milioner\/contracts"/"@possistem\/contracts"/' packages/contracts/package.json
sed -i 's/"@milioner\/database"/"@possistem\/database"/' packages/database/package.json
sed -i 's/"@milioner\/security"/"@possistem\/security"/' packages/security/package.json

echo "== 3/7 source imports @milioner → @possistem =="
find apps/api/src apps/owner-web/src apps/admin-web/src apps/reseller-web/src packages/contracts/src packages/database packages/security/src \
  -name '*.ts' -o -name '*.tsx' | grep -v '.bak-' | while read -r f; do
  if grep -q '@milioner/' "$f"; then
    sed -i 's/@milioner\//@possistem\//g' "$f"
    echo "  $f"
  fi
done

echo "== 4/7 other milioner strings =="
# env.ts — dev defaults and variable names
sed -i "s|postgresql://milioner:milioner@127.0.0.1:5433/milioner_control|postgresql://possistem:possistem@127.0.0.1:5433/possistem_control|" apps/api/src/env.ts
sed -i "s/'milioner_session'/'possistem_session'/" apps/api/src/env.ts
sed -i "s|/var/lib/milioner-pos-control/downloads|/var/lib/possistem-pos-control/downloads|" apps/api/src/env.ts
sed -i 's/milionerSite/possistemSite/g' apps/api/src/env.ts
sed -i 's/milionerSite/possistemSite/g' apps/api/src/routes/contact.ts
sed -i 's/milionerVisible/possistemVisible/g' apps/api/src/routes/contact.ts

# seed.ts — default email
sed -i "s/superadmin@milioner.local/superadmin@possistem.local/" apps/api/src/seed.ts

# security sentinels (timing attack dummies — nobody sees these)
sed -i 's/milioner-customer-invalid-sentinel/possistem-customer-invalid-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-check-email-sentinel/possistem-check-email-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-otp-send-sentinel/possistem-otp-send-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-forgot-password-sentinel/possistem-forgot-password-sentinel/g' apps/api/src/routes/customer-auth.ts
sed -i 's/milioner-invalid-account-sentinel/possistem-invalid-account-sentinel/g' apps/api/src/routes/auth.ts
# auth.ts comment
sed -i 's/milioner_session/possistem_session/g' apps/api/src/plugins/auth.ts

# whatsapp.ts — fix log path (even though we disable it)
sed -i 's|/var/log/milioner-pos-control/|/var/log/possistem-pos-control/|g' apps/api/src/lib/whatsapp.ts

# database drizzle config dev default
sed -i "s|postgresql://milioner:milioner@127.0.0.1:5433/milioner_control|postgresql://possistem:possistem@127.0.0.1:5433/possistem_control|" packages/database/drizzle.config.ts

echo "== 5/7 disable WhatsApp (remove session restore from index.ts) =="
# Comment out the whatsapp import and restore block
sed -i "s/^import { ownerWhatsappSettings }/\/\/ DISABLED: import { ownerWhatsappSettings }/" apps/api/src/index.ts
sed -i "s/^import { restoreWhatsappSessions }/\/\/ DISABLED: import { restoreWhatsappSessions }/" apps/api/src/index.ts
# Replace the whatsapp restore block with a log
python3 -c "
import re
with open('apps/api/src/index.ts') as f:
    src = f.read()
# Find and replace the whatsapp restore try block
pattern = r'(// Inbound WhatsApp.*?whatsapp_restore_query_failed.*?\n\s*\})'
replacement = '''// WhatsApp disabled
      app.log.info('whatsapp_disabled');'''
src = re.sub(pattern, replacement, src, flags=re.DOTALL)
with open('apps/api/src/index.ts', 'w') as f:
    f.write(src)
print('  index.ts whatsapp block replaced')
"

echo "== 6/7 verify — remaining milioner in src (excluding .bak, node_modules) =="
REMAINING=$(grep -rn "milioner" apps/api/src/ apps/owner-web/src/ apps/admin-web/src/ apps/reseller-web/src/ packages/contracts/src/ packages/database/ packages/security/src/ --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v '.bak-' | grep -v 'node_modules' | grep -v 'milioner-portal-theme' || true)
if [ -n "$REMAINING" ]; then
  echo "WARNING — still has milioner:"
  echo "$REMAINING"
else
  echo "CLEAN — no milioner refs in source"
fi

echo "== 7/7 pnpm install + rebuild =="
pnpm install --no-frozen-lockfile 2>&1 | tail -5
pnpm --filter @possistem/contracts build 2>&1 | tail -3
pnpm --filter @possistem/database build 2>&1 | tail -3
pnpm --filter @possistem/security build 2>&1 | tail -3
cd apps/api && npx tsc -p tsconfig.json 2>&1 | tail -5
cd /opt/possistem-pos-control
pnpm --filter @possistem/admin-web run build 2>&1 | tail -3
pnpm --filter @possistem/owner-web run build 2>&1 | tail -3
pnpm --filter @possistem/reseller-web run build 2>&1 | tail -3
chown -R --reference=apps/api/src apps/api/dist packages/contracts/dist packages/database/dist packages/security/dist apps/admin-web/dist apps/owner-web/dist apps/reseller-web/dist 2>/dev/null || true

echo "== restart =="
systemctl restart possistem-pos-control
for i in $(seq 1 20); do curl -fsS -o /dev/null localhost:3210/pos/api/health && break; sleep 1; done
curl -fsS localhost:3210/pos/api/health; echo
echo "DONE — possistem-pos-control renamed and rebuilt"

#!/usr/bin/env bash
# Geyim POS as a third product on possistem.az. Run from this folder:
#   bash deploy-geyim-product.sh
# Uses the `pos` SSH alias (key auth). Stops at the first error.
#
# Rollback (on the VPS, as root):
#   cd /opt/possistem-pos-control
#   for f in $(find apps packages -name '*.bak-*' -newer /tmp/cp-geyim/apply-geyim-product.mjs); do cp "$f" "${f%.bak-*}"; done
#   for d in apps/api/dist packages/contracts/dist apps/admin-web/dist apps/reseller-web/dist; do rm -rf "$d" && mv "$d.bak-geyim" "$d"; done
#   systemctl restart possistem-pos-control
# The migration only widens a CHECK and can stay; the nginx snippet only adds
# /geyimpos/ locations (/var/backups/possistem/nginx-possistem.before-geyim is the old site).
set -euo pipefail
cd "$(dirname "$0")"

ssh -o BatchMode=yes pos 'rm -rf /tmp/cp-geyim && mkdir -p /tmp/cp-geyim'
scp -q apply-geyim-product.mjs migrations/0035_geyim_product.sql geyimpos.nginx.conf pos:/tmp/cp-geyim/

ssh -o BatchMode=yes pos "BASE_ERR=${BASE_ERR:-} bash -s" <<'REMOTE'
set -euo pipefail
ROOT=/opt/possistem-pos-control
cd /tmp/cp-geyim

echo "== 1/7 check (writes nothing)"
node apply-geyim-product.mjs "$ROOT" --check | tail -1
# Before any patch the live API had 4 known errors (routes/mail.ts); a rerun
# after a partial deploy must compare against that, not the patched source.
BASE_ERR=${BASE_ERR:-$(cd "$ROOT/apps/api" && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS" || true)}
echo "api type errors before: $BASE_ERR"

echo "== 2/7 backups"
mkdir -p /var/backups/possistem
DUMP=/var/backups/possistem/pos_control-before-geyim-$(date -u +%Y%m%dT%H%M%SZ).dump
(cd /tmp && sudo -u postgres pg_dump -Fc possistem_pos_control > "$DUMP")
ls -la "$DUMP"
for d in apps/api/dist apps/admin-web/dist apps/reseller-web/dist packages/contracts/dist; do
  rm -rf "$ROOT/$d.bak-geyim"
  cp -a "$ROOT/$d" "$ROOT/$d.bak-geyim"
done

echo "== 3/7 source files"
node apply-geyim-product.mjs "$ROOT" | tail -1

echo "== 4/7 migration 0035 (widens one CHECK), as the table owner"
Q() { (cd /tmp && sudo -u postgres psql -At possistem_pos_control -c "$1"); }
BEFORE=$(Q "select product||':'||count(*) from activation_keys group by product order by product" | tr '\n' ' ')
OWNER=$(Q "select tableowner from pg_tables where schemaname='public' and tablename='activation_keys'")
(cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -q possistem_pos_control -c "SET ROLE \"$OWNER\"" -f /tmp/cp-geyim/0035_geyim_product.sql)
AFTER=$(Q "select product||':'||count(*) from activation_keys group by product order by product" | tr '\n' ' ')
echo "keys before: $BEFORE / after: $AFTER"
[ "$BEFORE" = "$AFTER" ]
Q "select pg_get_constraintdef(oid) from pg_constraint where conname='activation_keys_product_check'"

echo "== 5/7 build"
cd "$ROOT"
pnpm --filter @milioner/contracts build >/dev/null
ERR=$(cd apps/api && npx tsc -p tsconfig.json 2>&1 | grep -c "error TS" || true)
echo "api type errors after: $ERR"
if [ "$ERR" -gt "$BASE_ERR" ]; then (cd apps/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | head -20); echo "NEW TYPE ERRORS - see rollback"; exit 1; fi
pnpm --filter @possistem/admin-web run build | tail -2
pnpm --filter @milioner/reseller-web run build | tail -2
chown -R --reference=apps/api/src apps/api/dist packages/contracts/dist

echo "== 6/7 feed + nginx"
mkdir -p /var/www/geyimpos/updates /var/www/geyimpos/downloads
chown -R www-data:www-data /var/www/geyimpos
install -m 644 /tmp/cp-geyim/geyimpos.nginx.conf /etc/nginx/snippets/geyimpos.conf
# sites-enabled/possistem is a plain file, and nginx loads every file in that
# folder: the backup goes to /var/backups, never next to it.
SITE=/etc/nginx/sites-enabled/possistem
if ! grep -q 'snippets/geyimpos.conf' "$SITE"; then
  cp -a "$SITE" /var/backups/possistem/nginx-possistem.before-geyim
  sed -i 's#^\(\s*\)include /etc/nginx/snippets/marketpos.conf;#&\n\1include /etc/nginx/snippets/geyimpos.conf;#' "$SITE"
fi
grep -c 'snippets/geyimpos.conf' "$SITE"
nginx -t && systemctl reload nginx

echo "== 7/7 restart"
systemctl restart possistem-pos-control
for i in $(seq 1 30); do curl -fsS -o /dev/null localhost:3210/pos/api/health && break; sleep 1; done
curl -fsS localhost:3210/pos/api/health; echo
systemctl is-active possistem-pos-control
echo "deploy ok"
REMOTE

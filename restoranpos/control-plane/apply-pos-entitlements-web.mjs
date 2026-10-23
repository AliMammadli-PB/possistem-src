#!/usr/bin/env node
/**
 * The editors follow the server's catalogue, and the admin panel gains the
 * entitlement control.
 *
 * The bundled `pos-permissions.ts` copies go: a permission list compiled into
 * the web app is stale the moment a core adds a key, and it can only ever
 * describe one product. The catalogue now travels with the policy.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) { if (!cond) throw new Error(msg); }
function backup(f) { const b = `${f}.bak-${STAMP}`; if (fs.existsSync(f) && !fs.existsSync(b)) fs.copyFileSync(f, b); }

const editor = fs.readFileSync(path.join(HERE, 'web/RolePolicyEditor.tsx'), 'utf8');
must(editor.includes('saveEntitlements'), 'the editor has no entitlement control');

for (const [app, dest] of [['owner-web', 'ui/RolePolicyEditor.tsx'], ['admin-web', 'components/RolePolicyEditor.tsx']]) {
  const file = path.join(ROOT, 'apps', app, 'src', dest);
  backup(file);
  fs.writeFileSync(file, editor);
  console.log(`  + apps/${app}/src/${dest}`);
  // The bundled catalogue is dead now; leaving it invites the next edit to
  // import it again and silently ship one product's keys to both.
  const stale = path.join(ROOT, 'apps', app, 'src/lib/pos-permissions.ts');
  if (fs.existsSync(stale)) { backup(stale); fs.rmSync(stale); console.log(`  - apps/${app}/src/lib/pos-permissions.ts`); }
}

// --- admin panel: the entitlement writer -----------------------------------
const page = path.join(ROOT, 'apps/admin-web/src/pages/CustomerLivePage.tsx');
let src = fs.readFileSync(page, 'utf8');
backup(page);
if (!src.includes('saveEntitlements=')) {
  const anchor = `        save={(roles) =>
          api(\`/customers/\${data.customer.id}/pos/roles\`, {
            method: "PUT",
            body: JSON.stringify({ roles }),
          })
        }`;
  must(src.split(anchor).length - 1 === 1, 'CustomerLivePage save anchor not unique');
  src = src.replace(anchor, `${anchor}
        saveEntitlements={(input) =>
          api(\`/customers/\${data.customer.id}/pos/entitlements\`, {
            method: "PUT",
            body: JSON.stringify(input),
          })
        }`);
  fs.writeFileSync(page, src);
  console.log('  + CustomerLivePage entitlement writer');
} else {
  console.log('  = CustomerLivePage entitlement writer');
}

const final = fs.readFileSync(page, 'utf8');
must(final.includes('pos/entitlements'), 'the admin panel cannot write entitlements');
// The customer portal must never gain one.
const owner = fs.readFileSync(path.join(ROOT, 'apps/owner-web/src/pages/StaffRolesPage.tsx'), 'utf8');
must(!owner.includes('saveEntitlements'), 'the customer portal can write its own entitlements');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);

#!/usr/bin/env node
/**
 * The two editors gain a product switch, so market staff can be given
 * permissions from the website at all.
 *
 * Both editors called `/…/pos/roles` with no product, which the server reads as
 * restaurant - so the market policy the till now pulls had no screen that could
 * write it. The server says which products a customer is licensed for; the
 * switch appears only when there is more than one, rather than offering a
 * Market tab to a restaurant.
 *
 * Runs on the VPS against /opt/possistem-pos-control, a deployed directory
 * rather than a git checkout: every file is backed up beside itself and every
 * edit converges on a second run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) { if (!cond) throw new Error(msg); }
function backup(f) { const b = `${f}.bak-${STAMP}`; if (fs.existsSync(f) && !fs.existsSync(b)) fs.copyFileSync(f, b); }

// --- the editor, to both apps ---------------------------------------------
const editor = fs.readFileSync(path.join(HERE, 'web/RolePolicyEditor.tsx'), 'utf8');
must(editor.includes('PRODUCT_LABEL'), 'this editor has no product switch');
must(editor.includes('load(product)'), 'the editor does not pass the product to load');

for (const [app, dest] of [['owner-web', 'ui/RolePolicyEditor.tsx'], ['admin-web', 'components/RolePolicyEditor.tsx']]) {
  const file = path.join(ROOT, 'apps', app, 'src', dest);
  backup(file);
  fs.writeFileSync(file, editor);
  console.log(`  + apps/${app}/src/${dest}`);
}

// --- owner portal: the customer's own staff -------------------------------
const api = path.join(ROOT, 'apps/owner-web/src/api.ts');
let apiSrc = fs.readFileSync(api, 'utf8');
backup(api);
if (!apiSrc.includes('product: PosProduct')) {
  const old = `/** Staff roles and permissions the tills pull on their heartbeat. */
export function getRolePolicy() {
  return request<RolePolicy>('/customer/pos/roles');
}

export function saveRolePolicy(roles: RolePolicyRole[]) {
  return request<RolePolicy>('/customer/pos/roles', {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  });
}`;
  must(apiSrc.split(old).length - 1 === 1, 'owner api role functions not found');
  apiSrc = apiSrc.replace(old, `export type PosProduct = 'restaurant' | 'market';

/**
 * Staff roles and permissions the tills pull on their heartbeat.
 *
 * Per product: the two tills check different permission vocabularies, so one
 * policy cannot serve both.
 */
export function getRolePolicy(product: PosProduct = 'restaurant') {
  return request<RolePolicy>(\`/customer/pos/roles?product=\${product}\`);
}

export function saveRolePolicy(roles: RolePolicyRole[], product: PosProduct = 'restaurant') {
  return request<RolePolicy>(\`/customer/pos/roles?product=\${product}\`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  });
}`);
  fs.writeFileSync(api, apiSrc);
  console.log('  + owner-web api: product-aware role calls');
} else {
  console.log('  = owner-web api');
}

// --- admin panel: any customer's staff, and what they were sold ------------
const page = path.join(ROOT, 'apps/admin-web/src/pages/CustomerLivePage.tsx');
let pageSrc = fs.readFileSync(page, 'utf8');
backup(page);
if (!pageSrc.includes('pos/roles?product=')) {
  const old = `        load={() => api(\`/customers/\${data.customer.id}/pos/roles\`)}
        save={(roles) =>
          api(\`/customers/\${data.customer.id}/pos/roles\`, {
            method: "PUT",
            body: JSON.stringify({ roles }),
          })
        }
        saveEntitlements={(input) =>
          api(\`/customers/\${data.customer.id}/pos/entitlements\`, {
            method: "PUT",
            body: JSON.stringify(input),
          })
        }`;
  must(pageSrc.split(old).length - 1 === 1, 'CustomerLivePage editor wiring not found');
  pageSrc = pageSrc.replace(old, `        load={(product) =>
          api(\`/customers/\${data.customer.id}/pos/roles?product=\${product}\`)
        }
        save={(roles, product) =>
          api(\`/customers/\${data.customer.id}/pos/roles?product=\${product}\`, {
            method: "PUT",
            body: JSON.stringify({ roles }),
          })
        }
        saveEntitlements={(input, product) =>
          api(\`/customers/\${data.customer.id}/pos/entitlements?product=\${product}\`, {
            method: "PUT",
            body: JSON.stringify(input),
          })
        }`);
  fs.writeFileSync(page, pageSrc);
  console.log('  + CustomerLivePage: product-aware role calls');
} else {
  console.log('  = CustomerLivePage');
}

// --- checks ---------------------------------------------------------------
const finalPage = fs.readFileSync(page, 'utf8');
must(finalPage.includes('pos/entitlements?product='), 'the admin panel writes entitlements without a product');
must((finalPage.match(/pos\/roles\?product=/g) ?? []).length === 2, 'the admin role calls are not both product-aware');

const finalApi = fs.readFileSync(api, 'utf8');
must((finalApi.match(/customer\/pos\/roles\?product=/g) ?? []).length === 2, 'the owner role calls are not both product-aware');

// The customer portal must still never gain an entitlement writer: what they
// were sold is ours to set.
const owner = fs.readFileSync(path.join(ROOT, 'apps/owner-web/src/pages/StaffRolesPage.tsx'), 'utf8');
must(!owner.includes('saveEntitlements'), 'the customer portal can write its own entitlements');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);

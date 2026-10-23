#!/usr/bin/env node
/**
 * Puts the role editor into both web apps.
 *
 * The customer's own portal gets a page of its own; the admin panel mounts the
 * same component inside the customer it has already selected, because "pick the
 * restaurant, then set their permissions" is one flow, not two screens.
 *
 * Same rules as apply-pos-roles.mjs: back up, insert only, converge on re-run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function backup(file) {
  const bak = `${file}.bak-${STAMP}`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}
function insertOnce(src, anchor, addition, label, marker) {
  if (src.includes(marker)) {
    console.log(`  = ${label}`);
    return src;
  }
  const n = src.split(anchor).length - 1;
  must(n === 1, `${label}: expected 1 anchor, found ${n}`);
  console.log(`  + ${label}`);
  return src.replace(anchor, addition + anchor);
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file);
  fs.writeFileSync(file, body);
  console.log(`  + ${path.relative(ROOT, file)}`);
}

const catalogue = fs.readFileSync(path.join(HERE, 'web/pos-permissions.ts'), 'utf8');
const editor = fs.readFileSync(path.join(HERE, 'web/RolePolicyEditor.tsx'), 'utf8');

// ---------------------------------------------------------------- owner-web
console.log('owner-web');
const OW = path.join(ROOT, 'apps/owner-web/src');
write(path.join(OW, 'lib/pos-permissions.ts'), catalogue);
write(path.join(OW, 'ui/RolePolicyEditor.tsx'), editor.replace("'./pos-permissions'", "'../lib/pos-permissions'"));

write(path.join(OW, 'pages/StaffRolesPage.tsx'), `import { RolePolicyEditor } from '../ui/RolePolicyEditor';
import { getRolePolicy, saveRolePolicy } from '../api';

/** The owner setting what their own staff may do, from anywhere. */
export function StaffRolesPage() {
  return <RolePolicyEditor load={getRolePolicy} save={saveRolePolicy} />;
}

export default StaffRolesPage;
`);

const owApi = path.join(OW, 'api.ts');
let api = fs.readFileSync(owApi, 'utf8');
backup(owApi);
if (!api.includes('getRolePolicy')) {
  api += `
export type RolePolicyRole = { name: string; permissions: string[] };
export type RolePolicy = {
  roles: RolePolicyRole[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
};

/** Staff roles and permissions the tills pull on their heartbeat. */
export function getRolePolicy() {
  return request<RolePolicy>('/customer/pos/roles');
}

export function saveRolePolicy(roles: RolePolicyRole[]) {
  return request<RolePolicy>('/customer/pos/roles', {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  });
}
`;
  fs.writeFileSync(owApi, api);
  console.log('  + api.ts role policy calls');
} else {
  console.log('  = api.ts role policy calls');
}

const owApp = path.join(OW, 'App.tsx');
let app = fs.readFileSync(owApp, 'utf8');
backup(owApp);
app = insertOnce(
  app,
  "import { Navigate, Route, Routes, useLocation } from 'react-router-dom';",
  "import { StaffRolesPage } from './pages/StaffRolesPage';\n",
  'App.tsx import',
  "from './pages/StaffRolesPage'",
);
app = insertOnce(
  app,
  "          <Route path=\"/support\"",
  "          <Route path=\"/staff\" element={isMarketPortal ? <Navigate to=\"/\" replace /> : <ProtectedShell><StaffRolesPage /></ProtectedShell>} />\n",
  'App.tsx route',
  'path="/staff"',
);
fs.writeFileSync(owApp, app);

const owShell = path.join(OW, 'ui/AppShell.tsx');
let shell = fs.readFileSync(owShell, 'utf8');
backup(owShell);
shell = insertOnce(
  shell,
  "  { to: '/integrations', label: 'İnteqrasiyalar', icon: 'integrations' },",
  "  { to: '/staff', label: 'İşçilər', icon: 'settings' },\n",
  'AppShell nav',
  "to: '/staff'",
);
shell = insertOnce(
  shell,
  "  '/settings/profile': 'Profil parametrləri',",
  "  '/staff': 'İşçi rolları və səlahiyyətləri',\n",
  'AppShell title',
  "'/staff':",
);
fs.writeFileSync(owShell, shell);

// ---------------------------------------------------------------- admin-web
console.log('admin-web');
const AW = path.join(ROOT, 'apps/admin-web/src');
write(path.join(AW, 'lib/pos-permissions.ts'), catalogue);
write(
  path.join(AW, 'components/RolePolicyEditor.tsx'),
  editor.replace("'./pos-permissions'", "'../lib/pos-permissions'"),
);

const awPage = path.join(AW, 'pages/CustomerLivePage.tsx');
let page = fs.readFileSync(awPage, 'utf8');
backup(awPage);
page = insertOnce(
  page,
  'import { useI18n } from "../i18n";',
  'import { RolePolicyEditor } from "../components/RolePolicyEditor";\n',
  'CustomerLivePage import',
  'RolePolicyEditor',
);
// Mounted right before the "refreshed at" footer, so support sees the shop's
// live state first and its permissions underneath.
page = insertOnce(
  page,
  '      <p className="muted" style={{ marginTop: "1rem" }}>',
  `      <RolePolicyEditor
        subtitle={data.customer.name}
        load={() => api(\`/customers/\${data.customer.id}/pos/roles\`)}
        save={(roles) =>
          api(\`/customers/\${data.customer.id}/pos/roles\`, {
            method: "PUT",
            body: JSON.stringify({ roles }),
          })
        }
      />

`,
  'CustomerLivePage editor',
  '<RolePolicyEditor',
);
fs.writeFileSync(awPage, page);

// Prove it, rather than trusting the writes.
must(fs.readFileSync(owApp, 'utf8').includes('path="/staff"'), 'owner route missing');
must(fs.readFileSync(owShell, 'utf8').includes("to: '/staff'"), 'owner nav missing');
must(fs.readFileSync(owApi, 'utf8').includes('/customer/pos/roles'), 'owner api missing');
must(fs.readFileSync(awPage, 'utf8').includes('<RolePolicyEditor'), 'admin editor missing');
must(fs.existsSync(path.join(OW, 'lib/pos-permissions.ts')), 'owner catalogue missing');
must(fs.existsSync(path.join(AW, 'lib/pos-permissions.ts')), 'admin catalogue missing');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);

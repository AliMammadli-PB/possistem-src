import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(path.join(root, 'index-DAmHwBc4.js'), 'utf8');
const main = readFileSync(path.join(root, 'index.js'), 'utf8');
const checks = [
  ['SettingsAccordion', bundle.includes('function SettingsAccordion')],
  ['accordion defaultOpen', bundle.includes('defaultOpen: id === "restaurant"')],
  ['AdminHubPage', bundle.includes('function AdminHubPage')],
  ['isFloorPath', bundle.includes('function isFloorPath')],
  ['/admin route', bundle.includes('path: "/admin"')],
  ['deviceHint', bundle.includes('deviceHint')],
  ['no admin tile dump', !bundle.includes('adminLinks.length > 0 &&')],
  ['AZ credentials', bundle.includes('Email və ya parol səhvdir')],
  ['zone copy', bundle.includes('Zalı redaktə et')],
  ['formatTillDate', bundle.includes('function formatTillDate')],
  ['license details', bundle.includes('showLicenseDetails')],
  ['reset danger', bundle.includes('runOperationalReset')],
  ['catalog drawer', bundle.includes('editorOpen')],
  ['catalog list-first page', bundle.includes('ps-catalog-page')],
  ['catalog search', bundle.includes('productQuery')],
  ['catalog overflow menu', bundle.includes('openMenu')],
  ['catalog locales disclosure', bundle.includes('Digər dillər / Ətraflı')],
  ['ps-shell', bundle.includes('ps-shell')],
  ['ps-settings-page', bundle.includes('ps-settings-page')],
  ['brand path', bundle.includes('const brandMark = "./assets/brands/logo.png"')],
  ['i18n possistem', (bundle.match(/brand: "possistem"/g) || []).length === 3],
  ['no Milioner Pub', !bundle.includes('Milioner Pub & Lounge')],
  ['no PUB & LOUNGE', !bundle.includes('PUB & LOUNGE')],
  ['no Milioner alt', !bundle.includes('alt: "Milioner"')],
  ['tenant gate', bundle.includes('ps-rest-gate') && bundle.includes('ps-rest-gate-grid') && bundle.includes('ps-rest-gate-card')],
  ['tenant two-col brand', bundle.includes('ps-rest-gate-brand') && bundle.includes('ps-rest-gate-rule')],
  ['login photo assets', bundle.includes('ps-rest-gate-photo') && bundle.includes('ps-rest-staff-photo') && bundle.includes('loginBackground')],
  ['login left chrome', bundle.includes('ps-rest-gate-wordmark') && bundle.includes('ps-rest-gate-secure')],
  ['remember-me default on', bundle.includes('setRememberMe] = reactExports.useState(true)')],
  ['tenant login routes home', bundle.includes('navigate("/", { replace: true })')],
  ['tenant status honors persist', main.includes('n&&(Ue=!0)') && !main.includes('!n||!Ue')],
  ['staff session persist', main.includes('_psLoadStaff') && main.includes('_psSaveStaff')],
  ['startup fullscreen', main.includes('fullscreen:!0') && main.includes('e.setFullScreen(!0)')],
  ['tenantOk retry safe', bundle.includes('if (decision === "pass") setTenantOk(true)')],
  ['staff rest shell', bundle.includes('ps-rest-staff') && bundle.includes('ps-rest-staff-card')],
  ['no MarketPos class collision', !bundle.includes('ps-login-staff') && !bundle.includes('ps-login-tenant')],
  ['no MarketPos strings', !bundle.includes('MarketPos') && !bundle.includes('Sahibkar') && !bundle.includes('MARKET & RETAIL')],
  ['admin NavLink end', bundle.includes('end: to === "/admin"')],
  ['calm rail', bundle.includes('{ to: "/admin", label: t.nav.admin, icon: LayoutDashboard, show: canAdmin }') && !bundle.includes('{ to: "/admin/catalog", label: t.nav.catalog, icon: Utensils, show: !floorMode')],
  ['catalog thead', bundle.includes('ps-catalog-thead')],
  ['catalog price col', bundle.includes('ps-catalog-price')],
  ['catalog reorder', bundle.includes('dropProduct') && bundle.includes('ps-catalog-ord') && bundle.includes('void moveProduct(product.id, -1)')],
  ['catalog persist all sortOrder', bundle.includes('persistCategoryList') && !bundle.includes('(row.sortOrder ?? next) === next')],
  ['receipt mock', bundle.includes('function buildReceiptMockHtml') && bundle.includes('Nümunə restoran')],
  ['receipt paper ticket', bundle.includes('ps-receipt-ticket') && bundle.includes('if (!html || !receiptHtmlLooksUseful(html)) html = buildReceiptMockHtml(meta);')],
  ['receipt strip imgs', bundle.includes('function stripReceiptImages') && bundle.includes('img,canvas{display:none!important}')],
  ['receipt no iframe srcdoc', !bundle.includes('className: "ps-receipt-frame", srcDoc: previewHtml')],
  ['RoleEmblem no brand mark', !/function RoleEmblem[\s\S]{0,900}brandMark/.test(bundle) && bundle.includes('ps-staff-initials')],
  ['staff brand blue tile', /ps-rest-staff-brand[\s\S]{0,700}ps-brand-lockup--tile/.test(bundle)],
  ['PIN identity no brand tile', !/ps-staff-identity-card[\s\S]{0,400}brandMark/.test(bundle) && !/ps-staff-identity-card[\s\S]{0,400}ps-brand-lockup/.test(bundle)],
  ['staff picker + pin chrome', bundle.includes('ps-staff-pick') && bundle.includes('ps-staff-pin') && bundle.includes('ps-staff-identity-card')],
  ['pin submit feedback', bundle.includes('setPinPhase("ok")') && bundle.includes('setPinPhase("busy")')],
  ['pin onSession login hold', bundle.includes('includes("login")') && bundle.includes(', 480)')],
  ['pin submit delays setSession', bundle.includes('await new Promise((done) => window.setTimeout(done, 420));\n    setSession({ ...session, authenticated: true })')],
  ['no blanket PIN fill css', !/\[aria-label\*=["']\/ 4["']\]\s*>\s*span/.test(readFileSync(path.join(root, 'possistem-system.css'), 'utf8'))],
  ['staff-session hardened write', main.includes('e.session??e.data??e') && main.includes('ss(C.data)||ss(C)') && main.includes('if(r&&r.length)p.writeFileSync(t,r)')],
  ['receipt modal', bundle.includes('ps-receipt-layer')],
  ['settings full width', bundle.includes('ps-settings-stack w-full') && !bundle.includes('max-w-2xl space-y-3 p-6')],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('FAILED', failed);
  process.exit(1);
}
console.log('ok', checks.length, 'checks');

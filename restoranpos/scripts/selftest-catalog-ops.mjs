#!/usr/bin/env node
/** Invariants for catalog reorder + till session/fullscreen (no Electron). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(path.join(root, 'index-DAmHwBc4.js'), 'utf8');
const main = readFileSync(path.join(root, 'index.js'), 'utf8');
const css = readFileSync(path.join(root, 'possistem-system.css'), 'utf8');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function reorder(list, fromId, toId) {
  const next = list.slice();
  const from = next.findIndex((row) => row.id === fromId);
  const to = next.findIndex((row) => row.id === toId);
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next.map((item, i) => ({ ...item, sortOrder: i + 1 }));
}

const products = [
  { id: 'a', sortOrder: 1 },
  { id: 'b', sortOrder: 2 },
  { id: 'c', sortOrder: 3 },
  { id: 'd', sortOrder: 4 },
];
const dropped = reorder(products, 'd', 'a');
must(dropped.map((p) => p.id).join() === 'd,a,b,c', 'drop d onto a');
must(dropped.every((p, i) => p.sortOrder === i + 1), 'contiguous sortOrder after drop');

const moved = reorder(dropped, 'd', 'a');
must(moved.map((p) => p.id).join() === 'a,d,b,c', 'shift first item down via drop onto neighbor');

must(css.includes('.ps-catalog-toolbar .ps-catalog-new-btn'), 'new-btn rule');
must(css.includes('margin-left: auto'), 'add button pushed right');
must(/\.ps-catalog-toolbar \.ps-catalog-search[\s\S]{0,80}max-width:\s*20rem/.test(css), 'search capped');
must(css.includes('backdrop-filter: blur(14px)'), 'glass blur');
must(!/background:\s*#fff;\s*\n\s*backdrop-filter/.test(css), 'no solid white glass card');

must(main.includes('n&&(Ue=!0)'), 'tenant persist honored');
must(!main.includes('!n||!Ue'), 'tenant status no longer requires in-memory flag');
must(main.includes('_psLoadStaff') && main.includes('_psSaveStaff'), 'staff session persist');
must(main.includes('fullscreen:!0') && main.includes('e.setFullScreen(!0)'), 'startup fullscreen');
must(bundle.includes('persistCategoryList') && bundle.includes('dropProduct'), 'catalog persist APIs');
must(bundle.includes('navigate("/", { replace: true })'), 'post-login home');
must(bundle.includes('setRememberMe] = reactExports.useState(true)'), 'remember me on');

must(css.includes('.ps-rest-staff h3') && css.includes('color: #f8fafc !important'), 'staff titles forced light');
must(css.includes('.ps-rest-staff .pin-key'), 'staff keypad styles');
must(css.includes('.ps-receipt-ticket') && css.includes('background: #f8f4ea'), 'paper receipt ticket');
must(css.includes('.ps-rest-staff-brand .ps-brand-lockup--tile'), 'staff brand tile rule');
must(css.includes('.ps-rest-staff-brand .ps-brand-lockup--tile') && css.includes('background: #0a4f9c !important'), 'staff brand blue plate');
must(css.includes('.ps-rest-staff-card .ps-brand-lockup'), 'staff card tiles hidden');
must(css.includes('.ps-staff-identity img'), 'PIN identity imgs hidden');
must(css.includes('.ps-staff-initials'), 'initials avatar rule');
must(css.includes('.ps-staff-pick') && css.includes('.ps-staff-pad'), 'staff picker + pin chrome');
must(!/\[aria-label\*=["']\/ 4["']\]\s*>\s*span/.test(css), 'no blanket PIN aria-label fill');
must(!/\[aria-label\*=["']\/ 4["']\][^\{]\{[^}]*#93c5fd/.test(css), 'no forced #93c5fd on every PIN slot');
must(css.includes('.ps-staff-pin-cell.is-on') && css.includes('.ps-staff-pin-dots.is-busy'), 'pin fill + busy chrome');
must(bundle.includes('setPinPhase("ok")') && bundle.includes('setPinPhase("busy")'), 'pin submit feedback');
must(bundle.includes('includes("login")') && bundle.includes(', 480)'), 'onSession login hold');
must(bundle.includes('await new Promise((done) => window.setTimeout(done, 420));\n    setSession({ ...session, authenticated: true })'), 'submit delays setSession');
{
  const after = html.slice(Math.max(0, html.toLowerCase().lastIndexOf('</html>')));
  must(!after.includes('/*'), 'index.html must not use JS comments after </html>');
}
must(main.includes('e.session??e.data??e') && main.includes('if(r&&r.length)p.writeFileSync(t,r)'), 'staff-session write hardened');
must(bundle.includes('ps-receipt-ticket') && bundle.includes('Nümunə restoran'), 'in-DOM ticket');
must(bundle.includes('if (!html || !receiptHtmlLooksUseful(html)) html = buildReceiptMockHtml(meta);'), 'mock if API junk');
must(bundle.includes('img,canvas{display:none!important}'), 'paperize hides imgs');
must(!/function RoleEmblem[\s\S]{0,900}brandMark/.test(bundle), 'RoleEmblem never uses brand logo');
must(bundle.includes('ps-staff-initials'), 'staff initials avatar');
must(/ps-rest-staff-brand[\s\S]{0,700}ps-brand-lockup--tile/.test(bundle), 'staff brand tile in left hero jsx');
must(!/ps-staff-identity-card[\s\S]{0,400}brandMark/.test(bundle), 'PIN identity has no brandMark');
must(!/ps-staff-identity-card[\s\S]{0,400}ps-brand-lockup/.test(bundle), 'PIN identity has no brand lockup');
must(bundle.includes('ps-staff-pick') && bundle.includes('ps-staff-pin') && bundle.includes('ps-staff-identity-card'), 'staff chrome hooks');
must(!bundle.includes('className: "ps-receipt-frame", srcDoc: previewHtml'), 'no srcdoc iframe');

function receiptHtmlLooksUseful(html) {
  const raw = String(html || '').replace(/<img\b[^>]*>/gi, ' ');
  const text = raw.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 20) return false;
  if (/loqo|logo|possistem/i.test(text) && !/[₼]|Cəmi|Total/i.test(text)) return false;
  if (/^[\d\s·.•mm×xsütun]+$/i.test(text)) return false;
  const hasMoney = /[₼]|\d+[.,]\d{2}/.test(text);
  const hasTotal = /Cəmi|Total|Yekun/i.test(text);
  const hasRow = /Club Sandwich|Kartof|Çay|məhsul|Sandwich|Fri/i.test(text);
  return hasMoney && hasTotal && hasRow;
}
must(!receiptHtmlLooksUseful('<img alt="Restoran loqosu" src="x"><div>80 mm · 40 sütun</div>'), 'logo-only rejected');
must(!receiptHtmlLooksUseful('possistem Restoran POS'), 'brand letters rejected');
must(receiptHtmlLooksUseful('<div>Club Sandwich 9.00 ₼ Cəmi 15.50 ₼</div>'), 'real ticket accepted');

console.log('selftest-catalog-ops ok');

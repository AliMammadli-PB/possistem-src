#!/usr/bin/env node
/**
 * The dashboard half of the version spread: which builds are in the field.
 *
 * Deployed separately from the API change so the panel can be rebuilt without
 * touching the server, and guarded so a second run is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const SRC = path.join(ROOT, 'apps/admin-web/src');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) { if (!cond) throw new Error(msg); }
function backup(f) { const b = `${f}.bak-${STAMP}`; if (fs.existsSync(f) && !fs.existsSync(b)) fs.copyFileSync(f, b); }

const page = path.join(SRC, 'pages/DashboardPage.tsx');
backup(page);
fs.copyFileSync(path.join(HERE, 'admin-web/DashboardPage.tsx'), page);
console.log('  + src/pages/DashboardPage.tsx');

// --- the words --------------------------------------------------------------
const words = path.join(SRC, 'i18n/az.ts');
let src = fs.readFileSync(words, 'utf8');
if (!src.includes('colVersion')) {
  backup(words);
  const anchor = "    recentEmpty: 'Bu məhsul üzrə hələ müştəri yoxdur.',";
  must(src.split(anchor).length - 1 === 1, 'recentEmpty anchor not unique');
  src = src.replace(
    anchor,
    `${anchor}
    behind: (n: number) => \`\${n} kassa köhnə versiyadadır\`,
    colVersion: 'Versiya',
    colTills: 'Kassa',
    colLastSeen: 'Son əlaqə',`,
  );
  fs.writeFileSync(words, src);
  console.log('  + i18n: version spread labels');
} else {
  console.log('  = i18n');
}

// --- the look ---------------------------------------------------------------
const css = path.join(SRC, 'styles.css');
let sheet = fs.readFileSync(css, 'utf8');
if (!sheet.includes('.release-behind')) {
  backup(css);
  sheet += `
/* A till behind the published build is a warning, not a statistic. */
.release-behind {
  margin-left: auto; padding: .15rem .5rem; border-radius: 999px;
  background: rgba(245, 158, 11, .14); color: var(--warn); font-size: .7rem;
}
.version-current { color: var(--ok); }
`;
  fs.writeFileSync(css, sheet);
  console.log('  + styles: behind badge');
} else {
  console.log('  = styles');
}

const final = fs.readFileSync(page, 'utf8');
must(final.includes('scoped.versions.map'), 'the spread table did not land');
must(final.includes('t.dashboard.behind('), 'the behind badge is missing');
must(fs.readFileSync(words, 'utf8').includes('colLastSeen'), 'labels missing');
console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);

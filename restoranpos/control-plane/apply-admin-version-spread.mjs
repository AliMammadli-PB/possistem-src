#!/usr/bin/env node
/**
 * Shows which version the tills in the field are actually running.
 *
 * The panel publishes an installer and every till updates from that feed, so
 * "are the site and the app in step" is a real question with a real answer -
 * and nothing in the panel asked it. The database knows: every heartbeat
 * stamps `devices.app_version`, and today the spread reads 1.3.1, 1.4.2 and
 * 1.4.4 against a feed serving 1.4.5. A till two minor versions behind is not
 * running the product anyone here is testing or supporting.
 *
 * Reported as a list rather than a single "up to date" flag, because the
 * interesting case is a till nobody has touched in months, and a flag hides it.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const FILE = path.join(ROOT, 'apps/api/src/routes/misc.ts');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) { if (!cond) throw new Error(msg); }

let src = fs.readFileSync(FILE, 'utf8');
if (src.includes('versionSpread')) {
  console.log('= version spread already reported');
  process.exit(0);
}
fs.copyFileSync(FILE, `${FILE}.bak-${STAMP}`);

const anchor = `  // What the update feed is actually serving.`;
must(src.split(anchor).length - 1 === 1, 'release anchor not unique');
src = src.replace(
  anchor,
  `  // One row per version actually installed, newest contact first. A till that
  // last spoke in August still counts: it is the one most likely to surprise
  // somebody, and averaging it away is how it stays forgotten.
  const versionSpread = await app.db
    .select({
      version: devices.appVersion,
      count: sql<number>\`count(*)::int\`,
      lastSeenAt: sql<Date | null>\`max(\${devices.lastSeenAt})\`,
    })
    .from(devices)
    .innerJoin(licenses, eq(licenses.id, devices.licenseId))
    .where(sql\`\${devices.status} <> 'revoked' and \${ofProduct}\`)
    .groupBy(devices.appVersion)
    .orderBy(sql\`max(\${devices.lastSeenAt}) desc nulls last\`);

${anchor}`,
);

const returnAnchor = `    release,
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),`;
must(src.split(returnAnchor).length - 1 === 1, 'scoped return anchor not unique');
src = src.replace(
  returnAnchor,
  `    release,
    versions: versionSpread.map((row) => ({
      version: row.version ?? '—',
      count: row.count,
      lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
      // Compared as text: these are our own build numbers, and a till reporting
      // anything else is exactly the case worth showing rather than ranking.
      current: Boolean(release && row.version === release.version),
    })),
    behind: versionSpread.reduce(
      (sum, row) => sum + (release && row.version === release.version ? 0 : row.count),
      0,
    ),
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),`,
);

fs.writeFileSync(FILE, src);
const final = fs.readFileSync(FILE, 'utf8');
must(final.includes('const versionSpread'), 'the spread query did not land');
must(final.includes('behind:'), 'the behind count is missing');
// `release` is resolved before the spread is mapped, or every till reads as behind.
must(final.indexOf('let release') < final.indexOf('versions: versionSpread.map'),
     'the spread is mapped before the release is known');
console.log(`+ version spread added. backup: ${path.basename(FILE)}.bak-${STAMP}`);

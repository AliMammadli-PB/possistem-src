#!/usr/bin/env node
/**
 * Branch details in Settings.
 *
 * A chain prints the same restaurant name on every receipt, so the branch is
 * what tells a guest - and a head office reading a returned receipt or a CSV -
 * which shop it came from.
 *
 * Deliberately identity, not partitioning: each till runs one branch against
 * its own database, so there is nothing for a query to filter on. Making every
 * query branch-aware would add a column and a join to the whole schema to
 * express something that is already true by construction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_BRANCH_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

s = replaceOnce(
  s,
  `  { key: "restaurant.hours", max: 60 }
];`,
  `  { key: "restaurant.hours", max: 60 },
  { key: "branch.name", max: 120 },
  { key: "branch.code", max: 40 },
  { key: "branch.address", max: 200 },
  { key: "branch.phone", max: 60 }
];`,
  'branch fields',
);

s = replaceOnce(
  s,
  `  "restaurant.hours": ""
};`,
  `  "restaurant.hours": "",
  "branch.name": "",
  "branch.code": "",
  "branch.address": "",
  "branch.phone": ""
};`,
  'branch empty values',
);

const labels = [
  ['"restaurant.hours": "İş saatı"', '"branch.name": "Filial adı",\n      "branch.code": "Filial kodu",\n      "branch.address": "Filial ünvanı",\n      "branch.phone": "Filial telefonu"'],
  ['"restaurant.hours": "Opening hours"', '"branch.name": "Branch name",\n      "branch.code": "Branch code",\n      "branch.address": "Branch address",\n      "branch.phone": "Branch phone"'],
  ['"restaurant.hours": "Çalışma saatleri"', '"branch.name": "Şube adı",\n      "branch.code": "Şube kodu",\n      "branch.address": "Şube adresi",\n      "branch.phone": "Şube telefonu"'],
];
for (const [anchor, added] of labels) {
  if (s.includes(anchor)) s = replaceOnce(s, anchor, `${anchor},\n      ${added}`, `labels ${anchor}`);
}

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('key: "branch.name"'), 'branch field missing');
must(s.includes('"branch.name": "Filial adı"'), 'branch label missing');

console.log('patched', BUNDLE);

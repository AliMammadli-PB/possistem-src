#!/usr/bin/env node
/**
 * Stops the chat bot calling a two-day-old snapshot "canlı".
 *
 * The X report told an owner "Bu rəqəmlər canlı bazadan alındı" while two lines
 * above warning that the till was offline. `live` in the code means "read from
 * the mirror rather than a printed receipt" - not "fresh". With the till's sync
 * rejected for two days the mirror said 149 AZN across three tables while the
 * till itself showed 304 across five, and the report presented the stale figure
 * as live.
 *
 * The numbers are not wrong to show; claiming they are current is.
 */
import fs from 'node:fs';
const F = (process.argv[2] || '/opt/possistem-pos-control') + '/apps/api/src/lib/bot/format.ts';
const OLD = "    lines.push('', '_Bu rəqəmlər canlı bazadan alındı — kassada çek çap olunmayıb._');";
const NEW = "    lines.push(\n      '',\n      '_Bu rəqəmlər serverdəki nüsxədən alındı — kassada çek çap olunmayıb._',\n      '_Kassa oflayndırsa, nüsxə son bağlantı anındakı vəziyyəti göstərir._',\n    );";
let s = fs.readFileSync(F, 'utf8');
if (s.includes('serverdəki nüsxədən')) { console.log('already applied'); process.exit(0); }
if (s.split(OLD).length - 1 !== 1) { throw new Error('anchor not unique'); }
const bak = `${F}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(F, bak);
fs.writeFileSync(F, s.replace(OLD, NEW));
const out = fs.readFileSync(F, 'utf8');
if (!out.includes('serverdəki nüsxədən')) throw new Error('not applied');
if (out.includes('canlı bazadan alındı')) throw new Error('old claim survived');
console.log('patched, backup:', bak.split('/').pop());

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

// A new computer restores the account's cloud backup by itself; the till also backs up at day close and on quit.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edit = (file, mark, apply) => {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(mark)) return;
  const replace = (old, next) => {
    if (s.split(old).length !== 2) throw Error(path.basename(file) + ' anchor changed: ' + old.slice(0, 90));
    s = s.replace(old, () => next);
  };
  apply(replace, () => s, v => { s = v; });
  fs.writeFileSync(file, s);
};

// An earlier patch can drop the tail of index.js, so each edit here carries its own guard.
{
  const file = root + '/index.js';
  let s = fs.readFileSync(file, 'utf8');
  const once = (old, next) => {
    if (s.includes(next)) return;
    if (s.split(old).length !== 2) throw Error('index.js anchor changed: ' + old.slice(0, 90));
    s = s.replace(old, () => next);
  };
  const methods = '"backup.cloudList":{auth:!0,perm:"backup.manage",timeout:35000,idempotent:!1},"backup.cloudFetch":{auth:!0,perm:"backup.manage",timeout:660000,idempotent:!1},';
  once('"backup.cloudNow":{auth:!0,perm:"backup.manage",timeout:180000,idempotent:!1},', '"backup.cloudNow":{auth:!0,perm:"backup.manage",timeout:180000,idempotent:!1},' + methods);
  once('if(e==="print.xprinterFirewall")', 'if(e==="backup.cloudList")return _psCloudList();if(e==="backup.cloudFetch")return _psCloudFetch(t);if(e==="print.xprinterFirewall")');
  // Day close: the evening's sales reach the server tonight, not six hours later.
  once('else if(s==="reports.z"||s==="businessDay.close"){', 'else if(s==="reports.z"||s==="businessDay.close"){setTimeout(()=>void _psFullBackup().tick(true),3000);');
  // Quit: one more copy while the core still runs, at most 20 seconds.
  once('fn(),A.shutdown().finally(', 'fn(),_psBackupBeforeQuit().then(()=>A.shutdown()).finally(');
  if (!s.includes('/* CLOUD_RESTORE_1108 */')) s += `
/* CLOUD_RESTORE_1108 */
async function _psCloudList(){try{return y(await _psFullBackup().available());}catch(x){return d("E_INTERNAL",x instanceof Error?x.message:"BACKUP_LIST_FAILED");}}
async function _psCloudFetch(t){const dir=m.join(m.dirname(Me()),"backups");p.mkdirSync(dir,{recursive:!0});const dest=m.join(dir,"pos-cloud-"+Date.now()+".db");
 try{await _psFullBackup().fetchBackup(String(t?.backupId||""),dest,Ht());}catch(x){try{p.unlinkSync(dest)}catch{}return d("E_INTERNAL",x instanceof Error?x.message:"BACKUP_FETCH_FAILED");}
 const res=await b("backup.import",{path:dest,note:"Buluddan yüklənib"},6e4);if(!res.success)try{p.unlinkSync(dest)}catch{}return res;}
function _psBackupBeforeQuit(){const run=_psFullBackup().status().then(s=>["terminal","disabled","not_activated","uploading"].includes(s.status)||(s.lastSuccessAt&&Date.now()-Date.parse(s.lastSuccessAt)<10*60000)?null:_psFullBackup().tick(true));
 return Promise.race([run,new Promise(r=>setTimeout(r,20000))]).catch(()=>{});}
`;
  fs.writeFileSync(file, s);
}

edit(root + '/out/preload/index.js', 'cloudFetch:', replace => {
  replace('    cloudNow: () => call("backup.cloudNow", {}),\n',
    '    cloudNow: () => call("backup.cloudNow", {}),\n    cloudList: () => call("backup.cloudList", {}),\n    cloudFetch: (backupId) => call("backup.cloudFetch", { backupId }),\n');
});

// The admin backup page opens its own restore dialog (preview, admin PIN) on the downloaded copy.
edit(root + '/index-DAmHwBc4.js', '/* CLOUD_RESTORE_UI_1108 */', (replace, get, set) => {
  const s = get(), ast = ts.createSourceFile('ui.js', s, 99, true);
  const n = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AdminBackupPage');
  if (!n) throw Error('AdminBackupPage missing');
  const body = n.getText(ast), card = 'jsxRuntimeExports.jsx(PsCloudBackupCard,{}),';
  if (body.split(card).length !== 2) throw Error('Cloud card slot changed');
  set(s.slice(0, n.getStart(ast)) + body.replace(card, '/* CLOUD_RESTORE_UI_1108 */ jsxRuntimeExports.jsx(PsCloudBackupCard,{onImported:async id=>{await refresh();await openRestore(id);}}),') + s.slice(n.end));
});
console.log('Cloud restore on a new computer; backup at day close and on quit');

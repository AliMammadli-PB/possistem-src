// Backup to / from a USB flash drive (1.9.18): "Flaşa köçür" on every backup row copies the
// plain .db with a save dialog; "Fayldan yüklə" copies a chosen .db into the backups folder,
// the core registers it (backup.import) and the usual restore preview + admin PIN follows.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('backup-usb anchor missing/repeated: '+a.slice(0,80));return s.replace(a,b)};
const edit=(file,marker,fn)=>{const p=path.join(root,file);const s=fs.readFileSync(p,'utf8');if(!s.includes(marker))fs.writeFileSync(p,fn(s));};

edit('index.js','/* POSSISTEM_BACKUP_USB */',main=>{
 main=once(main,'Cn={','Cn={"backup.exportFile":{auth:!0,perm:"backup.manage",timeout:3e5,idempotent:!1},"backup.importFile":{auth:!0,perm:"backup.manage",timeout:3e5,idempotent:!1},');
 main=once(main,'var PS_LAN_DENY=new Set(["backup.create",','var PS_LAN_DENY=new Set(["backup.exportFile","backup.importFile","backup.create",');
 main=once(main,'async function Is(e,t){',`/* POSSISTEM_BACKUP_USB */
async function _psBackupExport(t){const l=await b("backup.list",{});if(!l.success)return l;const it=(l.data?.backups||[]).find(x=>x.id===String(t?.backupId||""));if(!it||!p.existsSync(it.path))return d("E_NOT_FOUND","Ehtiyat nüsxə faylı tapılmadı");const w=en(),o={title:"Backup-ı flaşa köçür",defaultPath:m.basename(it.path),filters:[{name:"Restoran POS backup",extensions:["db"]}]};const r=w?await c.dialog.showSaveDialog(w,o):await c.dialog.showSaveDialog(o);if(r.canceled||!r.filePath)return y({canceled:!0});try{await require("node:fs").promises.copyFile(it.path,r.filePath);return y({path:r.filePath})}catch(x){return d("E_INTERNAL",x instanceof Error?x.message:"Fayl köçürülmədi")}}
async function _psBackupImport(){const w=en(),o={title:"Backup faylını seçin",properties:["openFile"],filters:[{name:"Restoran POS backup",extensions:["db"]}]};const r=w?await c.dialog.showOpenDialog(w,o):await c.dialog.showOpenDialog(o);if(r.canceled||!r.filePaths[0])return y({canceled:!0});const dir=m.join(m.dirname(Me()),"backups");p.mkdirSync(dir,{recursive:!0});const dest=m.join(dir,"pos-usb-"+Date.now()+".db");try{await require("node:fs").promises.copyFile(r.filePaths[0],dest)}catch(x){return d("E_INTERNAL",x instanceof Error?x.message:"Fayl köçürülmədi")}const res=await b("backup.import",{path:dest},6e4);if(!res.success)try{p.unlinkSync(dest)}catch{}return res}
async function Is(e,t){if(e==="backup.exportFile")return _psBackupExport(t);if(e==="backup.importFile")return _psBackupImport();`);
 return main;
});

edit('out/preload/index.js','backup.exportFile',pre=>once(pre,
 '    restore: (backupId, adminPin, options) => call("backup.restore", { backupId, adminPin }, options)',
 '    restore: (backupId, adminPin, options) => call("backup.restore", { backupId, adminPin }, options),\n    exportFile: (backupId) => call("backup.exportFile", { backupId }),\n    importFile: () => call("backup.importFile", {})'));

edit('index-DAmHwBc4.js','/* POSSISTEM_BACKUP_USB_UI */',s=>{
 const L=(az,tr,en)=>`psAdminText(${JSON.stringify(az)},${JSON.stringify(tr)},${JSON.stringify(en)})`;
 s=once(s,`  const openRestore = async (backupId) => {
    setBusy(true);
    const res = await window.pos.backup.restorePreview(backupId);`,`  /* POSSISTEM_BACKUP_USB_UI */
  const exportBackup = async (backupId) => {
    setBusy(true);
    const res = await window.pos.backup.exportFile(backupId);
    setBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return; }
    if (!res.data?.canceled) toast(${L('Flaşa köçürüldü: ','USB belleğe kopyalandı: ','Copied to flash drive: ')} + res.data.path, "success");
  };
  const importBackup = async () => {
    setBusy(true);
    const res = await window.pos.backup.importFile();
    setBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return; }
    if (res.data?.canceled) return;
    await refresh();
    await openRestore(res.data.id);
  };
  const openRestore = async (backupId) => {
    setBusy(true);
    const res = await window.pos.backup.restorePreview(backupId);`);
 s=once(s,`            onClick: () => void createBackup(),
            className: "touch-target mt-4 rounded-xl bg-gold/20 px-4 py-3 text-sm text-gold hover:bg-gold/30 disabled:opacity-50",
            children: t.backup.create
          }
        )
      ] }),`,`            onClick: () => void createBackup(),
            className: "touch-target mt-4 rounded-xl bg-gold/20 px-4 py-3 text-sm text-gold hover:bg-gold/30 disabled:opacity-50",
            children: t.backup.create
          }
        ),
        jsxRuntimeExports.jsx("button", { type: "button", disabled: busy, onClick: () => void importBackup(), className: "touch-target mt-4 ml-3 rounded-xl border border-gold/40 px-4 py-3 text-sm text-gold hover:bg-gold/10 disabled:opacity-50", children: ${L('Fayldan yüklə (flaş)','Dosyadan yükle (USB)','Load from file (flash drive)')} }),
        jsxRuntimeExports.jsx("p", { className: "mt-3 text-xs text-faint", children: ${L('Flaşa köçürülən fayl parolsuzdur — flaşı etibarlı yerdə saxlayın. Yükləmədən əvvəl hazırkı baza ayrıca saxlanılır.','USB’ye kopyalanan dosya şifresizdir — belleği güvenli yerde saklayın. Yüklemeden önce mevcut veritabanı ayrıca saklanır.','The file copied to the flash drive is not encrypted — keep the drive safe. The current database is kept aside before loading.')} })
      ] }),`);
 s=once(s,`          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy,
              onClick: () => void openRestore(row.id),`,`          jsxRuntimeExports.jsx("button", { type: "button", disabled: busy, onClick: () => void exportBackup(row.id), className: "touch-target shrink-0 rounded-xl border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-40", children: ${L('Flaşa köçür','USB’ye kopyala','Copy to flash drive')} }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy,
              onClick: () => void openRestore(row.id),`);
 return s;
});
console.log('backup-usb: export to / import from flash drive');

/** Restaurant staff workspace: one screen for people, branch, warehouse and salary. */
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let s=fs.readFileSync(file,'utf8');
function rewrite(name,fn){const a=ts.createSourceFile('ui.js',s,99,true),n=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('Staff workspace missing '+name);s=s.slice(0,n.getStart(a))+fn(n.getText(a))+s.slice(n.end);}
function once(b,x,y){if(b.split(x).length!==2)throw Error('Staff anchor missing: '+x.slice(0,100));return b.replace(x,y);}
const start='/* LOCAL_STAFF_HUB_START */',end='/* LOCAL_STAFF_HUB_END */',block=start+'\n'+fs.readFileSync(root+'/catalog/staff-hub.js','utf8')+'\n'+end;
if(s.includes(start))s=s.slice(0,s.indexOf(start))+block+s.slice(s.indexOf(end)+end.length);else s=s.replace('const container = document.getElementById("root");',block+'\nconst container = document.getElementById("root");');
rewrite('PsUnifiedStaff',()=> 'function PsUnifiedStaff(){return jsxRuntimeExports.jsx(PsStaffHub,{});}');
rewrite('_psRoleAz',()=> 'function _psRoleAz(name){return name==="manager"?"Müdir":_PS_ROLE_AZ[name]||name;}');
rewrite('psRoleLabel',b=>b.replace('manager: ["Menecer"','manager: ["Müdir"'));
rewrite('OperationsPage',b=>{
 if(b.includes('/* LOCAL_STAFF_ENTRY */'))return b;
 b=once(b,'{ id: "salary", label: "Maaşlar", show: hasPermission("salary.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSalary, {}) }','/* LOCAL_STAFF_ENTRY */{ id: "staff", label: "İşçilər", show: hasPermission("users.manage") || hasPermission("salary.manage"), render: () => jsxRuntimeExports.jsx(PsUnifiedStaff,{}) }');
 return once(b,'return fromSearch || fromHash;','const tab=fromSearch||fromHash;return tab==="salary"?"staff":tab;');
});
rewrite('PsAdminFrame',b=>b.includes('staff: ["İşçilər"')?b:once(b,'salary: ["Maaşlar"','staff: ["İşçilər","Personel","Staff"], salary: ["Maaşlar"'));
rewrite('psOpsSubtitle',b=>{
 if(!b.includes('staff: ["İşçi hesabları'))b=once(b,'    salary: [','    staff: ["İşçi hesabları, obyekt təyinatı və maaş ödənişləri.", "Personel hesapları, şube ataması ve maaş ödemeleri.", "Staff accounts, branch assignment and payroll."],\n    salary: [');
 return b.replace('Təchizatçılar, işçilər və müştərilər — borcları bir yerdə.','Təchizatçılar və müştərilər — borcları bir yerdə.').replace('Tedarikçiler, çalışanlar ve müşteriler — borçlar tek yerde.','Tedarikçiler ve müşteriler — borçlar tek yerde.').replace('Suppliers, staff and guests — their tabs in one place.','Suppliers and guests — their tabs in one place.');
});
rewrite('PsStaffPage',b=>{
 if(b.includes('/* LOCAL_STAFF_DIRECTORY */'))return b;
 b=once(b,'setUsers(data.users ?? []);','/* LOCAL_STAFF_DIRECTORY */setUsers((data.users ?? []).filter(u=>u.id!=="usr-admin"&&u.id!=="possistem-admin"));');
 b=once(b,'className: "mx-auto max-w-4xl p-6"','className: "ps-staff-directory"');
 b=once(b,'children: t.staff.title','children: "Giriş hesabı və vəzifə"');
 b=once(b,'className: "mt-6 grid gap-6 md:grid-cols-2"','className: "ps-staff-columns"');
 b=once(b,'t.staff.addWaiter','"Yeni işçi"');
 b=once(b,'jsxRuntimeExports.jsx(RolePermissionsPanel, {}),','null /* Permissions have their own staff tab. */,');
 return b.replace('Vəzifənin nə edə biləcəyi aşağıdakı «Rollar və səlahiyyətlər» bölməsində təyin olunur.','Vəzifənin icazələri «Səlahiyyətlər» vərəqində təyin olunur.');
});
rewrite('PsStaffScope',b=>b.replace('İşçi, maaş və anbar girişi','Obyekt, maaş və anbar təyinatı').replace('İşçi hesabı və anbarın maaş kartı bir-birinə bağlıdır. Müdir bütün anbarları, anbarçı yalnız seçilmiş anbarı görür.','İşçiyə obyekt, aylıq maaş və anbar girişi təyin edin. Müdir bütün anbarları, anbarçı yalnız seçilmiş anbarı görür.'));
rewrite('PsOriginalSalary',b=>b.replace('İşçi yoxdur — Partnyorlar bölməsində İşçi tipli partnyor yaradın','İşçi yoxdur — İşçi siyahısı vərəqində əməkdaş yaradın.'));
rewrite('OpsPartners',b=>{
 // Older patch scripts can reinsert this role label on each assembly. Keep it canonical.
 const a=b.indexOf("r.type==='employee'&&r.raw.userRole?"),z=b.indexOf('PS_PARTNER_TYPES[r.type]',a);
 if(a>=0&&z>=0)b=b.slice(0,a)+'PS_PARTNER_TYPES[r.type]'+b.slice(z+'PS_PARTNER_TYPES[r.type]'.length);
 if(b.includes('/* LOCAL_PARTNERS_ONLY */'))return b;
 b=once(b,'setPeople(p.data.customers ?? []);','/* LOCAL_PARTNERS_ONLY */setPeople((p.data.customers ?? []).filter(p=>p.kind!=="employee"));');
 b=once(b,'["supplier", "Təchizatçı"], ["employee", "İşçi"], ["customer", "Müştəri"]','["supplier", "Təchizatçı"], ["customer", "Müştəri"]');
 b=once(b,'Object.entries(PS_PARTNER_TYPES).filter(([k]) => (k === "supplier" ? canSuppliers : canPeople))','Object.entries(PS_PARTNER_TYPES).filter(([k]) => k!=="employee" && (k === "supplier" ? canSuppliers : canPeople))');
 b=once(b,',\n      psMetric("Aylıq maaş fondu", formatMoney(sum("salaryMinor")), shown.filter((r) => r.type === "employee").length + " işçi")','');
 b=once(b,'["Partnyor", "Tip", "Obyekt", "Telefon", "Aylıq maaş", "Borc", ""]','["Partnyor", "Tip", "Obyekt", "Telefon", "Borc", ""]');
 b=once(b,'        r.type === "employee" ? formatMoney(r.salaryMinor) : "—",\n','');
 return b;
});
fs.writeFileSync(file,s);
const cssFile=root+'/possistem-system.css',cs='/* LOCAL_STAFF_STYLE_START */',ce='/* LOCAL_STAFF_STYLE_END */';let css=fs.readFileSync(cssFile,'utf8');if(css.includes(cs))css=css.slice(0,css.indexOf(cs))+css.slice(css.indexOf(ce)+ce.length);css=css.trimEnd()+'\n'+cs+'\n'+fs.readFileSync(root+'/catalog/staff-hub.css','utf8')+'\n'+ce+'\n';fs.writeFileSync(cssFile,css);
console.log('Local staff directory, assignment, payroll and permissions; partners exclude employees');

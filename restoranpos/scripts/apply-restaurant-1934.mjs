// 1.9.34: a category emptied into its sub-categories still shows them on the order screen; creating a
// sub-category is plain; the SUNMI settings section is now İnteqrasiyalar.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('1934 anchor missing/repeated: '+a.slice(0,100));return s.replace(a,b)};
let s=fs.readFileSync(file,'utf8');
const mark='/* POSSISTEM_1934 */';
if(!s.includes(mark)){
 // The grid was hidden when the category had no products of its own, which hid its sub-category tiles too.
 s=once(s,'compact: true }) : products2.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-center text-muted", children: t.common.noResults })','compact: true }) : '+mark+'orderProducts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-center text-muted", children: t.common.noResults })');
 // "+ Alt kateqoriya" goes straight to the name field and says where the new one will sit.
 s=once(s,'const [newParentId, setNewParentId] = reactExports.useState("");','const [newParentId, setNewParentId] = reactExports.useState("");\n  const psCategoryName = reactExports.useRef(null);');
 s=once(s,'jsxRuntimeExports.jsx("input", { value: categoryName, onChange: (e) => setCategoryName(e.target.value), placeholder: t.catalog.newCategory,','jsxRuntimeExports.jsx("input", { ref: psCategoryName, value: categoryName, onChange: (e) => setCategoryName(e.target.value), placeholder: newParentId ? psAdminText("Adını yazın", "Adını yazın", "Type its name") : t.catalog.newCategory,');
 s=once(s,'onClick: () => { setOpenMenu(null); setNewParentId(cat.id); },','onClick: () => { setOpenMenu(null); setNewParentId(cat.id); setTimeout(() => psCategoryName.current?.focus(), 0); },');
 s=once(s,'jsxRuntimeExports.jsx(PsCategoryPick, { categories: categories2, value: newParentId, onChange: setNewParentId, blank: psAdminText("Ana kateqoriya kimi",','newParentId ? jsxRuntimeExports.jsxs("p", { className: "ps-catalog-sub-hint", children: [localizedName(categories2.find((c) => c.id === newParentId) || { nameAz: "" }, lang) + psAdminText(" içində alt kateqoriya", " içinde alt kategori", ": new sub-category"), jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setNewParentId(""), children: psAdminText("Ləğv et", "İptal", "Cancel") })] }) : null,\n        jsxRuntimeExports.jsx(PsCategoryPick, { categories: categories2, value: newParentId, onChange: setNewParentId, blank: psAdminText("Ana kateqoriya kimi",');
 s=once(s,'    toast(t.common.save, "success");\n    setCategoryName("");\n    await loadCategories();','    toast(t.common.save, "success");\n    setCategoryName("");\n    setNewParentId("");\n    await loadCategories();');
 // A new dish is for sale unless the owner says otherwise; as a draft it never reached the order screen.
 s=once(s,'    setPublished(false);','    setPublished(true);');
 // The section is no longer one device.
 s=once(s,'{id:"sunmi",label:"SUNMI",hint:psAdminText("Fiskal kassa","Mali kasa","Fiscal register"),','{id:"sunmi",label:psAdminText("İnteqrasiyalar","Entegrasyonlar","Integrations"),hint:psAdminText("E-kassa və bonus","E-kassa ve bonus","E-kassa and bonus"),');
}
fs.writeFileSync(file,s);
console.log('1934: order tiles without own products, plain sub-category creation, İnteqrasiyalar');

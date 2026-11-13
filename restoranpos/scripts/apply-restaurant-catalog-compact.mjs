#!/usr/bin/env node
/**
 * İdarə → Kateqoriyalar opens straight on the menu: the owner asked for the products to sit higher.
 * - The "Mallar və xammal" / "Anbar kateqoriyaları" tabs repeated İdarə → Menyu və anbar, which keeps both screens.
 * - The page title and hint repeated the breadcrumb.
 * - "Anbardan əlavə et" moves from its own row into the products toolbar, next to the other add buttons.
 * - Category counts are readable, and on narrow tills the add buttons wrap instead of being cut off.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
const MARK='/* CATALOG_COMPACT_1109 */';
const once=(a,b)=>{if(s.split(a).length!==2)throw Error('catalog-compact: anchor changed: '+a.slice(0,90));s=s.replace(a,b);};
if(!s.includes(MARK)){
 // The menu alone; goods and warehouse categories have their own İdarə entries.
 const start=s.indexOf('function PsUnifiedCatalog(){'),end=s.indexOf('\n',start);
 if(start<0||!s.slice(start,end).endsWith('PsMenuCatalog,{}));}'))throw Error('catalog-compact: PsUnifiedCatalog changed');
 s=s.slice(0,start)+'function PsUnifiedCatalog(){'+MARK+'return psH("div",{className:"ps-business-catalog"},jsxRuntimeExports.jsx(PsMenuCatalog,{}));}'+s.slice(end);
 once(`      useAuthStore.getState().hasPermission("inventory.manage") && useAuthStore.getState().hasPermission("catalog.manage") ? jsxRuntimeExports.jsx("button",{className:"ps-stock-menu-open",type:"button",onClick:()=>setStockPicker(true),children:"Anbardan əlavə et"}):null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "border-b border-hairline px-4 py-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl text-cream", children: t.catalog.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-catalog-hint", children: t.catalog.hint })
    ] }),
`,'');
 once(`          categoryId ? jsxRuntimeExports.jsx("button",{type:"button",className:"ps-catalog-existing-btn",disabled:saving,onClick:()=>setCategoryPicker({category:categories2.find(c=>c.id===categoryId)}),children:"+ Hazır məhsul əlavə et"}):null,
        jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-menu-btn", onClick: () => setSetMenu({}), children: psAdminText("+ Menyu yarat", "+ Menü oluştur", "+ Create menu") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); }, children: "+ " + t.catalog.newProduct })
`,`          jsxRuntimeExports.jsxs("div", { className: "ps-catalog-actions", children: [
          categoryId ? jsxRuntimeExports.jsx("button",{type:"button",className:"ps-catalog-existing-btn",disabled:saving,onClick:()=>setCategoryPicker({category:categories2.find(c=>c.id===categoryId)}),children:"+ Hazır məhsul əlavə et"}):null,
          useAuthStore.getState().hasPermission("inventory.manage") && useAuthStore.getState().hasPermission("catalog.manage") ? jsxRuntimeExports.jsx("button",{type:"button",className:"ps-catalog-menu-btn",onClick:()=>setStockPicker(true),children:psAdminText("+ Anbardan əlavə et","+ Depodan ekle","+ Add from stock")}):null,
        jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-menu-btn", onClick: () => setSetMenu({}), children: psAdminText("+ Menyu yarat", "+ Menü oluştur", "+ Create menu") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); }, children: "+ " + t.catalog.newProduct })
          ] })
`);
 fs.writeFileSync(file,s);
}
const cssFile=path.join(root,'possistem-system.css'),start='/* CATALOG_COMPACT_1109_START */',stop='/* CATALOG_COMPACT_1109_END */';
let css=fs.readFileSync(cssFile,'utf8');
if(css.includes(start))css=css.slice(0,css.indexOf(start))+css.slice(css.indexOf(stop)+stop.length);
css=css.trimEnd()+`
${start}
.ps-business-catalog>.ps-catalog-page{border-top:0}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar{padding:12px 16px;gap:10px 12px;flex-wrap:wrap;align-items:center}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar h2{font-size:18px;margin:0}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar .ps-catalog-search{flex:1 1 220px;min-width:0;max-width:none;margin:0}
.ps-catalog-actions{display:flex;flex-wrap:wrap;gap:8px;flex:0 1 auto;min-width:0}
.ps-catalog-actions>button{flex:none;min-height:44px;padding:0 12px;white-space:nowrap}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar .ps-catalog-new-btn{margin-left:0}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-cats-head{padding-top:12px}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-count{min-width:28px;height:24px;padding:0 8px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;background:#e4ecf8;color:#1b2b47;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-cat.is-on .ps-catalog-count{background:#1958ae;color:#fff}
/* Narrow tills: search and "+ Yeni məhsul" share the first row, the other add buttons the second; the title gives way. */
@media (max-width:1440px){
 .ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar h2{display:none}
 .ps-catalog-actions{display:contents}
 .ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-toolbar .ps-catalog-search{order:1;flex-basis:160px}
 .ps-catalog-actions>.ps-catalog-new-btn{order:2}
 .ps-catalog-actions>button:not(.ps-catalog-new-btn){order:3}
}
${stop}
`;
fs.writeFileSync(cssFile,css);

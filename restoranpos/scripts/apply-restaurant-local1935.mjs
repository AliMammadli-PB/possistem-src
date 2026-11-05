/** Restaurant catalogue: choose ready products for a category, sub-categories in a dialog, compact screens. */
import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let s=fs.readFileSync(file,'utf8');
function rewrite(name,fn){const a=ts.createSourceFile('ui.js',s,99,true),n=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('Local catalog missing '+name);s=s.slice(0,n.getStart(a))+fn(n.getText(a))+s.slice(n.end)}
const start='/* LOCAL_CATEGORY_PRODUCTS_START */',end='/* LOCAL_CATEGORY_PRODUCTS_END */',block=start+'\n'+fs.readFileSync(root+'/catalog/category-products.js','utf8')+'\n'+end;
if(s.includes(start))s=s.slice(0,s.indexOf(start))+block+s.slice(s.indexOf(end)+end.length);else s=s.replace('const container = document.getElementById("root");',block+'\nconst container = document.getElementById("root");');
rewrite('PsAdminFrame',b=>{if(b.includes('/* LOCAL_NO_WORKSPACE_TABS */'))return b;const old='jsxRuntimeExports.jsx(PsWorkspaceNav,{}),';if(b.split(old).length!==2)throw Error('Local tabs mount');return b.replace(old,'/* LOCAL_NO_WORKSPACE_TABS */')});
rewrite('PsMenuCatalog',b=>{
 if(b.includes('/* LOCAL_CATEGORY_PICKER */'))return b;
 const once=(a,c)=>{if(b.split(a).length!==2)throw Error('Local catalog anchor '+a.slice(0,90));b=b.replace(a,c)};
 once('const [setMenu, setSetMenu] = reactExports.useState(null);','const [setMenu, setSetMenu] = reactExports.useState(null);\n  /* LOCAL_CATEGORY_PICKER */const [categoryPicker,setCategoryPicker]=reactExports.useState(null);');
 once('setNewParentId(cat.id); setTimeout(() => psCategoryName.current?.focus(), 0);','setCategoryPicker({parent:cat});');
 once('jsxRuntimeExports.jsx(PsCategoryPick, { categories: categories2, value: newParentId, onChange: setNewParentId, blank: psAdminText("Ana kateqoriya kimi", "Ana kategori olarak", "As a top-level category"), topOnly: true, className: "ps-catalog-parent-pick", label: psAdminText("Hansı kateqoriyanın içində", "Hangi kategorinin içinde", "Inside which category") }),','/* Sub-categories are created in the picker with existing dishes. */');
 once('        jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-menu-btn",','        categoryId ? jsxRuntimeExports.jsx("button",{type:"button",className:"ps-catalog-existing-btn",disabled:saving,onClick:()=>setCategoryPicker({category:categories2.find(c=>c.id===categoryId)}),children:"+ Hazır məhsul əlavə et"}):null,\n        jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-menu-btn",');
 once('    setMenu ? jsxRuntimeExports.jsx(PsSetMenuDialog,','    categoryPicker ? jsxRuntimeExports.jsx(PsCategoryProductsDialog,{...categoryPicker,categories:categories2,onClose:()=>{setCategoryPicker(null);void loadCategories();if(categoryId)void loadProducts(categoryId);},onSaved:async target=>{setCategoryPicker(null);setBulkIds([]);await loadCategories();setCategoryId(target);await loadProducts(target);window.dispatchEvent(new Event("possistem-catalog-changed"));}}):null,\n    setMenu ? jsxRuntimeExports.jsx(PsSetMenuDialog,');
 return b;
});
rewrite('PsOriginalOrderPage',b=>{if(b.includes('/* LOCAL_SHORT_CATEGORIES */'))return b;const old='onClick: () => setCategoryId(cat.id),';if(b.split(old).length!==2)throw Error('Local order category button');return b.replace(old,old+'\n            /* LOCAL_SHORT_CATEGORIES */title:localizedName(cat,lang),"aria-pressed":categoryId===cat.id||psParentOf(categories2,categoryId)===cat.id,')});
rewrite('PsOriginalOrderPage',b=>{
 if(b.includes('/* LOCAL_ALL_CATEGORY_CHIPS */'))return b;
 const once=(x,y)=>{if(b.split(x).length!==2)throw Error('All category anchor '+x);b=b.replace(x,y)};
 once('  const visibleCategories = psTopCats(categories2).slice(\n    categoryPage * categoryPageSize,\n    categoryPage * categoryPageSize + categoryPageSize\n  );','  /* LOCAL_ALL_CATEGORY_CHIPS */const visibleCategories=psTopCats(categories2);');
 const a=ts.createSourceFile('order.js',b,99,true);let pager;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(a)==='jsxRuntimeExports.jsx'&&n.arguments[0]?.getText(a)==='PageControls'&&n.getText(a).includes('page: categoryPage,'))pager=n;ts.forEachChild(n,visit)}visit(a);if(!pager)throw Error('Category pager missing');b=b.slice(0,pager.getStart(a))+'null /* all categories are in the wrapping list */'+b.slice(pager.end);
 return b;
});
fs.writeFileSync(file,s.trimEnd()+'\n');
const cssFile=root+'/possistem-system.css',cs='/* LOCAL_COMPACT_CATALOG_START */',ce='/* LOCAL_COMPACT_CATALOG_END */',cb=cs+'\n'+fs.readFileSync(root+'/catalog/local-compact.css','utf8')+'\n'+ce;let css=fs.readFileSync(cssFile,'utf8');if(css.includes(cs))css=css.slice(0,css.indexOf(cs))+css.slice(css.indexOf(ce)+ce.length);css=css.trimEnd()+'\n'+cb+'\n';fs.writeFileSync(cssFile,css);console.log('Local catalog picker, no duplicate workspace tabs and compact 1536px sale controls');

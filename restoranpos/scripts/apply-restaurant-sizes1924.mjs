import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');let source=fs.readFileSync(file,'utf8');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Size editor anchor missing/repeated: '+a.slice(0,100));return s.replace(a,b)};
let ast=ts.createSourceFile('ui.js',source,99,true),component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PsSizeVariants');const controls=fs.readFileSync(path.join(root,'catalog/size-controls.js'),'utf8');if(component)source=source.slice(0,component.getStart(ast))+controls+source.slice(component.end);else source=controls+'\n'+source;
ast=ts.createSourceFile('ui.js',source,99,true);const catalog=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PsMenuCatalog');let text=catalog.getText(ast);
if(!text.includes('/* POSSISTEM_SIZES_1924 */')){
 text=once(text,'const [saving, setSaving] = reactExports.useState(false);','const [saving, setSaving] = reactExports.useState(false);\n  /* POSSISTEM_SIZES_1924 */\n  const [sizeVariants,setSizeVariants]=reactExports.useState([]);\n  const saveAttempt=reactExports.useRef(null);');
 text=once(text,'const startCreate = () => {','const startCreate = () => {\n    setSizeVariants([]);saveAttempt.current=null;');
 text=once(text,'const startEdit = async (product) => {','const startEdit = async (product) => {\n    setSizeVariants([]);saveAttempt.current=null;');
 text=once(text,'if (priceMinor == null || priceMinor < 0 || published && priceMinor <= 0) {','if (!sizeVariants.length && (priceMinor == null || priceMinor < 0 || published && priceMinor <= 0)) {');
 text=once(text,'    setSaving(true);\n    const payload = {',`    const sizes=sizeVariants.map(row=>({sizeCm:Number(String(row.size).trim().replace(",",".")),priceMinor:parseMoneyInput(String(row.price))}));
    if(sizes.some(row=>!Number.isFinite(row.sizeCm)||row.sizeCm<=0||row.sizeCm>300||row.priceMinor==null||row.priceMinor<0||(published&&row.priceMinor<=0))||new Set(sizes.map(row=>Math.round(row.sizeCm*100))).size!==sizes.length){toast("Ölçüləri və qiymətləri düzgün yazın. Ölçülər təkrarlanmamalıdır.","danger");return;}
    setSaving(true);
    try{
    const payload = {`);
 text=once(text,'    if (editId) payload.id = editId;',`    if (editId) payload.id = editId;
    if(sizes.length)payload.sizeVariants=sizes;
    const fingerprint=JSON.stringify(payload);if(saveAttempt.current?.fingerprint!==fingerprint)saveAttempt.current={fingerprint,key:newIdempotencyKey()};`);
 text=once(text,'const res = await window.pos.catalogAdmin.upsertProduct(payload, {\n      idempotencyKey: newIdempotencyKey()','const res = await window.pos.catalogAdmin.upsertProduct(payload, {\n      idempotencyKey: saveAttempt.current.key');
 text=once(text,'    if (productId) {\n      const link = await window.pos.catalogAdmin.setProductModifierGroups(\n        productId,','    for (const variantId of (res.data?.variants?.map(row=>row.id) || (productId?[productId]:[]))) {\n      const link = await window.pos.catalogAdmin.setProductModifierGroups(\n        variantId,');
 text=once(text,'    await loadProducts(categoryId);\n  };\n  const [showGallery','    saveAttempt.current=null;\n    await loadProducts(categoryId);\n    }catch(error){toast(error.message||String(error),"danger");}finally{setSaving(false);}\n  };\n  const [showGallery');
 text=once(text,'          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveProduct(),','          !editId ? jsxRuntimeExports.jsx(PsSizeVariants,{rows:sizeVariants,onChange:setSizeVariants,price:priceRaw,disabled:saving}) : null,\n          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveProduct(),');
 source=source.slice(0,catalog.getStart(ast))+text+source.slice(catalog.end);
}
// The owner workspace uses the same editor and independent costing screen.
ast=ts.createSourceFile('ui.js',source,99,true);const ops=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='OperationsPage');let op=ops.getText(ast);
if(!op.includes('id: "menuCatalog"')){const at=op.indexOf('const _psTabs = [');if(at<0)throw Error('Operations tabs anchor missing');op=op.slice(0,at)+op.slice(at).replace('const _psTabs = [','const _psTabs = [\n    {id: "menuCatalog", label:"Restoran menyusu", show:Boolean(window.__psCloudBranchMode)&&(hasPermission("catalog.manage")||hasPermission("inventory.view")),render:()=>jsxRuntimeExports.jsx("div",{className:"ps-catalog-embedded",children:jsxRuntimeExports.jsx(PsMenuCatalog,{})})},');}
op=op.replace('show:Boolean(window.__psCloudBranchMode)&&hasPermission("catalog.manage")','show:Boolean(window.__psCloudBranchMode)&&(hasPermission("catalog.manage")||hasPermission("inventory.view"))');
source=source.slice(0,ops.getStart(ast))+op+source.slice(ops.end);
fs.writeFileSync(file,source);
const cssFile=path.join(root,'possistem-system.css'),mark='/* POSSISTEM_CATALOG_STYLE_1924 */',end='/* END_POSSISTEM_CATALOG_STYLE_1924 */',style=fs.readFileSync(path.join(root,'catalog/style.css'),'utf8');let css=fs.readFileSync(cssFile,'utf8');if(css.includes(mark)){const a=css.indexOf(mark),b=css.indexOf(end,a);if(b<0)throw Error('Catalog style boundary missing');css=css.slice(0,a)+css.slice(b+end.length);}fs.writeFileSync(cssFile,css+'\n'+mark+'\n'+style+'\n'+end);console.log('1924: free-form product sizes, independent recipes, owner catalogue and bounded scrolling');

import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');let source=fs.readFileSync(file,'utf8');
const component=fs.readFileSync(path.join(root,'printers/stations.js'),'utf8'),ast=ts.createSourceFile('stations.js',component,99,true);
for(const definition of ast.statements.filter(ts.isFunctionDeclaration)){
 const name=definition.name?.text;if(!name)continue;
 const current=ts.createSourceFile('ui.js',source,99,true),matches=current.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 if(matches.length>1)throw Error('Duplicate printer component '+name);
 const next=definition.getText(ast);
 if(matches.length){const old=matches[0];source=source.slice(0,old.getStart(current))+next+source.slice(old.end);}
 else{const anchor=source.indexOf('function PsKitchenStations(');if(anchor<0)throw Error('Printer component anchor missing');source=source.slice(0,anchor)+next+'\n'+source.slice(anchor);}
}
// Catalog and stock are committed by the native service. The former UI
// follow-up swallowed errors and needed extra inventory permissions.
const catalogAst=ts.createSourceFile('ui.js',source,99,true);let followup;
function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(catalogAst)==='!editId && productId'&&n.getText(catalogAst).includes('saveIngredient'))followup=n;ts.forEachChild(n,visit);}visit(catalogAst);
if(followup)source=source.slice(0,followup.getStart(catalogAst))+'/* Stock card is committed with the catalog product. */'+source.slice(followup.end);
// Refresh mounted stock tabs as soon as a catalog save commits, and when
// returning to them. The backend is authoritative; no browser-side stock write.
if(!source.includes('function usePsCatalogRefresh('))source+='\nfunction usePsCatalogRefresh(reload){reactExports.useEffect(()=>{const refresh=()=>void reload();for(const event of ["possistem-catalog-changed","focus","hashchange"])window.addEventListener(event,refresh);return()=>{for(const event of ["possistem-catalog-changed","focus","hashchange"])window.removeEventListener(event,refresh);};},[reload]);}\n';
for(const name of ['OpsGoods','OpsStock']){
 const a=ts.createSourceFile('ui.js',source,99,true),n=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('Stock view missing: '+name);let text=n.getText(a);
 if(!text.includes('usePsCatalogRefresh(reload)')){const anchor='const [busy, run] = useOpsAction(reload);';if(!text.includes(anchor))throw Error('Stock refresh anchor missing: '+name);text=text.replace(anchor,'usePsCatalogRefresh(reload);\n  '+anchor);source=source.slice(0,n.getStart(a))+text+source.slice(n.end);}
}
const saved='const productId = editId || (typeof res.data === "object" && res.data && "id" in res.data ? String(res.data.id) : "");';
if(!source.includes('window.dispatchEvent(new Event("possistem-catalog-changed"))')){if(!source.includes(saved))throw Error('Catalog success anchor missing');source=source.replace(saved,saved+'\n    window.dispatchEvent(new Event("possistem-catalog-changed"));');}
fs.writeFileSync(file,source);console.log('1924: persistent atomic printer assignments with multiple print purposes per device');
const cssFile=path.join(root,'possistem-system.css'),mark='/* POSSISTEM_PRINTER_STYLE_1924 */',style=fs.readFileSync(path.join(root,'printers/style.css'),'utf8');let css=fs.readFileSync(cssFile,'utf8');
if(css.includes(mark)){const own=mark+'\n'+style;if(!css.includes(own))throw Error('Printer stylesheet boundary changed; refusing to remove unrelated styles');css=css.replace(own,'');}
css+='\n'+mark+'\n'+style;fs.writeFileSync(cssFile,css);

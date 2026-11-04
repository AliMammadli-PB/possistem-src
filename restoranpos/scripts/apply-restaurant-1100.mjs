import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'index-DAmHwBc4.js');
let source = fs.readFileSync(bundle, 'utf8');
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw Error('1.10.0 anchor missing: ' + from);
  return text.replace(from, to);
}
function edit(name, transform) {
  const ast = ts.createSourceFile('renderer.js', source, 99, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!fn) throw Error('1.10.0 renderer function missing: ' + name);
  source = source.slice(0, fn.getStart(ast)) + transform(fn.getText(ast)) + source.slice(fn.end);
}
const componentStart = '/* GROUP_EXISTING_SIZES_START */';
const componentEnd = '/* GROUP_EXISTING_SIZES_END */';
const component = componentStart + '\n' + fs.readFileSync(path.join(root, 'catalog/group-sizes.js'), 'utf8') + componentEnd;
if (source.includes(componentStart)) {
  source = source.slice(0, source.indexOf(componentStart)) + component + source.slice(source.indexOf(componentEnd) + componentEnd.length);
} else {
  source = replaceOnce(source, 'const container = document.getElementById("root");', component + '\nconst container = document.getElementById("root");');
}
edit('psGoodForm', text => text.includes('/* RAW_DEFAULT_1100 */') ? text :
  replaceOnce(text, 'sell: !g || copy,', 'sell: /* RAW_DEFAULT_1100 */ psMarketMode() && (!g || copy),'));
edit('PsGoodDialog', text => text.includes('/* RAW_SALE_1100 */') ? text : replaceOnce(text,
  'jsxRuntimeExports.jsx(OpsField, { label: "Satış qiyməti (₼)", value: form.sale, onChange: (v) => set({ sale: v }), placeholder: "0.00" }),',
  '/* RAW_SALE_1100 */ (psMarketMode() || form.id || form.sell || form.onSale) ? jsxRuntimeExports.jsx(OpsField, { label: "Satış qiyməti (₼)", value: form.sale, onChange: (v) => set({ sale: v }), placeholder: "0.00" }) : null,'));
edit('psRecipeEditor', text => text.includes('/* OPTIONAL_COST_1100 */') ? text :
  replaceOnce(text, 'priceLabel(line.unit)),', '/* OPTIONAL_COST_1100 */ "Alış: " + priceLabel(line.unit) + (line.mode === "new" ? " · istəyə bağlı" : "")),'));
edit('OpsCosting', text => text.includes('/* OPTIONAL_COST_1100 */') ? text :
  replaceOnce(text, 'const unitCostMinor = Number(line.unitCostMinor) || opsMinor(line.unitCost);',
    '/* OPTIONAL_COST_1100 */ const unitCostMinor = line.mode === "new" && !String(line.unitCost || "").trim() ? 0 : Number(line.unitCostMinor) || opsMinor(line.unitCost);')
    .replace('qtyMilli <= 0 || unitCostMinor < 0', 'qtyMilli <= 0 || !psStockInputValid(line.unitCost || "", {empty:true}) || unitCostMinor < 0')
    .replace('Yeni sətirdə ad, miqdar və qiymət lazımdır', 'Xammalın miqdarını və yazmısınızsa alış qiymətini yoxlayın'));
edit('PsMenuCatalog', text => {
  if (text.includes('/* GROUP_SIZES_1100 */')) return text;
  text = replaceOnce(text, 'const [bulkIds, setBulkIds] = reactExports.useState([]);',
    'const [bulkIds, setBulkIds] = reactExports.useState([]);\n  /* GROUP_SIZES_1100 */ const [sizeGroup, setSizeGroup] = reactExports.useState(null);');
  text = replaceOnce(text, 'bulkIds.length ? jsxRuntimeExports.jsx(PsCategoryPick,',
    'bulkIds.length >= 2 && bulkIds.length <= 24 && useAuthStore.getState().hasPermission("catalog.manage") ? jsxRuntimeExports.jsx(OpsButton,{disabled:saving,onClick:()=>{const chosen=products2.filter(p=>bulkIds.includes(p.id)&&p.categoryId===categoryId);if(chosen.length===bulkIds.length&&chosen.length>=2)setSizeGroup({products:chosen,categoryId});else toast("Birləşdirmək üçün eyni kateqoriyadan məhsulları seçin","danger");},children:"Ölçüləri birləşdir"}) : null,\n          bulkIds.length ? jsxRuntimeExports.jsx(PsCategoryPick,');
  return replaceOnce(text, 'categoryPicker ? jsxRuntimeExports.jsx(PsCategoryProductsDialog,',
    'sizeGroup ? jsxRuntimeExports.jsx(PsGroupExistingSizes,{...sizeGroup,onClose:()=>setSizeGroup(null),onSaved:async()=>{setSizeGroup(null);setBulkIds([]);await loadProducts(sizeGroup.categoryId);}}) : null,\n    categoryPicker ? jsxRuntimeExports.jsx(PsCategoryProductsDialog,');
});
fs.writeFileSync(bundle, source);

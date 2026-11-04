import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'index-DAmHwBc4.js');
const source = fs.readFileSync(bundle, 'utf8');
const ast = ts.createSourceFile('renderer.js', source, 99, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OpsCosting');
if (!fn) throw Error('Kalkulyasiya ekranı tapılmadı');
const original = fn.getText(ast);
if (original.includes('/* COSTING_VIEWS_1102 */')) process.exit(0);

const marker = '  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [';
const renderStart = original.lastIndexOf(marker);
const dialogStart = original.indexOf('    editor && psH(psRecipeEditor,', renderStart);
if (renderStart < 0 || dialogStart < 0) throw Error('Kalkulyasiya görünüşü tapılmadı');

// Keep the existing report content, interactions and recipe saving logic.
const report = original.slice(renderStart + marker.length, dialogStart);
const start = original.slice(0, renderStart).replace('  const [query, setQuery]', `  /* COSTING_VIEWS_1102 */ const [view, setView] = reactExports.useState("recipes");
  const [onlyMissing, setOnlyMissing] = reactExports.useState(false);
  const [query, setQuery]`);
const recipes = `
  const recipeRows = rows
    .filter(row => (!onlyMissing || !row.hasRecipe) &&
      (!needle || String(row.name ?? "").toLocaleLowerCase("az").includes(needle) ||
       String(row.category ?? "").toLocaleLowerCase("az").includes(needle)))
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "az"));
  const recipePanel = () => psH("div", {className:"ps-costing-recipes"},
    psH("div", {className:"ps-costing-toolbar"},
      psH("input", {type:"search", value:query, "aria-label":"Yemək axtar",
        placeholder:"Yemək və ya kateqoriya axtar…", onChange:event=>setQuery(event.target.value)}),
      psH("label", null,
        psH("input", {type:"checkbox", checked:onlyMissing, onChange:event=>setOnlyMissing(event.target.checked)}),
        "Yalnız reseptsiz")),
    psH(OpsTable, {head:["Yemək","Resept",""], empty:"Uyğun yemək tapılmadı.",
      rows:recipeRows.map(row=>[
        psH("div", {className:"ps-costing-dish"}, psH("strong",null,row.name),
          row.category ? psH("small",null,row.category) : null),
        psH("span", {className:"ps-costing-status" + (row.hasRecipe ? " is-ready" : "")},
          row.active === false || row.active === 0 ? "Qaralama" : row.hasRecipe ? "Hazırdır" : "Yazılmayıb"),
        psH(OpsButton,{disabled:busy||!canEdit,onClick:()=>void openRecipe(row),tone:row.hasRecipe?"quiet":"gold"},
          row.hasRecipe?"Reseptə bax":"Resept yaz")
      ])}));
  const views = [["recipes","Reseptlər"],["report","Maya və qazanc"]];
  return psH("section", {className:"ps-costing-workspace"},
    psH("div", {className:"ps-costing-switch",role:"group","aria-label":"Kalkulyasiya görünüşü"},
      views.map(([key,label])=>psH("button",{key,type:"button","aria-pressed":view===key,onClick:()=>setView(key)},label))),
    view==="recipes" ? recipePanel() : jsxRuntimeExports.jsxs("div",{className:"space-y-4 ps-costing-report",children:[
`;
const ending = `
    ]}),
    editor && psH(psRecipeEditor, {editor,setEditor,ingredients,busy,pickQuery,setPickQuery,lineCostMinor,editorCost,setLine,saveRecipe,unitLabel}),
    confirmDialog);
}
`;
fs.writeFileSync(bundle, source.slice(0, fn.getStart(ast)) + start + recipes + report + ending + source.slice(fn.end));

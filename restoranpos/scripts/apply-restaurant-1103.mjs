import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* RECIPE_COMPONENTS_1103 */')) process.exit(0);

function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Renderer anchor changed: ' + old.slice(0, 90));
  source = source.replace(old, () => next);
}

replace('const list = catData.categories ?? [];', 'const list = (catData.categories ?? []).filter(category => category.id !== "cat-goods" || Number(category.itemCount) > 0);');
replace('function psRecipeEditor({ editor, setEditor, ingredients,', 'function psRecipeEditor({ editor, setEditor, ingredients, recipeChoices,');
replace('const needle = pickQuery.trim().toLowerCase();', 'const needle = pickQuery.trim().toLocaleLowerCase("az");');
replace('String(i.name || "").toLowerCase().includes(needle)', 'String(i.name || "").toLocaleLowerCase("az").includes(needle)');
const costingStart = source.indexOf('function OpsCosting(');
const costingNeedle = source.indexOf('query.trim().toLowerCase()', costingStart);
if (costingStart < 0 || costingNeedle < 0) throw Error('Costing search anchor changed');
source = source.slice(0, costingNeedle) + source.slice(costingNeedle).replace('query.trim().toLowerCase()', 'query.trim().toLocaleLowerCase("az")');
replace('/* SIMPLE_RECIPE_1101 */ const h = psH;', `/* SIMPLE_RECIPE_1101 */ /* RECIPE_COMPONENTS_1103 */ const h = psH;
  const [pickKind, setPickKind] = reactExports.useState("stock");
  const [conversion, setConversion] = reactExports.useState(null);
  const addComponent = (recipe, confirmed = false) => {
    const oldLine = editor.lines.find(line => line.ingredientId === recipe.linkedIngredientId);
    if (oldLine && !confirmed) { setConversion({ recipe, oldLine }); return; }
    setConversion(null);
    setEditor(prev => {
      if (!prev || prev.components.some(part => part.menuItemId === recipe.id)) return prev;
      return {
        ...prev,
        lines: oldLine ? prev.lines.filter(line => line.ingredientId !== oldLine.ingredientId) : prev.lines,
        components: [...prev.components, { menuItemId: recipe.id, name: recipe.name, qty: oldLine?.qty || "1", costMinor: recipe.costMinor }]
      };
    });
  };`);
const pickerStart = source.indexOf('    h("h3", { className: "ps-recipe-step" }, "1. Anbardan tərkibi seçin"),');
const pickerEnd = source.indexOf('    h("h3", { className: "ps-recipe-step" }, "2. Bir porsiyanın miqdarı"),', pickerStart);
if (pickerStart < 0 || pickerEnd < 0) throw Error('Recipe picker changed');
source = source.slice(0, pickerStart) + `    h("h3", { className: "ps-recipe-step" }, "1. Tərkibi seçin"),
    h("div", { className: "ps-recipe-picker-types" }, [["stock", "Anbar xammalı"], ["recipe", "Hazır resept"]].map(([kind, title]) =>
      h("button", { key: kind, type: "button", className: "ps-recipe-chip" + (pickKind === kind ? " is-on" : ""),
        "aria-pressed": pickKind === kind, onClick: () => { setPickKind(kind); setPickQuery(""); } }, title))),
    h("input", { type: "search", className: "ps-recipe-search", "aria-label": "Tərkib axtar",
      placeholder: pickKind === "stock" ? "Xammalın adını yazın" : "Reseptin adını yazın", value: pickQuery,
      onChange: (event) => setPickQuery(event.target.value) }),
    h("div", { className: "ps-recipe-chips", tabIndex: 0, "aria-label": "Axtarış nəticələri" }, (() => {
      const choices = pickKind === "stock" ? shown : recipeChoices.filter(recipe =>
        recipe.id !== editor.id && String(recipe.name).toLocaleLowerCase("az").includes(needle));
      return choices.length ? choices.map(choice => {
        const selected = pickKind === "stock" ? picked.has(choice.id) : editor.components.some(part => part.menuItemId === choice.id);
        return h("button", { key: choice.id, type: "button", "aria-pressed": selected,
          className: "ps-recipe-chip" + (selected ? " is-on" : ""),
          disabled: pickKind === "recipe" && selected,
          onClick: () => pickKind === "stock" ? toggle(choice) : addComponent(choice) },
          (selected ? "✓ " : "+ ") + choice.name, pickKind === "stock" ? h("small", null, label(choice.unit)) : null);
      }) : h("p", { role: "status", className: "ps-recipe-note" }, "Nəticə tapılmadı.");
    })()),
    conversion ? h("div", { role: "group", "aria-label": "Anbar sətrini dəyiş", className: "ps-recipe-note" },
      h("p", null, "“" + conversion.oldLine.name + "” anbar sətri hazır reseptlə əvəz edilsin?"),
      h("button", { type: "button", className: "ps-recipe-chip", onClick: () => addComponent(conversion.recipe, true) }, "Əvəz et"),
      h("button", { type: "button", className: "ps-recipe-chip", onClick: () => setConversion(null) }, "İmtina")) : null,
` + source.slice(pickerEnd);

replace('    editor.lines.length\n      ? h("div", { className: "ps-recipe-rows" }, editor.lines.map', `    editor.components.length ? h("div", { className: "ps-recipe-rows" }, editor.components.map(part =>
      h("div", { key: part.menuItemId, className: "ps-recipe-row ps-recipe-simple-row" },
        h("span", { className: "ps-recipe-name" }, part.name, h("small", null, " · Hazır resept")),
        h("span", { className: "ps-recipe-qty" }, h("input", { inputMode: "decimal", value: part.qty,
          "aria-label": part.name + " porsiya sayı", onChange: (event) => {
            const qty = event.target.value;
            setEditor(prev => prev ? { ...prev, components: prev.components.map(row => row.menuItemId === part.menuItemId ? { ...row, qty } : row) } : prev);
          } }), h("em", null, "porsiya")),
        h("button", { type: "button", className: "ps-recipe-remove", "aria-label": part.name + " reseptini sil",
          onClick: () => setEditor(prev => prev ? { ...prev, components: prev.components.filter(row => row.menuItemId !== part.menuItemId) } : prev) }, "×")))) : null,
    editor.lines.length
      ? h("div", { className: "ps-recipe-rows" }, editor.lines.map`);
replace('editor.selfId && !editor.lines.length', 'editor.selfId && !editor.lines.length && !editor.components.length');
replace('      selfId: selfItem ? selfItem.id : "",\n      lines', `      selfId: res.data.linkedIngredientId || selfItem?.id || "",
      components: (res.data.components ?? []).map(part => ({ ...part, qty: opsQty(part.qtyMilli) })),
      lines`);
replace('!selfItem || line.ingredientId !== selfItem.id', 'line.ingredientId !== (res.data.linkedIngredientId || selfItem?.id)');
replace('editor.lines.reduce((sum, line) => sum + lineCostMinor(line), 0) : 0', `editor.lines.reduce((sum, line) => sum + lineCostMinor(line), 0) +
    editor.components.reduce((sum, part) => sum + Math.round((Number(part.costMinor) || 0) * opsNum(part.qty)), 0) : 0`);
replace('    const prepared = [];\n    for (const line of editor.lines)', `    const components = editor.components.map(part => ({ menuItemId: part.menuItemId, qtyMilli: Math.round(opsNum(part.qty) * 1000) }));
    if (components.some(part => !(part.qtyMilli > 0 && part.qtyMilli <= 100000))) {
      toast("Hazır reseptin porsiya sayını düzgün yazın", "danger");
      return;
    }
    const prepared = [];
    for (const line of editor.lines)`);
replace('const keepSelf = !prepared.length && editor.selfId;', 'const keepSelf = !prepared.length && !components.length && editor.selfId;');
replace('    const dropSelf = !keepSelf && editor.selfId;\n', '');
replace('          if (dropSelf) void window.pos.inventory.deactivateIngredient(editor.selfId).then(() => reload());\n', '');
replace('saveRecipe(editor.id, prepared), keepSelf ? "Saxlanıldı" : prepared.length ?', 'saveRecipe(editor.id, prepared, components), keepSelf ? "Saxlanıldı" : (prepared.length || components.length) ?');
replace('psH(psRecipeEditor, {editor,setEditor,ingredients,busy,', 'psH(psRecipeEditor, {editor,setEditor,ingredients,recipeChoices:rows.filter(row => row.active && row.hasPreparedRecipe),busy,');
fs.writeFileSync(bundle, source);

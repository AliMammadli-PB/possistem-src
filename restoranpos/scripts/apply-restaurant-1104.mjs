import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* PREPARED_PICK_1104 */')) process.exit(0);
function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Renderer anchor changed: ' + old.slice(0, 90));
  source = source.replace(old, () => next);
}

// A dish with its own recipe, picked from the stock list, is that recipe.
replace('onClick: () => pickKind === "stock" ? toggle(choice) : addComponent(choice) },', `onClick: () => { /* PREPARED_PICK_1104 */
            if (pickKind !== "stock") return addComponent(choice);
            const prepared = recipeChoices.find(recipe => recipe.linkedIngredientId === choice.id && recipe.id !== editor.id);
            return prepared && !selected ? addComponent(prepared, true) : toggle(choice);
          } },`);

// The cash row of a salary belongs to its salary document; the core refuses it here.
replace('jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setDocEdit({...m,type:"expense"}),', 'm.linkedSalaryDocumentId?"Maaşlar bölməsindən":jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setDocEdit({...m,type:"expense"}),');
replace('jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy,onClick:()=>setVoidExpense({...m,type:"expense"}),', 'm.linkedSalaryDocumentId?null:jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy,onClick:()=>setVoidExpense({...m,type:"expense"}),');

// A branch name that could not be applied says so where the objects are.
replace('  const [showTransferDocs, setShowTransferDocs] = reactExports.useState(false);\n', `  const [showTransferDocs, setShowTransferDocs] = reactExports.useState(false);
  const [branchWarning, setBranchWarning] = reactExports.useState("");
  reactExports.useEffect(() => {
    let live = true;
    void window.pos.settings.getAll().then(r => { if (live && r.success) setBranchWarning(r.data?.settings?.["branch.cloudConflict"] || ""); }).catch(() => {});
    return () => { live = false; };
  }, []);
`);
replace('    !psMarketMode()?h(OpsButton,{tone:"quiet",onClick:()=>setShowTransferDocs(', `    branchWarning ? h("p", { role: "alert", className: "rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm" }, branchWarning) : null,
    !psMarketMode()?h(OpsButton,{tone:"quiet",onClick:()=>setShowTransferDocs(`);
fs.writeFileSync(bundle, source);

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
const main = fileURLToPath(new URL('../index.js', import.meta.url));
let process_ = fs.readFileSync(main, 'utf8');

// Papers waiting for a printer move on their own. Only the next print moved them before.
if (!process_.includes('/* POS_PRINT_TICK */')) {
  process_ += `
/* POS_PRINT_TICK */
let _psPrintTickBusy=false;
setInterval(async()=>{
  if(_psPrintTickBusy||!ft()||!et||globalThis.__psLanRoute)return;
  _psPrintTickBusy=true;
  try{await et.invoke("print.drain",{},{timeoutMs:30000});}catch{}finally{_psPrintTickBusy=false;}
},15000).unref();
`;
  fs.writeFileSync(main, process_);
}

function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Renderer anchor changed: ' + old.slice(0, 90));
  source = source.replace(old, () => next);
}

// A salary or an advance lives in one place: İşçilər → Qaimələr. Its money still leaves the till.
if (!source.includes('/* SALARY_ONE_PLACE_1105 */')) {
  replace('setRows((r.data.movements ?? []).filter((m) => m.kind === "expense"));', 'setRows((r.data.movements ?? []).filter((m) => m.kind === "expense" && !m.linkedSalaryDocumentId)); /* SALARY_ONE_PLACE_1105 */');
  replace('const PS_EXPENSE_KINDS = ["Bazarlıq", "Kommunal", "Maaş", "Nəqliyyat", "Təmir", "Digər"];', 'const PS_EXPENSE_KINDS = ["Bazarlıq", "Kommunal", "Nəqliyyat", "Təmir", "Digər"];');
  if (source.includes('m.linkedSalaryDocumentId?"Maaşlar bölməsindən":')) replace('m.linkedSalaryDocumentId?"Maaşlar bölməsindən":', '');
  if (source.includes('m.linkedSalaryDocumentId?null:jsxRuntimeExports')) replace('m.linkedSalaryDocumentId?null:jsxRuntimeExports', 'jsxRuntimeExports');
}

if (source.includes('/* POS_1105 */')) { fs.writeFileSync(bundle, source); process.exit(0); }

// psH overwrote a children prop with nothing: the cancel and view dialogs opened empty, their buttons had no label.
replace('  return kids.length > 1 ? jsxRuntimeExports.jsxs(tag, { ...rest, children: kids }, key) : jsxRuntimeExports.jsx(tag, { ...rest, children: kids[0] }, key);',
  `  /* POS_1105 */ if (!kids.length) return jsxRuntimeExports.jsx(tag, rest, key);
  return kids.length > 1 ? jsxRuntimeExports.jsxs(tag, { ...rest, children: kids }, key) : jsxRuntimeExports.jsx(tag, { ...rest, children: kids[0] }, key);`);

// A sauce hidden from the sale screen is still a ready-made recipe.
replace('recipeChoices:rows.filter(row => row.active && row.hasPreparedRecipe)', 'recipeChoices:rows.filter(row => row.hasPreparedRecipe)');

// A paper that stopped waiting can be sent again.
replace('job.lastError && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-danger", children: job.lastError })\n              ]',
  `job.lastError && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-danger", children: job.lastError }),
                job.status === "failed" && jsxRuntimeExports.jsx("button", { type: "button", className: "mt-1 underline text-cream", onClick: () => void window.pos.print.retry(job.id).then(() => loadJobs()), children: "Yenidən çap et" })
              ]`);
fs.writeFileSync(bundle, source);

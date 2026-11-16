#!/usr/bin/env node
/**
 * Half portions (1.10.32). The product editor gets "Yarım porsiya qiyməti": filled, the dish is also sold as a
 * half portion at that price (core catalog.setPortions; stock takes half the recipe). On the sale screen the
 * choice shows as two buttons, "1 porsiya" and "Yarım porsiya", each with its own price.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const MARK='/* PORTIONS_1116 */';
const patch=(file,steps)=>{let s=fs.readFileSync(file,'utf8');if(s.includes(MARK))return;for(const[a,b]of steps){if(s.split(a).length!==2)throw Error('portions-1116: anchor changed in '+path.basename(file)+': '+a.slice(0,90));s=s.replace(a,()=>b);}fs.writeFileSync(file,s);};

patch(path.join(root,'index.js'),[
 ['"catalog.setProductModifierGroups":{auth:!0,perm:"catalog.manage",timeout:3e3,idempotent:!0}','"catalog.setProductModifierGroups":{auth:!0,perm:"catalog.manage",timeout:3e3,idempotent:!0},"catalog.setPortions":{auth:!0,perm:"catalog.manage",timeout:3e3,idempotent:!0}'],
]);
fs.appendFileSync(path.join(root,'index.js'),fs.readFileSync(path.join(root,'index.js'),'utf8').includes(MARK)?'':'\n'+MARK+'\n');

patch(path.join(root,'out/preload/index.js'),[
 ['    setProductModifierGroups: (productId, groupIds, options) => call("catalog.setProductModifierGroups", { productId, groupIds }, options),','    setProductModifierGroups: (productId, groupIds, options) => call("catalog.setProductModifierGroups", { productId, groupIds }, options),\n    '+MARK+'\n    setPortions: (productId, halfPriceMinor, options) => call("catalog.setPortions", { productId, halfPriceMinor }, options),'],
]);

const renderer=path.join(root,'index-DAmHwBc4.js');
patch(renderer,[
 // Product editor: the half-portion price.
 ['  const [priceRaw, setPriceRaw] = reactExports.useState("");','  const [priceRaw, setPriceRaw] = reactExports.useState("");\n  '+MARK+' const [psHalfRaw, setPsHalfRaw] = reactExports.useState("");\n  const psHalfHad = reactExports.useRef(false);'],
 ['      setProductGroupIds((row.modifierGroups ?? []).map((g) => g.id));\n    } else {\n      setProductGroupIds([]);\n    }',
  '      setProductGroupIds((row.modifierGroups ?? []).map((g) => g.id).filter((id) => !String(id).startsWith("portion:")));\n      const psHalf = (row.modifierGroups ?? []).find((g) => String(g.id).startsWith("portion:"))?.modifiers?.[0];\n      psHalfHad.current = !!psHalf;\n      setPsHalfRaw(psHalf ? ((Number(row.priceMinor ?? product.priceMinor ?? 0) + Number(psHalf.priceDeltaMinor || 0)) / 100).toFixed(2) : "");\n    } else {\n      setProductGroupIds([]);\n      psHalfHad.current = false;\n      setPsHalfRaw("");\n    }'],
 ['  const startCreate = () => {\n    setSizeVariants([]);saveAttempt.current=null;','  const startCreate = () => {\n    setSizeVariants([]);saveAttempt.current=null;\n    setPsHalfRaw("");psHalfHad.current=false;'],
 ['    if(sizes.some(row=>!Number.isFinite(row.sizeCm)','    const psHalfMinor = psHalfRaw.trim() ? parseMoneyInput(psHalfRaw) : 0;\n    if (psHalfRaw.trim() && (psHalfMinor == null || psHalfMinor <= 0)) { toast("Yarım porsiyanın qiymətini düzgün yazın (boş qoysanız yarım porsiya olmaz).", "danger"); return; }\n    if(sizes.some(row=>!Number.isFinite(row.sizeCm)'],
 ['    setSaving(false);\n    toast(t.common.save, "success");\n    setEditorOpen(false);\n    setEditId(null);\n    saveAttempt.current=null;',
  '    if (productId && !sizes.length && (psHalfMinor > 0 || psHalfHad.current)) {\n      const portion = await window.pos.catalogAdmin.setPortions(productId, psHalfMinor || 0, { idempotencyKey: newIdempotencyKey() });\n      if (!portion.success) { setSaving(false); toast(portion.error.message, "danger"); return; }\n    }\n    setSaving(false);\n    toast(t.common.save, "success");\n    setEditorOpen(false);\n    setEditId(null);\n    saveAttempt.current=null;'],
 ['                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: priceRaw, onChange: (e) => setPriceRaw(e.target.value), inputMode: "decimal", placeholder: "0.00", className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50" })\n              ] })',
  '                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: priceRaw, onChange: (e) => setPriceRaw(e.target.value), inputMode: "decimal", placeholder: "0.00", className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50" })\n              ] }),\n              sizeVariants.length ? null : jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [\n                jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Yarım porsiya qiyməti (₼)" }),\n                jsxRuntimeExports.jsx("input", { value: psHalfRaw, onChange: (e) => setPsHalfRaw(e.target.value), inputMode: "decimal", placeholder: "Boş: yarım porsiya yoxdur", "aria-label": "Yarım porsiya qiyməti", className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50" }),\n                jsxRuntimeExports.jsx("span", { className: "mt-1 block text-xs text-muted", children: "Satışda «1 porsiya / Yarım porsiya» seçilir. Anbardan reseptin yarısı silinir." })\n              ] })'],
 // Sale screen: "1 porsiya" next to "Yarım porsiya", both with their full price.
 ['        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-1", children: (group.modifiers ?? []).map((mod) => {\n          const checked = (selectedMods[group.id] ?? []).includes(mod.id);',
  '        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-1", children: [String(group.id).startsWith("portion:") ? jsxRuntimeExports.jsxs("button", { type: "button", onClick: () => setSelectedMods((prev) => ({ ...prev, [group.id]: [] })), className: `touch-target flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${(selectedMods[group.id] ?? []).length === 0 ? "border-gold/50 bg-gold/10 text-gold-light" : "border-hairline bg-elevated text-muted"}`, children: [jsxRuntimeExports.jsx("span", { children: "1 porsiya" }), jsxRuntimeExports.jsx(MoneyText, { minor: pending.product.priceMinor ?? 0, className: "text-xs" })] }, "portion-full") : null, ...(group.modifiers ?? []).map((mod) => {\n          const checked = (selectedMods[group.id] ?? []).includes(mod.id);'],
 ['                mod.priceDeltaMinor !== 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(MoneyText, { minor: mod.priceDeltaMinor, className: "text-xs" })\n              ]\n            },\n            mod.id\n          );\n        }) })',
  '                String(group.id).startsWith("portion:") ? jsxRuntimeExports.jsx(MoneyText, { minor: (pending.product.priceMinor ?? 0) + mod.priceDeltaMinor, className: "text-xs" }) : mod.priceDeltaMinor !== 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(MoneyText, { minor: mod.priceDeltaMinor, className: "text-xs" })\n              ]\n            },\n            mod.id\n          );\n        })] })'],
]);

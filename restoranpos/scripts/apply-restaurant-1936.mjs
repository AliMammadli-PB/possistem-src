// 1.9.36: a note on a dish in the order ("göyərtisiz, mayonezi bol"). The core already stores and prints it; the screen had no way to enter it.
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile('ui.js',s,99,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PsOriginalOrderPage');
if(!fn)throw Error('1936: order page missing');
let b=fn.getText(ast);
if(!b.includes('/* POSSISTEM_1936 */')){
 const once=(x,y)=>{if(b.split(x).length!==2)throw Error('1936 anchor missing/repeated: '+x.slice(0,90));b=b.replace(x,y)};
 const J='/* @__PURE__ */ jsxRuntimeExports.jsx';
 once('/* POS_ORDER_MAYA_v1 */',`/* POSSISTEM_1936 */
  const [psNote, setPsNote] = reactExports.useState(null);
  const psNotePending = reactExports.useRef(null);
  /* POS_ORDER_MAYA_v1 */`);
 once('const updateQty = async (item, quantity) => {',`const savePsNote = () => {
    if (!psNote || !order) return;
    const { id, text } = psNote, note = text.trim();
    setPsNote(null);
    if ((order.items ?? []).find((i) => i.id === id)?.note === note) return;
    // Remembered, because a tap on "send" blurs this field first: the ticket must wait for the note.
    psNotePending.current = (async () => {
      const res = await window.pos.orders.setItemNote(order.id, id, note);
      if (!res.success) toast(res.error.message, "danger");
      else await loadOrder(order.id);
      psNotePending.current = null;
    })();
  };
  const updateQty = async (item, quantity) => {`);
 once(`if (!order || submitting) return;
    setSubmitting(true);
    const res = await window.pos.orders.submit(`,`if (!order || submitting) return;
    setSubmitting(true);
    if (psNotePending.current) await psNotePending.current;
    const res = await window.pos.orders.submit(`);
 once('[item.status] ?? item.status })',`[item.status] ?? item.status }),
                item.note ? ${J}("p", { className: "mt-1 whitespace-normal break-words text-xs font-semibold text-gold", children: t.order.note + ": " + item.note }) : null`);
 once(`${J}(
                  "button",
                  {
                    type: "button",
                    disabled: busy,
                    onClick: () => void removeItem(item),`,`${J}("button", { type: "button", disabled: busy, onClick: () => setPsNote({ id: item.id, text: item.note || "" }), className: "touch-target rounded-lg border border-gold/35 px-2 text-xs text-gold", children: (item.note ? "✎ " : "+ ") + t.order.note }),
                ${J}(
                  "button",
                  {
                    type: "button",
                    disabled: busy,
                    onClick: () => void removeItem(item),`);
 once(`children: t.order.void
                }
              )
            ] })
          ] }, item.id);`,`children: t.order.void
                }
              )
            ] }),
            psNote?.id === item.id ? ${J}("input", { autoFocus: true, maxLength: 200, value: psNote.text, "aria-label": t.order.note, placeholder: psAdminText("məs. göyərtisiz, mayonezi bol", "örn. yeşilliksiz, bol mayonez", "e.g. no herbs, extra mayo"), onChange: (e) => setPsNote({ id: item.id, text: e.target.value }), onBlur: savePsNote, onKeyDown: (e) => { if (e.key === "Enter") e.currentTarget.blur(); }, className: "mt-2 w-full rounded-lg border border-gold/35 bg-transparent px-3 py-2 text-sm text-cream" }) : null
          ] }, item.id);`);
 s=s.slice(0,fn.getStart(ast))+b+s.slice(fn.end);
 fs.writeFileSync(file,s);
}
console.log('1936: note on a dish in the order');

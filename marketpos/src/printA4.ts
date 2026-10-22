/**
 * Any document on A4 (1.5.47): a plain table page printed through the system
 * dialog, so any office printer - or "Save as PDF" - takes it.
 */
export type A4Doc = {
  title: string; number?: string; date?: string;
  meta?: [string, string][]; head: string[]; rows: (string | number)[][]; totals?: [string, string][];
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function a4Html(doc: A4Doc): string {
  const meta = (doc.meta ?? []).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  const totals = (doc.totals ?? []).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number || doc.title)}</title><style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0}
h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:12px}.meta,.totals{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin:10px 0}
.meta div,.totals div{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb;padding:2px 0}.meta span,.totals span{color:#555}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eee}
td.n{text-align:right;white-space:nowrap}.sign{display:flex;justify-content:space-between;margin-top:36px}.sign div{width:40%;border-top:1px solid #333;padding-top:4px;color:#555}
</style></head><body><h1>${esc(doc.title)}${doc.number ? ' · ' + esc(doc.number) : ''}</h1><div class="sub">${esc(doc.date ?? new Date().toLocaleString('az-AZ'))}</div>
<div class="meta">${meta}</div><table><thead><tr>${doc.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${doc.rows
    .map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="totals">${totals}</div><div class="sign"><div>Təhvil verdi</div><div>Təhvil aldı</div></div></body></html>`;
}

export function printDocA4(doc: A4Doc): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const win = frame.contentWindow!;
  win.document.open();
  win.document.write(a4Html(doc));
  win.document.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.onafterprint = done;
  setTimeout(() => { win.focus(); win.print(); done(); }, 150);
}

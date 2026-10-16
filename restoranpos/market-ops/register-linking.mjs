/** Keep shared sale identities fixed while allowing labels and branches to change. */
export function patchRegisterLinking(source) {
  if (source.includes('POS_MARKET_REGISTERS_v1')) return source;
  const start=source.indexOf('function OpsKassalar() {'),end=source.indexOf('\n}',start)+2;
  if(start<0||end<start)throw new Error('Market cash account component missing');
  let component=source.slice(start,end);
  const replace=(before,after)=>{if(!component.includes(before))throw new Error('Market cash account patch missing: '+before);component=component.replace(before,after)};
  replace('return h("div", { className: "space-y-4" },', `return h("div", { className: "space-y-4 ps-market-linked-registers" },
    h("p", { className: "ps-recipe-note" }, psAdminText("Satış kassaları əsas Kassalar bölməsi ilə ortaqdır. Burada ad və filialı dəyişə bilərsiniz; növbəni əsas Kassalar bölməsindən açıb bağlayın.", "Satış kasaları ana Kasalar bölümüyle ortaktır. Burada ad ve şubeyi düzenleyin; vardiyayı ana Kasalar bölümünden açıp kapatın.", "Sale registers are shared with the main Registers section. Edit labels and branches here; open or close shifts from Registers.")),`);
  replace('value: form.terminalId, className: field,', 'value: form.terminalId, disabled: Boolean(form.id) && String(form.terminalId || "").startsWith("market-"), className: field,');
  replace('disabled: busy, onClick: () => void remove(a), children: "Bağla"', 'disabled: busy || String(a.terminalId || "").startsWith("market-"), onClick: () => void remove(a), children: String(a.terminalId || "").startsWith("market-") ? psAdminText("Satış kassasına bağlıdır", "Satış kasasına bağlı", "Linked to sale register") : "Bağla"');
  return source.slice(0,start)+'// POS_MARKET_REGISTERS_v1\n'+component+source.slice(end);
}

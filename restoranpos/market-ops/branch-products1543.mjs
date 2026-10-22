import fs from 'node:fs';
export function patchBranchProducts1543(source) {
  if(source.includes('POS_MARKET_BRANCH_PRODUCTS_1543'))return source;
  const start=source.indexOf('function OpsPurchases('),end=source.indexOf('\nfunction ',start+1);
  if(start<0||end<0)throw Error('1543 purchase screen missing');
  let body=source.slice(start,end);
  const replace=(a,b)=>{if(!body.includes(a))throw Error('1543 purchase anchor missing: '+a.slice(0,100));body=body.replace(a,b);};
  replace('  const [productForm,setProductForm]', '  const [branchImportBusy,setBranchImportBusy]=reactExports.useState(false);\n  const [productForm,setProductForm]');
  replace('jsxRuntimeExports.jsx(PsMarketProductPicker,{items:data.ingredients,value:l.ingredientId,onChange:id=>setLine(form,setForm,i,{ingredientId:id})})', `jsxRuntimeExports.jsx(PsMarketBranchProductPicker,{items:data.ingredients,value:l.ingredientId,allowForeign:form===invoice,disabled:busy||branchImportBusy,onBusy:setBranchImportBusy,onImported:good=>setData(d=>({...d,ingredients:[...d.ingredients.filter(g=>g.id!==good.id),good]})),onChange:(id,good)=>setForm(current=>current?{...current,lines:current.lines.map((line,index)=>index===i?{...line,ingredientId:id,price:line.price||((Number(good?.costMinor)||0)/100).toFixed(2)}:line)}:current)})`);
  // Never submit while a foreign card is being resolved to a local id.
  replace('  const saveInvoice = (', '  const saveInvoice = (');
  body=body.replaceAll('disabled: (busy)', 'disabled: (busy || branchImportBusy)');
  source=source.slice(0,start)+body+source.slice(end);
  return source+'\n// POS_MARKET_BRANCH_PRODUCTS_1543\n'+fs.readFileSync(new URL('./branch-products1543.js',import.meta.url),'utf8');
}

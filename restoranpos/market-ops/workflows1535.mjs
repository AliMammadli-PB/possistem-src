import fs from 'node:fs';
export function patchMarket1535(source){
 if(source.includes('POS_MARKET_WORKFLOWS_1535'))return source;
 const section=(name,fn)=>{const a=source.indexOf('function '+name+'('),b=source.indexOf('\nfunction ',a+1);if(a<0||b<0)throw Error('1535 component missing: '+name);source=source.slice(0,a)+fn(source.slice(a,b))+source.slice(b);};
 section('OpsPartners',()=>fs.readFileSync(new URL('./partners1535.js',import.meta.url),'utf8'));
 section('OpsPurchases',s=>{
  s=s.replace('  const [productForm,setProductForm]', '  const [supplierForm,setSupplierForm]=reactExports.useState(null);\n  const [productForm,setProductForm]');
  s=s.replace('invoice && !productForm ?', 'invoice && !productForm && !supplierForm ?');
  const a=s.indexOf('    allowNew && !form.supplierId ?'),b=s.indexOf(' : null);',a);
  if(a<0||b<0)throw Error('1535 purchase supplier picker missing');
  s=s.slice(0,a)+'    allowNew ? jsxRuntimeExports.jsx(OpsButton,{onClick:()=>setSupplierForm({type:"supplier",name:"",phone:"",address:"",companyName:"",note:""}),children:psMarketWords("+ Yeni təchizatçı","+ Новый поставщик","+ New supplier")}) : null);'+s.slice(b+9);
  s=s.replace('    productForm ? jsxRuntimeExports.jsx(PsGoodDialog', '    supplierForm ? jsxRuntimeExports.jsx(PsMarketPartnerForm,{initial:supplierForm,onClose:()=>setSupplierForm(null),onSaved:async(saved)=>{setData(d=>({...d,suppliers:[...d.suppliers.filter(s=>s.id!==saved.id),saved]}));setInvoice(p=>({...p,supplierId:saved.id,newSupplier:""}));setSupplierForm(null);}}) : null,\n    productForm ? jsxRuntimeExports.jsx(PsGoodDialog');
  return s;
 });
 section('OpsKassalar',s=>{
  s=s.replace('Satış kassaları əsas Kassalar bölməsi ilə ortaqdır. Burada ad və filialı dəyişə bilərsiniz; növbəni əsas Kassalar bölməsindən açıb bağlayın.','Kassanı seçin: hər kassanın növbəsi, X/Z hesabatı və pul hərəkətləri ayrıca idarə olunur.').replace('Satış kasaları ana Kasalar bölümüyle ortaktır. Burada ad ve şubeyi düzenleyin; vardiyayı ana Kasalar bölümünden açıp kapatın.','Выберите кассу: смена, X/Z и движения денег ведутся отдельно.').replace('Sale registers are shared with the main Registers section. Edit labels and branches here; open or close shifts from Registers.','Each till has its own shift, X/Z reports and money movements.');
  const anchor='jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openMoves(a), children: "Hərəkətlər" })';
  if(!s.includes(anchor))throw Error('1535 till card actions missing');
  s=s.replace(anchor,`a.kind==="till"&&String(a.terminalId||"").startsWith("market-")?jsxRuntimeExports.jsx(OpsButton,{onClick:()=>{const host=window.parent;host.dispatchEvent(new host.CustomEvent("market:register-open",{detail:a.terminalId.slice(7)}));},children:psMarketWords("Növbə · X/Z","Смена · X/Z","Shift · X/Z")}):null,${anchor}`);
  return s;
 });
 return source+'\n// POS_MARKET_WORKFLOWS_1535\n';
}

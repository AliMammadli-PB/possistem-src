#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'index-DAmHwBc4.js');
const mark='/* POS_RECEIPT_PANEL_v1 */';
let source=fs.readFileSync(file,'utf8');
function once(value,needle,replacement,label){
  const count=value.split(needle).length-1;
  if(count!==1)throw Error(`${label}: expected one anchor, found ${count}`);
  return value.replace(needle,replacement);
}
function cut(value,begin,end,replacement,label){
  const a=value.indexOf(begin),b=value.indexOf(end,a+begin.length);
  if(a<0||b<0)throw Error(`${label}: anchors missing`);
  return value.slice(0,a)+replacement+value.slice(b);
}
if(!source.includes(mark)){
  const panel=await transform(fs.readFileSync(path.join(root,'scripts/admin-ui/receipt-settings-panel.jsx'),'utf8'),
    {loader:'jsx',jsxFactory:'reactExports.createElement',jsxFragment:'reactExports.Fragment',target:'es2022'});
  source=once(source,'function RestaurantInfoSettings() {',
    `function psReceiptBrandFromDraft(d) { return {name:d["restaurant.name"],tagline:d["restaurant.tagline"],address:d["restaurant.address"],phone:d["restaurant.phone"],hours:d["restaurant.hours"],taxId:d["restaurant.taxId"],branch:d["branch.name"]}; }\n${panel.code}\nfunction RestaurantInfoSettings({onDraftChange}) {`,
    'receipt panel insertion');

  const restaurantStart=source.indexOf('function RestaurantInfoSettings({onDraftChange})');
  const restaurantEnd=source.indexOf('const LANGS =',restaurantStart);
  let restaurant=source.slice(restaurantStart,restaurantEnd);
  restaurant=cut(restaurant,'  const [logo, setLogo]','  reactExports.useEffect(() => {','', 'remove duplicated logo and preview state');
  restaurant=once(restaurant,'      setDraft(next);\n      if (typeof all["printer.logoDataUrl"] === "string") setLogo(all["printer.logoDataUrl"]);\n      setQrUrl(typeof all["receipt.qrUrl"] === "string" ? all["receipt.qrUrl"] : "");\n      setQrOn(String(all["printer.qr"] ?? "1") !== "0");',
    '      setDraft(next);\n      onDraftChange?.(psReceiptBrandFromDraft(next));','brand load');
  restaurant=once(restaurant,'          onChange: (e) => setDraft((prev) => ({ ...prev, [key]: e.target.value })),',
    '          onChange: (e) => setDraft((prev) => { const next={...prev,[key]:e.target.value}; onDraftChange?.(psReceiptBrandFromDraft(next)); return next; }),','brand edit');
  restaurant=once(restaurant,'    setDraft(applied);\n    toast(t.settings.restaurantSaved, "success");',
    '    setDraft(applied);\n    onDraftChange?.(psReceiptBrandFromDraft(applied));\n    toast(t.settings.restaurantSaved, "success");','saved brand preview');
  restaurant=cut(restaurant,
    '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-xl border border-hairline p-3", children: [',
    '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [',
    '', 'remove old logo controls');
  restaurant=cut(restaurant,
    '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [',
    '  ] })\n  ] });',
    '    /* @__PURE__ */ jsxRuntimeExports.jsx("button", {type:"button",disabled:!dirty||saving||loading,onClick:()=>void save(),className:"touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:opacity-40",children:saving?t.common.saving:t.common.save})\n',
    'remove second preview');
  source=source.slice(0,restaurantStart)+restaurant+source.slice(restaurantEnd);

  source=once(source,'{ id: "restaurant", label: "Restoran", hint: "Hesab və qəbz", icon: Store, tone: "blue" },',
    '{ id: "restaurant", label: "Restoran", hint: "Hesab və məlumat", icon: Store, tone: "blue" },','navigation restaurant hint');
  source=once(source,'{ id: "printer", label: "Printer", hint: "Qəbz və çap", icon: ReceiptText, tone: "green" },',
    '{ id: "printer", label: "Printer", hint: "Cihazları qoşun", icon: ReceiptText, tone: "green" },\n    { id: "receipt", label: psAdminText("Çek", "Fiş", "Receipt"), hint: psAdminText("Loqo, QR və kağız", "Logo, QR ve kağıt", "Logo, QR and paper"), icon: FileText, tone: "blue" },','receipt navigation');

  const settingsStart=source.indexOf('function SettingsPage()');
  const settingsEnd=source.indexOf('const ICONS =',settingsStart);
  let settings=source.slice(settingsStart,settingsEnd);
  settings=once(settings,'  const savePrinterProfile = async (patch) => {','  const savePrinterProfile = async (patch,notify=true) => {','profile save notification option');
  settings=once(settings,'    toast(t.settings.printerSaved, "success");\n    return true;','    if(notify)toast(t.settings.printerSaved, "success");\n    return true;','profile save single notification');
  settings=once(settings,'  const [receiptLogo, setReceiptLogo] = reactExports.useState("");',
    '  const [receiptLogo, setReceiptLogo] = reactExports.useState("");\n  const [logoBusy,setLogoBusy]=reactExports.useState(false);\n  const logoInput=reactExports.useRef(null);',
    'logo state');
  settings=once(settings,'  const [savingQr, setSavingQr] = reactExports.useState(false);\n','', 'remove split QR save');
  settings=once(settings,
    '  const printDraft = () => psPrintInput({paperWidth,dpi,printableDots,charsPerLine,renderMode,fontHeightPx,fontWidthPx,sideMarginPx,currencyDisplay,qrOn,qrUrl});',
    `  const pickReceiptLogo=async file=>{
    if(!file)return;
    setLogoBusy(true);
    try{
      const assets=await logoAssetsFromFile(file);
      if(assets.dataUrl.length>LOGO_MAX_BYTES)throw Error(psAdminText('Loqo çox böyükdür','Logo çok büyük','Logo is too large'));
      let ink=0;const hex=assets.raster.hex;
      for(let i=0;i<hex.length;i+=2){let bits=parseInt(hex.slice(i,i+2),16);while(bits){ink+=bits&1;bits>>=1;}}
      if(ink/(assets.raster.w*assets.raster.h)>.8)throw Error(psAdminText('Şəklin çox hissəsi qaradır. Ağ və ya şəffaf fonlu loqo seçin.','Görselin büyük bölümü siyah. Beyaz veya şeffaf arka planlı logo seçin.','The image is mostly black. Choose a white or transparent background.'));
      const result=await window.pos.receiptLogo.apply(assets);
      if(!result.success)throw Error(result.error?.message||psAdminText('Loqo saxlanmadı','Logo kaydedilemedi','Logo could not be saved'));
      setReceiptLogo(assets.dataUrl);
      toast(psAdminText('Loqo saxlanıldı','Logo kaydedildi','Logo saved'),'success');
    }catch(error){toast(error.message||psAdminText('Şəkil oxunmadı','Görsel okunamadı','Image could not be read'),'danger');}
    finally{setLogoBusy(false);if(logoInput.current)logoInput.current.value='';}
  };
  const clearReceiptLogo=async()=>{
    setLogoBusy(true);
    try{const result=await window.pos.receiptLogo.clear();if(!result.success)throw Error(result.error?.message||'Logo could not be removed');setReceiptLogo('');}
    catch(error){toast(error.message,'danger');}finally{setLogoBusy(false);}
  };
  const printDraft = () => psPrintInput({paperWidth,dpi,printableDots,charsPerLine,renderMode,fontHeightPx,fontWidthPx,sideMarginPx,currencyDisplay,qrOn,qrUrl,brand:receiptBrand});`,
    'unified preview data and logo actions');
  settings=once(settings,'    setPreviewing(true);\n    try {', '    setPreviewing(true);setPreviewHtml(null);\n    try {','stale preview reset');
  const saveStart=settings.indexOf('  const savePrintTuning = async () => {');
  const saveEnd=settings.indexOf('  const toggleReduceMotion =',saveStart);
  if(saveStart<0||saveEnd<0)throw Error('savePrintTuning missing');
  settings=settings.slice(0,saveStart)+`  const savePrintTuning = async () => {
    if(savingPrint)return;
    let profile;try{profile=printDraft();}catch(error){toast(error.message,'danger');return;}
    const key=profile.paperWidth===58?'printer.charsPerLine58':profile.paperWidth===80?'printer.charsPerLine80':'printer.charsPerLine';
    setSavingPrint(true);
    try{
      const ok=await savePrinterProfile({'printer.paperWidth':profile.paperWidth,'printer.dpi':profile.dpi,'printer.printableDots':profile.printableDots,[key]:profile.charsPerLine,'printer.fontHeightPx':profile.fontHeightPx,'printer.fontWidthPx':profile.fontWidthPx,'printer.sideMarginPx':profile.sideMarginPx,'printer.renderMode':profile.renderMode,'locale.currencyDisplay':profile.currencyDisplay,'printer.qr':profile.qrOn?1:0},false);
      if(!ok)return;
      const qr=await window.pos.settings.set('receipt.qrUrl',profile.qrUrl);
      if(!qr.success)throw Error(qr.error?.message||psAdminText('QR linki saxlanmadı','QR bağlantısı kaydedilemedi','QR link could not be saved'));
      toast(psAdminText('Çek ayarları saxlanıldı','Fiş ayarları kaydedildi','Receipt settings saved'),'success');
    }catch(error){toast(error.message,'danger');}finally{setSavingPrint(false);}
  };
`+settings.slice(saveEnd);
  settings=once(settings,'      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "workspace", children:\n        /* @__PURE__ */ jsxRuntimeExports.jsx(RestaurantInfoSettings, {})\n      }) : null,','', 'move header editor to receipt');
  const profileStart=settings.indexOf('        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [', settings.indexOf('className: "ps-printer-legacy-hint"'));
  const systemStart=settings.indexOf('      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "system"',profileStart);
  if(profileStart<0||systemStart<0)throw Error('printer receipt controls missing');
  const receipt=`      ] }),
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsAccordion,{id:"receipt",title:psAdminText("Çek ayarları","Fiş ayarları","Receipt settings"),hint:psAdminText("Loqo, QR kod, başlıq və kağız görünüşü","Logo, QR kod, başlık ve kağıt görünümü","Logo, QR, header and paper layout"),children:
        hasPermission("settings.manage") ? jsxRuntimeExports.jsx(PsReceiptSettingsPanel,{
          t,brand:receiptBrand,brandEditor:jsxRuntimeExports.jsx(RestaurantInfoSettings,{onDraftChange:setReceiptBrand}),
          logo:receiptLogo,logoBusy,logoInput,onPickLogo:file=>void pickReceiptLogo(file),onClearLogo:()=>void clearReceiptLogo(),
          qrOn,setQrOn,qrUrl,setQrUrl,paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,
          charsPerLine,setCharsPerLine,fontHeightPx,setFontHeightPx,fontWidthPx,setFontWidthPx,
          sideMarginPx,setSideMarginPx,renderMode,setRenderMode,currencyDisplay,setCurrencyDisplay,
          savingPrint,previewing,onSave:()=>void savePrintTuning(),onPreview:()=>void runPreview()
        }) : null}),
`;
  settings=settings.slice(0,profileStart)+receipt+settings.slice(systemStart);
  settings=once(settings,
    'previewHtml ? jsxRuntimeExports.jsx(PsReceiptDialog, {html:previewHtml,meta:previewMeta,onClose:()=>setPreviewHtml(null)}) : null',
    'previewHtml ? jsxRuntimeExports.jsx(PsReceiptDialog, {html:previewHtml,meta:previewMeta,sample:true,onClose:()=>setPreviewHtml(null)}) : null',
    'mark sample receipt preview');
  source=source.slice(0,settingsStart)+settings+source.slice(settingsEnd);
  source=mark+'\n'+source;
  await transform(source,{loader:'js',target:'es2022'});
  fs.writeFileSync(file,source);
  console.log('Unified receipt settings panel applied');
}else console.log('Receipt panel already applied');

const cssPath=path.join(root,'possistem-system.css');
let css=fs.readFileSync(cssPath,'utf8');
const cssStart='/* POS_RECEIPT_PANEL_CSS_START */',cssEnd='/* POS_RECEIPT_PANEL_CSS_END */';
if(css.includes(cssStart)){const a=css.indexOf(cssStart),b=css.indexOf(cssEnd,a);if(b<0)throw Error('Receipt CSS end missing');css=css.slice(0,a).replace(/\n+$/,'\n')+css.slice(b+cssEnd.length).replace(/^\n+/,'');}
css=css.trimEnd()+'\n'+cssStart+'\n'+fs.readFileSync(path.join(root,'scripts/admin-ui/receipt-settings-panel.css'),'utf8')+'\n'+cssEnd+'\n';
fs.writeFileSync(cssPath,css);

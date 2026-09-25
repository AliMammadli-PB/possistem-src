import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
function once(a,b){const n=s.split(a).length-1;if(n!==1)throw Error(`Expected one anchor (${n}): ${a.slice(0,90)}`);s=s.replace(a,b);}
function section(a,b,fn){const x=s.indexOf(a),y=s.indexOf(b,x+a.length);if(x<0||y<0)throw Error('Missing section '+a);s=s.slice(0,x)+fn(s.slice(x,y))+s.slice(y);}
const mark='/* POS_TOUCH_RECEIPT_v1 */';
if(!s.includes(mark)) {
  // A preview must use the returned document, never a hard-coded visual fallback.
  section('function receiptHtmlLooksUseful(', 'function ', x=>x); // anchors checked below
  const mockStart=s.indexOf('function receiptHtmlLooksUseful(');
  const mockEnd=s.indexOf('\nfunction ',s.indexOf('function buildReceiptMockHtml(',mockStart)+10);
  if(mockStart>=0&&mockEnd>mockStart)s=s.slice(0,mockStart)+s.slice(mockEnd+1);
  const qrStart=s.indexOf('const psQrDataUrl = (() => {');
  const qrEnd=s.indexOf('function RestaurantInfoSettings()',qrStart);
  if(qrStart<0||qrEnd<0)throw Error('Missing old receipt helpers');
  s=s.slice(0,qrStart)+s.slice(qrEnd);
  section('function RestaurantInfoSettings()', 'const LANGS =',x=>{
    x=x.replace('  const [qrUrl, setQrUrl]', '  const [previewMeta, setPreviewMeta] = reactExports.useState("");\n  const [previewBusy, setPreviewBusy] = reactExports.useState(false);\n  const previewRequest = reactExports.useRef(0);\n  const [qrUrl, setQrUrl]');
    const a=x.indexOf('  const refreshPreview ='),b=x.indexOf('  const pickLogo =',a);
    x=x.slice(0,a)+`  const refreshPreview = async () => {
    const request = ++previewRequest.current;
    setPreviewBusy(true);
    try {
      const res = await window.pos.print.previewTest({brand: {
        name:draft["restaurant.name"],tagline:draft["restaurant.tagline"],address:draft["restaurant.address"],phone:draft["restaurant.phone"],hours:draft["restaurant.hours"],taxId:draft["restaurant.taxId"],branch:draft["branch.name"]
      }});
      if(request!==previewRequest.current)return;
      if(!res.success || !res.data?.html) throw Error(res.error?.message || psAdminText('Önizləmə alınmadı','Önizleme başarısız','Preview failed'));
      setPreviewHtml(res.data.html);setPreviewMeta(psPreviewMeta(res.data));
    } catch(error) { if(request===previewRequest.current) toast(error.message,'danger'); }
    finally { if(request===previewRequest.current)setPreviewBusy(false); }
  };
  reactExports.useEffect(()=>()=>{previewRequest.current++;},[]);
`+x.slice(b);
    x=x.replace('onClick: () => setPreviewHtml(previewHtml ? null : "paper"),','disabled: previewBusy, onClick: () => void refreshPreview(),');
    const start=x.indexOf('    previewHtml ?'),end=x.indexOf(' : null',start)+7;
    if(start<0||end<7)throw Error('Missing restaurant preview');
    x=x.slice(0,start)+'    previewHtml ? jsxRuntimeExports.jsx(PsReceiptDialog, {html:previewHtml,meta:previewMeta,onClose:()=>setPreviewHtml(null)}) : null'+x.slice(end);
    return x;
  });
  section('function SettingsPage()', 'const ICONS =', x=>{
    x=x.replace('  const [paperWidth, setPaperWidth] = reactExports.useState(80);','  const [paperWidth, setPaperWidth] = reactExports.useState(80);\n  const [dpi,setDpi] = reactExports.useState(203);\n  const [printableDots,setPrintableDots] = reactExports.useState(0);\n  const previewRequest = reactExports.useRef(0);\n  const testPrintLock = reactExports.useRef(false);\n  reactExports.useEffect(()=>()=>{previewRequest.current++;},[]);');
    x=x.replace('      if (data.profile?.paperWidth) setPaperWidth(data.profile.paperWidth);','      if (data.profile?.paperWidth) setPaperWidth(data.profile.paperWidth);\n      setDpi(data.profile?.dpi ?? 203);\n      setPrintableDots(data.profile?.printableDots ?? 0);');
    x=x.replace('const cols = mm <= 64 ? data.profile?.charsPerLine58 ?? data.profile?.charsPerLine ?? 28 : data.profile?.charsPerLine80 ?? data.profile?.charsPerLine ?? 40;','const cols = data.profile?.charsPerLine ?? (mm === 58 ? 28 : 40);');
    const a=x.indexOf('  const runPreview ='),b=x.indexOf('  const savePrintTuning =',a);
    x=x.slice(0,a)+`  const printDraft = () => psPrintInput({paperWidth,dpi,printableDots,charsPerLine,renderMode,fontHeightPx,fontWidthPx,sideMarginPx,currencyDisplay,qrOn,qrUrl});
  const runPreview = async () => {
    const request=++previewRequest.current;
    setPreviewing(true);
    try {
      const res=await window.pos.print.previewTest(printDraft());
      if(request!==previewRequest.current)return;
      if(!res.success || !res.data?.html)throw Error(res.error?.message || psAdminText('Önizləmə alınmadı','Önizleme başarısız','Preview failed'));
      setPreviewHtml(res.data.html);setPreviewMeta(psPreviewMeta(res.data));
    }catch(error){if(request===previewRequest.current)toast(error.message,'danger');}
    finally{if(request===previewRequest.current)setPreviewing(false);}
  };
`+x.slice(b);
    const c=x.indexOf('  const savePrintTuning ='),d=x.indexOf('  const toggleReduceMotion =',c);
    x=x.slice(0,c)+`  const savePrintTuning = async () => {
    let profile;try{profile=printDraft();}catch(error){toast(error.message,'danger');return;}
    const key=profile.paperWidth===58?'printer.charsPerLine58':profile.paperWidth===80?'printer.charsPerLine80':'printer.charsPerLine';
    setSavingPrint(true);
    try {await savePrinterProfile({'printer.paperWidth':profile.paperWidth,'printer.dpi':profile.dpi,'printer.printableDots':profile.printableDots,[key]:profile.charsPerLine,'printer.fontHeightPx':profile.fontHeightPx,'printer.fontWidthPx':profile.fontWidthPx,'printer.sideMarginPx':profile.sideMarginPx});}
    catch(error){toast(error.message,'danger');}finally{setSavingPrint(false);}
  };
`+x.slice(d);
    // Test print uses exactly the same unsaved profile as preview, with a synchronous double-tap guard.
    x=x.replace('    const wanted = target ?? currentPrinterTarget();','    if(testPrintLock.current)return;\n    const wanted = target ?? currentPrinterTarget();');
    x=x.replace('    setTestingPrint(true);\n    const res = await window.pos.print.enqueue(','    let options;try{options=printDraft();}catch(error){toast(error.message,"danger");return;}\n    testPrintLock.current=true;setTestingPrint(true);\n    let res;try{res = await window.pos.print.enqueue(');
    x=x.replace('        paperWidth,\n        renderMode,\n        charsPerLine,\n        fontHeightPx,\n        fontWidthPx,\n        sideMarginPx','        ...options');
    x=x.replace('    setTestingPrint(false);','    }catch(error){toast(error.message,"danger");return;}finally{testPrintLock.current=false;setTestingPrint(false);}');
    const field=x.indexOf('          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [\n            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs uppercase tracking-wide text-faint", children: t.settings.paperWidthMm })');
    const fieldEnd=x.indexOf('          /* @__PURE__ */ jsxRuntimeExports.jsxs("label",',field+20);
    if(field<0||fieldEnd<0)throw Error('Missing paper input');
    x=x.slice(0,field)+'          jsxRuntimeExports.jsx(PsPrintGeometry, {paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,setCharsPerLine,fontWidthPx}),\n'+x.slice(fieldEnd);
    const start=x.indexOf('    previewHtml ?'),end=x.indexOf(' : null,',start)+8;
    if(start<0||end<8)throw Error('Missing settings preview');
    x=x.slice(0,start)+'    previewHtml ? jsxRuntimeExports.jsx(PsReceiptDialog, {html:previewHtml,meta:previewMeta,onClose:()=>setPreviewHtml(null)}) : null,'+x.slice(end);
    return x;
  });
  section('function ReceiptPage()', '\nfunction ',x=>{
    x=x.replace('useState(80)','useState(0)');
    x=x.replace('      paperWidth: paper','      ...(paper ? {paperWidth:paper} : {})');
    x=x.replace('if (paper === 58) return preview.text58 ?? preview.text ?? "";\n    return preview.text80 ?? preview.text ?? "";','return preview.text ?? "";');
    x=x.replace('if (paper === 58) return preview.html58 ?? preview.html ?? "";\n    return preview.html80 ?? preview.html ?? "";','return preview.html ?? "";');
    x=x.replace('{ orderId, kind: "customer_receipt", paperWidth: paper }','{ orderId, kind: "customer_receipt", ...(paper ? {paperWidth:paper} : {}) }');
    const a=x.indexOf('        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex rounded-xl border border-hairline p-1", children: [58, 80]');
    const b=x.indexOf('        /* @__PURE__ */ jsxRuntimeExports.jsx("div",',a+20);
    if(a<0||b<0)throw Error('Missing receipt paper buttons');
    return x.slice(0,a)+'        jsxRuntimeExports.jsx(PsPaperSelect,{value:paper,onChange:setPaper,configured:true}),\n'+x.slice(b);
  });
  s=s.replace('{ orderId: order.id, kind: "customer_bill", paperWidth: 80 }','{ orderId: order.id, kind: "customer_bill" }');
  // Bound logo decoding and preserve its aspect ratio. Both saved assets are monochrome.
  s=s.replace('  const url = URL.createObjectURL(file);','  if(file.size > 8*1024*1024)throw Error("Logo exceeds 8 MB");\n  const url = URL.createObjectURL(file);');
  s=s.replace('    return image;\n  } finally','    if(!image.naturalWidth || !image.naturalHeight || image.naturalWidth*image.naturalHeight>16000000)throw Error("Logo dimensions too large");\n    return image;\n  } finally');
  s=s.replace('  const scale = width / image.naturalWidth;','  const scale = Math.min(width / image.naturalWidth, 512 / image.naturalHeight,1);\n  width = Math.max(1,Math.round(image.naturalWidth*scale));');
  const a=s.indexOf('async function logoAssetsFromFile('),b=s.indexOf('\n/* POS_SETTINGS_RECEIPT_BRAND_v1 */',a);
  if(a<0||b<0)throw Error('Missing logo assets');
  s=s.slice(0,a)+`async function logoAssetsFromFile(file) {
    const image=await decodeLogoFile(file),raster=logoRasterFrom(image);
    const canvas=document.createElement('canvas');canvas.width=raster.w;canvas.height=raster.h;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,raster.w,raster.h);ctx.fillStyle='black';
    const stride=Math.ceil(raster.w/8);
    for(let y=0;y<raster.h;y++)for(let x=0;x<raster.w;x++)if(parseInt(raster.hex.slice((y*stride+(x>>3))*2,(y*stride+(x>>3))*2+2),16)&(128>>(x&7)))ctx.fillRect(x,y,1,1);
    return {dataUrl:canvas.toDataURL('image/png'),raster};
  }
`+s.slice(b);
  s=mark+'\n'+s;
}
const helpers=await transform(fs.readFileSync(path.join(root,'scripts/admin-ui/receipt-controls.jsx'),'utf8'),{loader:'jsx',jsxFactory:'reactExports.createElement',jsxFragment:'reactExports.Fragment',target:'es2022'});
const start='/* POS_RECEIPT_CONTROLS_START */',end='/* POS_RECEIPT_CONTROLS_END */';
const block=start+'\n'+helpers.code+end+'\n';
if(s.includes(start)){const a=s.indexOf(start),b=s.indexOf(end,a)+end.length+1;s=s.slice(0,a)+block+s.slice(b);}else s=s.replace('function RestaurantInfoSettings()',block+'function RestaurantInfoSettings()');
await transform(s,{loader:'js',target:'es2022'});
fs.writeFileSync(file,s);
console.log('Touch receipt controls applied');

const cssPath=path.join(root,'possistem-system.css');
let css=fs.readFileSync(cssPath,'utf8');
const cssStart='/* POS_TOUCH_RECEIPT_CSS_START */',cssEnd='/* POS_TOUCH_RECEIPT_CSS_END */';
const cssBlock=cssStart+'\n'+fs.readFileSync(path.join(root,'scripts/admin-ui/touch-receipt.css'),'utf8')+cssEnd+'\n';
if(css.includes(cssStart)){const a=css.indexOf(cssStart);let b=css.indexOf(cssEnd,a)+cssEnd.length;while(css[b]==='\n'||css[b]==='\r')b++;css=css.slice(0,a)+css.slice(b);}
fs.writeFileSync(cssPath,css.trimEnd()+'\n'+cssBlock);

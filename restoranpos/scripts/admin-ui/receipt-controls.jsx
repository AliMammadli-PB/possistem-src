/* Receipt controls for the recovered renderer. Native core owns all receipt content. */
const PS_PAPER_WIDTHS = [44.5,57.5,58,69.5,76,79.5,80,82.5,112];
function psPaperDots(mm, dpi = 203) {
  if (dpi === 203 && mm >= 57.5 && mm <= 58) return 384;
  if (dpi === 203 && mm >= 79.5 && mm <= 80) return 576;
  const usable = mm >= 79.5 && mm <= 80 ? 72 : mm - 10;
  return Math.max(128, Math.floor(usable * dpi / 25.4 / 8) * 8);
}
function psPrintInput(options) {
  const o = {...options};
  for (const key of ['paperWidth','dpi','printableDots','charsPerLine','fontHeightPx','fontWidthPx','sideMarginPx']) {
    o[key] = Number(o[key]);
    if (!Number.isFinite(o[key])) throw new Error(psAdminText('Çap parametrlərini yoxlayın','Yazdırma ayarlarını kontrol edin','Check print settings'));
  }
  if (o.paperWidth < 40 || o.paperWidth > 120 || o.dpi < 180 || o.dpi > 600 || o.charsPerLine < 16 || o.charsPerLine > 96)
    throw new Error(psAdminText('Kağız eni 40–120 mm olmalıdır; DPI və sütunları yoxlayın','Kağıt genişliği 40–120 mm olmalı; DPI ve sütunları kontrol edin','Paper must be 40–120 mm; check DPI and columns'));
  const dots = o.printableDots || psPaperDots(o.paperWidth,o.dpi);
  if (!Number.isInteger(dots) || dots % 8 || dots < 128 || dots > Math.floor(o.paperWidth*o.dpi/25.4/8)*8 || dots - 2*o.sideMarginPx < o.charsPerLine*6)
    throw new Error(psAdminText('Çap eni və sütunlar kağıza sığmır','Baskı alanı ve sütunlar kağıda sığmıyor','Printable width and columns do not fit the paper'));
  return o;
}
function PsPaperSelect({value,onChange,configured=false}) {
  const [custom,setCustom] = reactExports.useState(!PS_PAPER_WIDTHS.includes(Number(value)) && Number(value)!==0);
  return <div className="ps-paper-select">
    <select aria-label={psAdminText('Kağız ölçüsü','Kağıt boyutu','Paper size')} value={custom?'custom':String(value)} onChange={e=>{
      if(e.target.value==='custom') {setCustom(true); if(!Number(value)) onChange(80);}
      else {setCustom(false);onChange(Number(e.target.value));}
    }}>
      {configured && <option value="0">{psAdminText('Printer parametri','Yazıcı ayarı','Printer setting')}</option>}
      {PS_PAPER_WIDTHS.map(mm=><option key={mm} value={mm}>{mm} mm</option>)}
      <option value="custom">{psAdminText('Xüsusi ölçü','Özel boyut','Custom size')}</option>
    </select>
    {custom && <input aria-label={psAdminText('Xüsusi ölçü (mm)','Özel boyut (mm)','Custom size (mm)')} type="number" inputMode="decimal" min="40" max="120" step="0.1" value={value} onChange={e=>onChange(e.target.value)}/>}
  </div>;
}
function PsPrintGeometry({paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,setCharsPerLine,fontWidthPx}) {
  const change = (mm, density=dpi, dots=0) => {
    setPaperWidth(mm);setDpi(density);setPrintableDots(dots);
    const width = dots || psPaperDots(Number(mm),Number(density));
    setCharsPerLine(Math.max(16, Math.min(96,Math.floor((width-4)/(Number(fontWidthPx)||14)))));
  };
  return <div className="ps-print-geometry">
    <label><span>{psAdminText('Kağız eni','Kağıt genişliği','Paper width')}</span><PsPaperSelect value={paperWidth} onChange={mm=>change(mm)}/></label>
    <label><span>DPI</span><input type="number" inputMode="numeric" min="180" max="600" step="1" value={dpi} onChange={e=>change(paperWidth,e.target.value)}/></label>
    <label><span>{psAdminText('Çap eni (nöqtə)','Baskı genişliği (nokta)','Printable width (dots)')}</span><input type="number" inputMode="numeric" min="0" step="8" value={printableDots} onChange={e=>change(paperWidth,dpi,Number(e.target.value))}/></label>
    <p>{psAdminText('0 = avtomatik. Dəqiq çap eni və DPI üçün printerin göstəricilərini seçin.','0 = otomatik. Kesin baskı genişliği ve DPI için yazıcı özelliklerini kullanın.','0 = automatic. Use your printer specifications for exact printable width and DPI.')}</p>
  </div>;
}
function PsReceiptDialog({html,meta,onClose,sample=false}) {
  const ref=reactExports.useRef(null);
  const [zoom,setZoom]=reactExports.useState(1);
  const shownHtml=html.includes('</head>')?html.replace('</head>',`<style>.ticket{zoom:${zoom}}</style></head>`):html;
  reactExports.useEffect(()=>{
    const el=ref.current, previous=document.activeElement;
    el?.showModal();
    return ()=>{el?.close();previous?.focus?.();};
  },[]);
  return <dialog ref={ref} className="ps-print-dialog" aria-label={psAdminText('Çek önizləməsi','Fiş önizleme','Receipt preview')}
    onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="ps-print-dialog-inner">
      <header><div><strong>{psAdminText('Çek önizləməsi','Fiş önizleme','Receipt preview')}</strong>
        {sample&&<small>{psAdminText('Nümunə sifariş · oxunaqlı önizləmə','Örnek sipariş · okunabilir önizleme','Sample order · readable preview')}</small>}
        <small>{meta}</small></div>
        <button type="button" autoFocus onClick={onClose}>{psAdminText('Bağla','Kapat','Close')}</button></header>
      <div className="ps-preview-scale" aria-label={psAdminText('Önizləmə miqyası','Önizleme ölçeği','Preview scale')}>
        <span>{psAdminText('Ekran miqyası','Ekran ölçeği','Screen scale')}</span>
        {[1,1.5,2].map(n=><button type="button" key={n} aria-pressed={zoom===n} onClick={()=>setZoom(n)}>{Math.round(n*100)}%</button>)}
      </div>
      <iframe title={psAdminText('Çap ediləcək çek','Yazdırılacak fiş','Receipt to print')} srcDoc={shownHtml} sandbox=""/>
    </div>
  </dialog>;
}
function psPreviewMeta(data) {
  return `${data.paperWidth} mm · ${data.charsPerLine} ${psAdminText('sütun','sütun','columns')} · ${data.printableDots} ${psAdminText('nöqtə','nokta','dots')} · ${data.dpi} DPI`;
}

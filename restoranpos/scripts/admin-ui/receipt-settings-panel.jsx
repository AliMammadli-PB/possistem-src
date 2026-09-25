/* The one receipt workbench in Settings. All controls are usable without hover. */
function PsReceiptSettingsPanel({t,brand,brandEditor,logo,logoBusy,logoInput,onPickLogo,onClearLogo,
  qrOn,setQrOn,qrUrl,setQrUrl,paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,
  charsPerLine,setCharsPerLine,fontHeightPx,setFontHeightPx,fontWidthPx,setFontWidthPx,
  sideMarginPx,setSideMarginPx,renderMode,setRenderMode,currencyDisplay,setCurrencyDisplay,
  savingPrint,previewing,onSave,onPreview}) {
  const tr=psAdminText;
  return <div className="ps-receipt-settings">
    <div className="ps-receipt-intro">
      <div><strong>{tr('Çek görünüşü','Fiş görünümü','Receipt appearance')}</strong>
        <p>{tr('Loqo, QR və kağız ayarları bir yerdə. Önizləmə nümunə sifariş göstərir; çap üçün göndərmir.',
          'Logo, QR ve kağıt ayarları bir arada. Önizleme örnek sipariş gösterir; yazdırmaz.',
          'Logo, QR and paper settings together. Preview shows a sample order and does not print.')}</p></div>
      <span className="ps-receipt-size">{paperWidth} mm</span>
    </div>
    <div className="ps-receipt-assets">
      <section className="ps-receipt-asset">
        <div className="ps-receipt-asset-head"><span className="ps-receipt-asset-icon">▣</span><div>
          <h3>{tr('Çek loqosu','Fiş logosu','Receipt logo')}</h3>
          <p>{tr('Başlıqda ağ-qara çap olunur','Başlıkta siyah-beyaz basılır','Printed in monochrome at the top')}</p>
        </div></div>
        <div className="ps-receipt-logo-preview" aria-label={tr('Loqo görünüşü','Logo görünümü','Logo preview')}>
          {logo?<img src={logo} alt={tr('Saxlanmış çek loqosu','Kayıtlı fiş logosu','Saved receipt logo')}/>:<span>{tr('Loqo seçilməyib','Logo seçilmedi','No logo selected')}</span>}
        </div>
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>onPickLogo(e.target.files?.[0])}/>
        <div className="ps-receipt-asset-actions">
          <button type="button" disabled={logoBusy} onClick={()=>logoInput.current?.click()}>{logoBusy?t.common.saving:tr('Loqo seç','Logo seç','Choose logo')}</button>
          {logo&&<button type="button" disabled={logoBusy} onClick={onClearLogo}>{tr('Sil','Sil','Remove')}</button>}
        </div>
        <small>{tr('Qara fonlu şəkil çekdə qara blok kimi çıxır. Şəffaf və ya ağ fonlu loqo seçin.',
          'Siyah arka plan fişte siyah blok olur. Şeffaf veya beyaz arka planlı logo seçin.',
          'A black background prints as a black block. Choose a transparent or white logo.')}</small>
      </section>
      <section className="ps-receipt-asset">
        <div className="ps-receipt-asset-head"><span className="ps-receipt-asset-icon">▦</span><div>
          <h3>{tr('QR kod','QR kod','QR code')}</h3>
          <p>{tr('Çekdə yalnız QR; link yazılmır','Fişte yalnız QR; bağlantı yazılmaz','QR only on the receipt; link is not printed')}</p>
        </div></div>
        <label className="ps-receipt-toggle"><input type="checkbox" checked={qrOn} onChange={e=>setQrOn(e.target.checked)}/>
          <span>{tr('Çekdə QR göstər','Fişte QR göster','Show QR on receipt')}</span></label>
        <label className="ps-receipt-url"><span>{tr('QR linki','QR bağlantısı','QR link')}</span>
          <input type="url" inputMode="url" value={qrUrl} disabled={!qrOn} placeholder="https://…" onChange={e=>setQrUrl(e.target.value)}/></label>
        <small>{tr('QR-i gizlətmək üçün yuxarıdakı keçidi söndürün. Link boşdursa QR çıxmır; link mətn kimi çap olunmur.',
          'QR’yi gizlemek için yukarıdaki anahtarı kapatın. Bağlantı boşsa QR çıkmaz; bağlantı metin olarak basılmaz.',
          'Turn the switch off to hide QR. An empty link prints no QR; the URL is never printed as text.')}</small>
        {qrOn&&qrUrl.includes('70030076175156383')&&<p className="ps-receipt-warning">{tr('Bu quraşdırma nümunəsinin linkidir. Öz linkinizi yazın.',
          'Bu kurulum örneğinin bağlantısıdır. Kendi bağlantınızı yazın.',
          'This is the setup sample link. Enter your own link.')}</p>}
      </section>
    </div>
    <div className="ps-receipt-actions">
      <button type="button" className="ps-receipt-preview-button" disabled={previewing} onClick={onPreview}>
        {previewing?t.common.loading:tr('Çeki önizlə','Fişi önizle','Preview receipt')}</button>
      <button type="button" className="ps-receipt-save-button" disabled={savingPrint} onClick={onSave}>
        {savingPrint?t.common.saving:tr('Çek ayarlarını saxla','Fiş ayarlarını kaydet','Save receipt settings')}</button>
    </div>
    <div className="ps-receipt-detail-grid">
      <details className="ps-receipt-details"><summary>{tr('Başlıq və restoran məlumatı','Başlık ve restoran bilgileri','Header and restaurant details')}</summary>
        <p>{tr('Restoran adı, ünvan, telefon və iş saatı çekin başlığında görünür.',
          'Restoran adı, adres, telefon ve çalışma saatleri fiş başlığında görünür.',
          'Restaurant name, address, phone and hours appear in the receipt header.')}</p>
        {brandEditor}
      </details>
      <details className="ps-receipt-details"><summary>{tr('Kağız və çap görünüşü','Kağıt ve baskı görünümü','Paper and print appearance')}</summary>
        <p>{tr('Çap eni printerin fiziki göstəricisinə uyğun olmalıdır.',
          'Baskı genişliği yazıcının fiziksel özelliğine uymalıdır.',
          'Printable width must match the physical printer.')}</p>
        <div className="ps-receipt-profile-grid">
          <PsPrintGeometry {...{paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,setCharsPerLine,fontWidthPx}}/>
          {[[tr('Sətirdə simvol','Satırdaki karakter','Characters per line'),charsPerLine,setCharsPerLine,16,96],
            [tr('Şrift hündürlüyü','Yazı yüksekliği','Font height'),fontHeightPx,setFontHeightPx,0,96],
            [tr('Şrift eni','Yazı genişliği','Font width'),fontWidthPx,setFontWidthPx,0,64],
            [tr('Kənar boşluq','Kenar boşluğu','Side margin'),sideMarginPx,setSideMarginPx,0,80]].map(([label,value,change,min,max])=><label key={label}>
              <span>{label}</span><input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={e=>change(Number(e.target.value))}/></label>)}
        </div>
        <div className="ps-receipt-options">
          <div><strong>{tr('Çap üsulu','Baskı yöntemi','Print mode')}</strong><div className="ps-receipt-option-buttons">
            {[['auto',t.settings.renderAuto],['text',t.settings.renderText],['raster',t.settings.renderRaster]].map(([id,label])=><button type="button" key={id} aria-pressed={renderMode===id} onClick={()=>setRenderMode(id)}>{label}</button>)}
          </div></div>
          <div><strong>{tr('Valyuta görünüşü','Para birimi görünümü','Currency display')}</strong><div className="ps-receipt-option-buttons">
            {[['code',t.settings.currencyCode],['symbol',t.settings.currencySymbol],['none',t.settings.currencyNone]].map(([id,label])=><button type="button" key={id} aria-pressed={currencyDisplay===id} onClick={()=>setCurrencyDisplay(id)}>{label}</button>)}
          </div></div>
        </div>
      </details>
    </div>
    <p className="ps-receipt-footnote">{tr('Önizləmə seçilmiş ayarları göstərir. Fiziki printerdə ayrıca yoxlama çeki çap edin.',
      'Önizleme seçili ayarları gösterir. Fiziksel yazıcıda ayrıca test fişi basın.',
      'Preview shows the selected settings. Print a separate test receipt on the physical printer.')}</p>
  </div>;
}

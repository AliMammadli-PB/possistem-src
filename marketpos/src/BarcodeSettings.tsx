import { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Check, ChevronRight, CircleHelp, LoaderCircle, Printer, RefreshCw, Search, Usb, Wifi, X, Undo2, Redo2 } from 'lucide-react';
import type { Lang, Product, SessionUser } from './types';
import { DEFAULT_LABEL_SAMPLE, defaultLabelDesign, type LabelDevice, type LabelPreview, type LabelProfile } from './labelTypes';
import { LabelCanvas, type DesignEdit } from './LabelCanvas';
import { freezeBarcode, holdInPlace, type LabelBox, type LabelElement } from './labelLayout';
import { LabelDesigner, UnitInput } from './LabelDesigner';
import { dotsToUnit, mmToUnit, paperUnit, roundUnit, unitToMm, type LabelUnit } from './labelUnits';
import { labelError, labelText, type LabelWord } from './labelText';

const defaults: LabelProfile = { target: '', name: '', model: 'xp350b', protocol: 'tspl', widthMm: 45, heightMm: 25, gapMm: 2, dpi: 203, maxWidthMm: 76, showPrice: true, unit: 'mm', design: defaultLabelDesign(), sample: { ...DEFAULT_LABEL_SAMPLE } };
export function BarcodeSettings({ session, lang, notify, onProduct }: { session: SessionUser; lang: Lang; notify: (s: string) => void; onProduct?: (p: Product) => void }) {
  const t = (key: Parameters<typeof labelText>[1]) => labelText(lang, key);
  const [tab, setTab] = useState<'setup' | 'design' | 'labels'>('setup');
  const [draft, setDraft] = useState<LabelProfile>(defaults), [saved, setSaved] = useState<LabelProfile>(defaults);
  const [devices, setDevices] = useState<LabelDevice[]>([]), [products, setProducts] = useState<Product[]>([]), [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState(''), [missingOnly, setMissingOnly] = useState(false), [limit, setLimit] = useState(30), [copies, setCopies] = useState('1');
  const [preview, setPreview] = useState<LabelPreview | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState('');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [codeDraft, setCodeDraft] = useState(''), [replaceCode, setReplaceCode] = useState(false);
  const [busy, setBusy] = useState(''), [scanning, setScanning] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const [element, setElement] = useState<LabelElement>('barcode'), [linked, setLinked] = useState(true);
  const [sampleInvalid, setSampleInvalid] = useState(false);
  const [barMode, setBarMode] = useState(false), [stripeIndex, setStripeIndex] = useState(0);
  const draftNow = useRef(draft); draftNow.current = draft;
  const history = useRef<{ past: LabelProfile[]; future: LabelProfile[] }>({ past: [], future: [] });
  const [, updateHistory] = useState(0);
  const updateProfile: typeof setDraft = apply => {
    const before = draftNow.current, next = typeof apply === 'function' ? apply(before) : apply;
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    history.current = { past: [...history.current.past.slice(-79), before], future: [] };
    draftNow.current = next; setDraft(next); updateHistory(n => n + 1);
  };
  const travel = (direction: 'past' | 'future') => {
    if (busy || previewBusy) return;
    const h = history.current, next = h[direction].pop(); if (!next) return;
    h[direction === 'past' ? 'future' : 'past'].push(draftNow.current); anchor.current = null;
    draftNow.current = next; setDraft(next); updateHistory(n => n + 1);
  };
  const lock = useRef(false), scanLock = useRef(false), sequence = useRef(0);
  // Parts edited since the last render; the next render puts every other part back where it was.
  const anchor = useRef<{ before: Record<string, LabelBox>; edited: LabelElement[] } | null>(null), linkedNow = useRef(linked);
  linkedNow.current = linked;
  const api = window.marketSystem?.labels, token = session.sessionToken;
  const chosen = products.find(p => p.id === selectedId), dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<LabelProfile>) => updateProfile(p => ({ ...p, ...patch }));
  /** A design change; with `anchor`, a size or visibility change that must not push the other parts around. */
  function change(apply: (p: LabelProfile) => LabelProfile, key?: LabelElement) {
    const before = preview?.boxes;
    if (key && before) anchor.current = anchor.current ? { ...anchor.current, edited: [...new Set([...anchor.current.edited, key])] } : { before, edited: [key] };
    updateProfile(p => apply(key && before ? { ...p, design: { ...p.design, ...freezeBarcode(p.design, preview?.barcodeBase ? { ...before, barcode: preview.barcodeBase } : before) } } : p));
  }
  const edit: DesignEdit = (patch, options) => change(p => ({ ...p, design: { ...p.design, ...(typeof patch === 'function' ? patch(p.design) : patch) } }), options?.anchor);
  const setShowPrice = (showPrice: boolean, key: LabelElement = 'price') => change(p => ({ ...p, showPrice }), key);
  const editSample = (key: 'name' | 'price' | 'barcode', value: string) => change(p => ({ ...p, sample: { ...DEFAULT_LABEL_SAMPLE, ...p.sample, [key]: value } }), key);
  const editBarMode = (on: boolean) => { setBarMode(on); if (on) setPreviewZoom(z => Math.max(z, 4)); };
  const needsCode = draft.design.showBarcode || draft.design.showDigits;
  // Without bars and digits a label needs no code, so any product can have one.
  const usable = chosen && (chosen.barcode || !needsCode) ? chosen : undefined;
  // Paper sizes in the chosen unit (dots read as mm for paper); stored in mm.
  const paper = paperUnit(draft.unit ?? 'mm'), paperName = t(paper === 'in' ? 'unitInShort' : 'unitMmShort');
  const showPaper = (mm: number) => (Number.isFinite(mm) ? roundUnit(mmToUnit(mm, paper), paper) : '');
  const typePaper = (text: string) => (text === '' ? NaN : Math.round(unitToMm(Number(text), paper) * 100) / 100);
  const paperField = (title: string, mm: number, min: number, max: number, onMm: (value: number) => void) => <label>{`${title} (${paperName})`}<UnitInput min={showPaper(min)} max={showPaper(max)} step={paper === 'in' ? 0.01 : 0.1} value={showPaper(mm)} onCommit={text => onMm(typePaper(text))}/></label>;
  const layoutUnit: LabelUnit = draft.unit ?? 'mm', layoutName = t(layoutUnit === 'in' ? 'unitInShort' : layoutUnit === 'dot' ? 'unitDotShort' : 'unitMmShort');
  const showLayout = (dots: number) => roundUnit(dotsToUnit(dots, draft.dpi, layoutUnit), layoutUnit);
  useEffect(() => {
    if (!api) { setError(t('failed')); return; }
    let live = true;
    void Promise.all([api.config(token), api.products(token), api.discover(token, false)]).then(([p, rows, found]) => { if (live) { setDraft({ ...p, unit: p.unit ?? 'mm', design: { ...defaultLabelDesign(p.dpi), ...p.design } }); setSaved({ ...p, unit: p.unit ?? 'mm', design: { ...defaultLabelDesign(p.dpi), ...p.design } }); setProducts(rows); setDevices(found.printers); } }).catch(e => { if (live) setError(labelError(lang, e)); });
    return () => { live = false; };
  }, [api, token]);
  useEffect(() => { setSampleInvalid(false); }, [tab]);
  useEffect(() => { setCodeDraft(chosen?.barcode || ''); setReplaceCode(false); }, [chosen?.id, chosen?.barcode]);
  useEffect(() => { setLimit(30); }, [query, missingOnly]);
  useEffect(() => {
    const seq = ++sequence.current; setPreviewError('');
    // The last picture stays up while the next one renders, so editing never flickers.
    if (!api || tab === 'setup' || (tab === 'labels' && !usable)) { setPreview(null); setPreviewBusy(false); return; }
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      void api.preview(token, tab === 'design' ? '' : usable ? usable.id : '', draft, lang).then(p => {
        if (seq !== sequence.current) return;
        const a = anchor.current; anchor.current = null;
        const fix = a ? holdInPlace(draft.design, a.before, p.boxes, a.edited, linkedNow.current) : {};
        if (Object.keys(fix).length) { setDraft(d => ({ ...d, design: { ...d.design, ...fix } })); return; }
        setPreview(p); setPreviewBusy(false);
      }).catch(e => { if (seq === sequence.current) { setPreviewError(labelError(lang, e)); setPreviewBusy(false); } });
    }, tab === 'design' ? 40 : 250);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [api, token, usable?.id, usable?.barcode, usable?.priceMinor, draft, lang, tab]);
  useEffect(() => { setPreview(null); anchor.current = null; }, [tab, usable?.id]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return products.filter(p => (!missingOnly || !p.barcode) && (!q || `${p.name[lang]} ${p.name.az} ${p.barcode} ${p.sku}`.toLocaleLowerCase().includes(q)));
  }, [products, query, missingOnly, lang]);
  const validSize = [draft.widthMm, draft.heightMm, draft.gapMm, draft.maxWidthMm].every(Number.isFinite) && draft.widthMm >= 20 && draft.widthMm <= (draft.model === 'xp350b' ? 76 : draft.maxWidthMm) && draft.heightMm >= 20 && draft.heightMm <= 150 && draft.gapMm >= 0 && draft.gapMm <= 10;
  const validCount = /^\d+$/.test(copies) && Number(copies) >= 1 && Number(copies) <= 100;
  async function action(kind: string, operation: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(kind); setError(''); setMessage('');
    try { await operation(); } catch (e) { setError(labelError(lang, e)); } finally { lock.current = false; setBusy(''); }
  }
  async function scan() {
    if (!api || scanLock.current) return; scanLock.current = true; setScanning(true); setError(''); setMessage('');
    try {
      const found = await api.discover(token, true); setDevices(found.printers);
      const known = found.printers.filter(p => p.compatible);
      // The same USB printer may also have a Windows queue. Prefer its direct link.
      const distinct = known.filter(p => p.direct || !known.some(raw => raw.direct && raw.name.toLocaleLowerCase() === p.name.toLocaleLowerCase()));
      if (!draft.target && distinct.length === 1) { selectDevice(distinct[0]!); setMessage(t('single')); }
      else setMessage(found.printers.length ? t('found') : t('noDevice'));
    } catch (e) { setError(labelError(lang, e)); } finally { scanLock.current = false; setScanning(false); }
  }
  function selectDevice(d: LabelDevice) {
    set({ target: d.target, name: d.name, model: d.preset, protocol: d.protocol, ...(d.preset === 'xp350b' ? { dpi: 203, maxWidthMm: 76, widthMm: Math.min(draft.widthMm, 76) } : { maxWidthMm: 104 }) });
  }
  async function send(test: boolean) {
    if (!api || uncertain) return;
    await action(test ? 'test' : 'print', async () => {
      try {
        await api.print(token, { productId: test && tab !== 'labels' ? '' : usable ? usable.id : '', profile: draft, count: test ? 1 : Number(copies), operationId: crypto.randomUUID(), lang, test });
        setMessage(t(test ? 'testSent' : 'sent')); notify(t(test ? 'testSent' : 'sent'));
      } catch (e) { setUncertain(true); throw e; }
    });
  }
  const activeMissing = Boolean(saved.target && !devices.some(d => d.target === saved.target));
  return <div className="barcode-settings" aria-busy={Boolean(busy)}>
    <div className="label-tabs" role="tablist" aria-label={t('labels')}>{(['setup', 'design', 'labels'] as const).map(id => <button type="button" id={`label-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`label-panel-${id}`} key={id} onClick={() => setTab(id)}>{id === 'setup' ? <Printer/> : <Barcode/>}{t(id)}</button>)}</div>
    {error && <div className="label-feedback error" role="alert">{error}</div>}
    {message && <div className="label-feedback" role="status"><Check/>{message}</div>}
    {uncertain && <div className="label-uncertain" role="alert"><p>{t('uncertain')}</p><button type="button" disabled={Boolean(busy)} onClick={() => setUncertain(false)}>{t('reprint')}</button></div>}
    {tab === 'setup' ? <div id="label-panel-setup" role="tabpanel" aria-labelledby="label-tab-setup" className="label-setup-grid">
      <section className="label-card"><header><span className="label-icon"><Usb/></span><div><h4>{t('findTitle')}</h4><p>{t('findHint')}</p></div></header>
        <button type="button" className="label-primary label-find" disabled={scanning || Boolean(busy)} onClick={() => void scan()}>{scanning ? <LoaderCircle className="spin"/> : <Search/>}{t(scanning ? 'scanning' : 'find')}</button>
        {activeMissing && <p className="label-warning">{t('savedMissing')}</p>}
        <div className="label-device-list">{devices.length ? devices.map(d => <button type="button" key={d.target} className={`label-device ${draft.target === d.target ? 'selected' : ''}`} aria-pressed={draft.target === d.target} disabled={Boolean(busy) || scanning} onClick={() => selectDevice(d)}><span className="label-icon">{d.connection === 'network' ? <Wifi/> : <Printer/>}</span><span><b>{d.name}</b><small>{d.direct ? t('direct') : d.driver || t('queue')}</small>{!d.compatible && <small className="label-warning">{t('candidate')}</small>}</span>{draft.target === d.target ? <Check aria-label={t('selected')}/> : <ChevronRight/>}</button>) : <div className="label-empty"><Printer/><b>{t('noDevice')}</b><p>{t('noDeviceHint')}</p></div>}</div>
        <details className="label-manual"><summary>{t('manual')}</summary><label>{t('target')}<input value={draft.target} disabled={Boolean(busy)} placeholder="tcp:192.168.1.50:9100" onChange={e => set({ target: e.target.value })}/></label><label>{t('name')}<input value={draft.name} disabled={Boolean(busy)} onChange={e => set({ name: e.target.value })}/></label></details>
        <details className="label-manual label-driver"><summary><CircleHelp/>{t('driverTitle')}</summary><p>{t('driverHint')}</p><div className="label-driver-buttons">{['Xprinter', 'TSC', 'Zebra'].map(v => <button type="button" key={v} disabled={Boolean(busy)} onClick={() => void action('driver', async () => { await api?.driver(token, v.toLowerCase()); })}>{v} · {t('driver')}</button>)}</div></details>
      </section>
      <section className="label-card"><header><span className="label-icon"><Barcode/></span><div><h4>{t('profile')}</h4><p>{t('sizeHint')}</p></div></header>
        <fieldset disabled={Boolean(busy)} className="label-fields"><label>{t('model')}<select value={draft.model} onChange={e => set(e.target.value === 'xp350b' ? { model: 'xp350b', protocol: 'tspl', dpi: 203, maxWidthMm: 76, widthMm: Math.min(draft.widthMm, 76) } : { model: 'generic', maxWidthMm: 104 })}><option value="xp350b">Xprinter XP‑350B / 350BM</option><option value="generic">{t('generic')}</option></select></label>
        <label>{t('protocol')}<select disabled={draft.model === 'xp350b'} value={draft.protocol} onChange={e => set({ protocol: e.target.value as 'tspl' | 'zpl' })}><option value="tspl">TSPL / TSPL2</option><option value="zpl">ZPL / ZPL II</option></select></label>
        <label>{t('unit')}<select value={draft.unit ?? 'mm'} onChange={e => set({ unit: e.target.value as LabelUnit })}><option value="mm">{t('unitMm')}</option><option value="in">{t('unitIn')}</option><option value="dot">{t('unitDot')}</option></select></label>
        <div className="label-size-presets">{[[45,25],[40,30],[50,30],[58,40],[60,40],[70,40]].map(([w,h]) => <button type="button" key={`${w}-${h}`} aria-pressed={draft.widthMm === w && draft.heightMm === h} onClick={() => set({ widthMm: w!, heightMm: h! })}>{paper === 'in' ? `${showPaper(w!)} × ${showPaper(h!)} in` : `${w} × ${h} mm`}</button>)}</div>
        <div className="label-field-pair">{paperField(t('width'), draft.widthMm, 20, draft.model === 'xp350b' ? 76 : draft.maxWidthMm, widthMm => set({ widthMm }))}{paperField(t('height'), draft.heightMm, 20, 150, heightMm => set({ heightMm }))}</div>
        <div className="label-field-pair">{paperField(t('gap'), draft.gapMm, 0, 10, gapMm => set({ gapMm }))}<label>{t('dpi')}<select value={draft.dpi} disabled={draft.model === 'xp350b'} onChange={e => set({ dpi: Number(e.target.value) })}><option value="203">203 DPI</option><option value="300">300 DPI</option></select></label></div>
        {draft.protocol === 'zpl' && <p>{t('zplGap')}</p>}
        {draft.model === 'generic' && paperField(t('maxWidth'), draft.maxWidthMm, 20, 112, maxWidthMm => set({ maxWidthMm }))}
        <label className="label-check"><input type="checkbox" checked={draft.showPrice} onChange={e => set({ showPrice: e.target.checked })}/>{t('showPrice')}</label>
        </fieldset>
        {dirty && <p className="label-dirty">{t('pending')}</p>}
        <div className="label-actions"><button type="button" disabled={!draft.target || !validSize || Boolean(busy) || uncertain || scanning} onClick={() => void send(true)}>{busy === 'test' ? <LoaderCircle className="spin"/> : <Printer/>}{t('test')}</button><button type="button" className="label-primary" disabled={!api || !draft.target || !validSize || Boolean(busy) || scanning} onClick={() => void action('save', async () => { if (!api) return; const p = await api.save(token, draft); setDraft({ ...p, design: { ...defaultLabelDesign(p.dpi), ...p.design } }); setSaved({ ...p, design: { ...defaultLabelDesign(p.dpi), ...p.design } }); setMessage(t('saved')); })}><Check/>{t('save')}</button></div>
      </section>
    </div> : <div id={`label-panel-${tab}`} role="tabpanel" aria-labelledby={`label-tab-${tab}`} className={`label-print-grid${tab === 'design' ? ' label-visual-workspace' : ''}`} onKeyDown={e => { if (tab === 'design' && (e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); travel(e.shiftKey || e.key.toLowerCase() === 'y' ? 'future' : 'past'); } }}>
      {tab === 'design' ? <LabelDesigner profile={draft} setProfile={updateProfile} edit={edit} setShowPrice={setShowPrice} element={element} setElement={setElement} linked={linked} setLinked={setLinked} lang={lang} disabled={Boolean(busy)} preview={preview} onSample={editSample} barMode={barMode} setBarMode={editBarMode} stripeIndex={stripeIndex} setStripeIndex={setStripeIndex} onSampleValidity={setSampleInvalid}/> : <section className="label-card label-product-card"><header><span className="label-icon"><Barcode/></span><div><h4>{t('product')}</h4><p>{products.length} {t('goodsCount')} · {products.filter(p => !p.barcode).length} {t('missingCount')}</p></div><button type="button" className="label-icon-button" aria-label={t('find')} disabled={Boolean(busy)} onClick={() => void action('refresh', async () => { if (api) setProducts(await api.products(token)); })}><RefreshCw/></button></header>
        <label className="label-search"><Search/><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label={lang === 'az' ? 'Axtarışı təmizlə' : lang === 'ru' ? 'Очистить поиск' : 'Clear search'} onClick={() => setQuery('')}><X/></button>}</label>
        <label className="label-check"><input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)}/>{t('onlyMissing')}</label>
        <div className="label-products">{filtered.slice(0, limit).map(p => <button type="button" key={p.id} aria-pressed={p.id === selectedId} disabled={Boolean(busy)} onClick={() => setSelectedId(p.id)}><span><b>{p.name[lang] || p.name.az}</b><small>{p.barcode || t('noBarcode')} · {p.sku}</small></span><strong>{(p.priceMinor / 100).toFixed(2)} ₼</strong></button>)}{!filtered.length && <div className="label-empty">{t('empty')}</div>}</div>
        {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + 30)}>{t('more')} ({filtered.length - limit})</button>}
      </section>
      }<section className="label-card label-preview-card"><header><span className="label-icon"><Printer/></span><div><h4>{t('preview')}</h4><p>{t('previewHint')}</p></div></header>
        {tab === 'labels' && chosen && <div className="label-selected-product"><b>{chosen.name[lang] || chosen.name.az}</b><span>{showPaper(draft.widthMm)} × {showPaper(draft.heightMm)} {paperName} · {draft.dpi} DPI</span></div>}
        <div className="label-preview-paper" aria-busy={previewBusy}>{previewError ? <p role="alert">{previewError}</p> : preview && tab === 'design' ? <LabelCanvas preview={preview} profile={draft} element={element} setElement={setElement} linked={linked} zoom={previewZoom} disabled={Boolean(busy)} lang={lang} edit={edit} setShowPrice={setShowPrice} barMode={barMode} stripeIndex={stripeIndex} setStripeIndex={setStripeIndex}/> : previewBusy && !preview ? <span><LoaderCircle className="spin"/>{t('loading')}</span> : preview ? <img src={preview.image} alt={`${t('preview')} · ${preview.barcode}`} width={preview.width} height={preview.height} style={{ width: preview.width * previewZoom, maxWidth: previewZoom === 1 ? '100%' : 'none', flexShrink: 0 }}/> : <span><Barcode/>{t(chosen ? 'noBarcode' : 'choose')}</span>}</div>
        {tab === 'design' && <div className="label-history"><button type="button" disabled={!history.current.past.length || previewBusy || Boolean(busy)} onClick={() => travel('past')}><Undo2/>{t('undo')}</button><button type="button" disabled={!history.current.future.length || previewBusy || Boolean(busy)} onClick={() => travel('future')}><Redo2/>{t('redo')}</button><span>{t('paperClip')}</span></div>}
        {tab === 'design' && <p className="label-sample">{t('sample')}</p>}
        {tab === 'design' && sampleInvalid && <p className="label-warning" role="alert">{t('samplePending')}</p>}
        {preview && <div className="label-preview-zoom" aria-label={t('zoom')}>{[.5,1,1.5,2,3,4,8,16].map(z => <button key={z} type="button" aria-pressed={previewZoom === z} onClick={() => setPreviewZoom(z)}>{z * 100}%</button>)}</div>}
        {preview && <div className="label-raster-info">{preview.width} × {preview.height} px · {preview.symbology || 'Code 128'} · {draft.dpi} DPI</div>}
        {tab === 'design' && preview?.boxes && <details className="label-coordinates"><summary>{t('coordinates')}</summary><table><thead><tr><th>{t('element')}</th><th>X ({layoutName})</th><th>Y</th><th>W</th><th>H</th></tr></thead><tbody>{Object.entries(preview.boxes).map(([key,b]) => <tr key={key}><td>{t(`${key}Element` as Parameters<typeof labelText>[1])}</td><td>{showLayout(b.x)}</td><td>{showLayout(b.y)}</td><td>{showLayout(b.width)}</td><td>{showLayout(b.height)}</td></tr>)}</tbody></table></details>}
        {(preview?.nameTruncated || Boolean(preview?.warnings?.length)) && <details className="label-print-notes"><summary>{t('printNotes')}</summary>{preview?.nameTruncated && <p>{t('truncated')}</p>}{preview?.warnings?.map(code => <p key={code}>{t(code as LabelWord)}</p>)}</details>}
        {tab === 'labels' && chosen && <div className="label-generate">
          <label>{t('code13')}<input inputMode="numeric" maxLength={13} value={codeDraft} onChange={e => setCodeDraft(e.target.value)} placeholder="2001234567893"/></label>
          <p>{t('codeHint')}</p>
          {chosen.barcode && <label className="label-check"><input type="checkbox" checked={replaceCode} onChange={e => setReplaceCode(e.target.checked)}/>{t('replaceCode')}</label>}
          <div className="label-code-actions">{(!chosen.barcode || !/^\d{13}$/.test(chosen.barcode)) && <button type="button" className="label-primary" disabled={Boolean(busy) || !api || Boolean(chosen.barcode && !replaceCode)} onClick={() => void action('generate', async () => { if (!api) return; const p = await api.generate(token, chosen.id, { replaceExisting: replaceCode, previousBarcode: chosen.barcode }); setProducts(rows => rows.map(row => row.id === p.id ? p : row)); onProduct?.(p); setMessage(t('generated')); })}>{busy === 'generate' ? <LoaderCircle className="spin"/> : <Barcode/>}{t(chosen.barcode ? 'generate13' : 'generate')}</button>}
          <button type="button" disabled={Boolean(busy) || !api || !/^\d{13}$/.test(codeDraft) || codeDraft === chosen.barcode || Boolean(chosen.barcode && !replaceCode)} onClick={() => void action('generate', async () => { if (!api) return; const p = await api.generate(token, chosen.id, { barcode: codeDraft, replaceExisting: replaceCode, previousBarcode: chosen.barcode }); setProducts(rows => rows.map(row => row.id === p.id ? p : row)); onProduct?.(p); setMessage(t('generated')); })}>{t('saveCode')}</button></div>
        </div>}
        {tab === 'design' && <div className="label-actions">
          <button type="button" disabled={!api || !draft.target || !validSize || !preview || previewBusy || sampleInvalid || Boolean(busy)} className="label-primary" onClick={() => void action('save', async () => { if (api) { const p = await api.save(token, draft); setSaved(p); setMessage(t('saved')); } })}><Check/>{t('saveDesign')}</button>
          <button type="button" disabled={!draft.target || !preview || previewBusy || sampleInvalid || Boolean(busy) || uncertain} onClick={() => void send(true)}><Printer/>{t('test')}</button>
          {dirty && <p className="label-dirty">{t('pending')}</p>}
        </div>}
        <div className="label-print-controls" hidden={tab === 'design'}><label>{t('copies')}<div className="label-quantity"><button type="button" aria-label="−1" disabled={Boolean(busy) || Number(copies) <= 1} onClick={() => setCopies(String(Math.max(1, Number(copies) - 1)))}>−</button><input aria-label={t('copies')} type="number" inputMode="numeric" min="1" max="100" step="1" disabled={Boolean(busy)} value={copies} onChange={e => setCopies(e.target.value)}/><button type="button" aria-label="+1" disabled={Boolean(busy) || Number(copies) >= 100} onClick={() => setCopies(String(Math.min(100, Number(copies) + 1)))}>+</button></div></label>
        {!draft.target && <button type="button" onClick={() => setTab('setup')}>{t('setup')}<ChevronRight/></button>}
        <button type="button" className="label-primary" disabled={!preview || previewBusy || !validCount || !draft.target || Boolean(busy) || uncertain || !validSize} onClick={() => void send(false)}>{busy === 'print' ? <LoaderCircle className="spin"/> : <Printer/>}{t(busy === 'print' ? 'printing' : 'print')}</button></div>
      </section>
    </div>}
  </div>;
}

/**
 * The goods form and stock intake of a wholesale warehouse. Prices are typed
 * per pack (what a buyer is quoted) and stored per piece; every product has a
 * retail, a wholesale and a dealer price, and the customer's level picks one.
 */
import { useEffect, useRef, useState } from 'react';
import { Barcode, Check, ImagePlus, PackagePlus, ScanBarcode } from 'lucide-react';

import { marketCoreClient } from './core/client';
import { parseMoneyInput } from './domain';
import { Field, Modal, SelectField } from './forms';
import { money, newId } from './format';
import { categoryLabel, tr } from './i18n';
import { CATEGORIES, PACK_NAMES, PIECE_UNITS, nextInternalBarcode, packUnitsOf, pieceFromPack, qtyLabel } from './wholesale';
import { ProductVisual } from './ProductVisual';
import type { Lang, Product, SessionUser, Shelf } from './types';

type Props = {
  lang: Lang;
  products: Product[];
  session: SessionUser;
  product: Product | null;
  warehouseId: string;
  onClose: () => void;
  onSave: (product: Product) => void;
  onReceive?: (product: Product) => void;
};

const packText = (pieceMinor: number | undefined, per: number) => (pieceMinor ? ((pieceMinor * per) / 100).toFixed(2) : '');

export function GoodsModal({ lang, products, session, product, warehouseId, onClose, onSave, onReceive }: Props) {
  const per0 = product ? packUnitsOf(product) : 1;
  const [nameAz, setNameAz] = useState(product?.name.az ?? '');
  const [nameRu, setNameRu] = useState(product?.name.ru ?? '');
  const [nameEn, setNameEn] = useState(product?.name.en ?? '');
  const [category, setCategory] = useState(product?.category ?? CATEGORIES[0]!.id);
  const [brand, setBrand] = useState(product?.manufacturer ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'ədəd');
  const [packName, setPackName] = useState(product?.packName ?? 'yeşik');
  const [packUnits, setPackUnits] = useState(String(product?.packUnits ?? 1));
  const [splitAllowed, setSplitAllowed] = useState(product?.splitAllowed ?? true);
  const [cost, setCost] = useState(packText(product?.costMinor, per0));
  const [retail, setRetail] = useState(packText(product?.priceMinor, per0));
  const [wholesale, setWholesale] = useState(packText(product?.priceWholesaleMinor, per0));
  const [dealer, setDealer] = useState(packText(product?.priceDealerMinor, per0));
  const [minStock, setMinStock] = useState(String(product ? Math.round(product.minStock / per0) : 5));
  const [taxRate, setTaxRate] = useState(String(product?.taxRate ?? 18));
  const [supplier, setSupplier] = useState(product?.supplier ?? '');
  const [comment, setComment] = useState(product?.comment ?? '');
  const [image, setImage] = useState<Product['image']>(product?.image ?? { kind: 'url', url: '' });
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [shelf, setShelf] = useState(product?.shelf ?? '');
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [capture, setCapture] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [openPacks, setOpenPacks] = useState('');
  const [openPieces, setOpenPieces] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (marketCoreClient.available()) void marketCoreClient.shelves.list().then(setShelves).catch(() => undefined); }, []);

  const per = Math.max(1, Math.floor(Number(packUnits) || 1));
  const piece = (text: string) => pieceFromPack(parseMoneyInput(text || '0'), per);
  const margin = (text: string) => {
    const costMinor = parseMoneyInput(cost || '0');
    const priceMinor = parseMoneyInput(text || '0');
    return costMinor > 0 && priceMinor > 0 ? `${Math.round(((priceMinor - costMinor) / costMinor) * 100)}%` : '—';
  };

  const pick = async () => { const url = await window.marketSystem?.image.pick(session.sessionToken); if (url) setImage({ kind: 'url', url }); };
  const file = (event: React.ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => setImage({ kind: 'url', url: String(reader.result) }); reader.readAsDataURL(selected); };

  const save = () => {
    const code = barcode.trim();
    if (!nameAz.trim() || parseMoneyInput(retail || '0') <= 0 || !code) { setError(tr(lang, 'requiredFields')); return; }
    if (products.some((row) => row.barcode === code && row.id !== product?.id)) { setError(tr(lang, 'barcodeExists')); return; }
    const opening = Math.max(0, Math.floor(Number(openPacks) || 0)) * per + Math.max(0, Math.floor(Number(openPieces) || 0));
    const next: Product = {
      ...(product ?? { warehouseStock: {}, createdAt: Date.now(), active: true, accent: categoryAccent(category) }),
      id: product?.id ?? newId('product'),
      sku: sku.trim() || `${nameAz.trim()}`.normalize('NFKD').replace(/[^\w]/g, '').toUpperCase().slice(0, 10) + `-${code.slice(-4)}`,
      barcode: code,
      name: { az: nameAz.trim(), ru: nameRu.trim() || nameAz.trim(), en: nameEn.trim() || nameAz.trim() },
      category, unit, packName: per > 1 ? packName : '', packUnits: per, splitAllowed: per > 1 ? splitAllowed : true,
      priceMinor: piece(retail), priceWholesaleMinor: piece(wholesale), priceDealerMinor: piece(dealer),
      costMinor: piece(cost),
      minStock: Math.max(0, Math.floor(Number(minStock) || 0)) * per,
      taxRate: Number(taxRate) || 0, supplier: supplier.trim(), image, kind: 'product', comment: comment.trim(),
      manufacturer: brand.trim(), shelf: shelf.trim(),
      ...(product ? {} : { warehouseStock: opening > 0 ? { [warehouseId]: opening } : {} }),
    };
    onSave(next);
  };

  return (
    <Modal title={product ? tr(lang, 'editGoods') : tr(lang, 'newGoods')} subtitle={tr(lang, 'goodsFormHint')} onClose={onClose} wide>
      <div className="product-form">
        <aside>
          <ProductVisual image={image} alt={nameAz || tr(lang, 'product')} accent={categoryAccent(category)} category={category} />
          <button type="button" onClick={() => void pick()}><ImagePlus />{tr(lang, 'chooseImage')}</button>
          <label className="file-fallback">{tr(lang, 'fromFile')}<input type="file" accept="image/*" onChange={file} /></label>
          {image.kind === 'url' && image.url && <button type="button" onClick={() => setImage({ kind: 'url', url: '' })}>{tr(lang, 'removeImage')}</button>}
          <p>{tr(lang, 'imageHint')}</p>
          {product && onReceive && <button type="button" className="aside-primary" onClick={() => onReceive(product)}><PackagePlus />{tr(lang, 'receiveStock')}</button>}
        </aside>
        <section>
          <h3 className="form-section">{tr(lang, 'goodsSection')}</h3>
          <div className="form-grid">
            <Field label={`${tr(lang, 'productName')} · AZ *`} value={nameAz} onChange={setNameAz} />
            <Field label="Название · RU" value={nameRu} onChange={setNameRu} />
            <Field label="Name · EN" value={nameEn} onChange={setNameEn} />
            <Field label={tr(lang, 'brand')} value={brand} onChange={setBrand} />
            <SelectField label={tr(lang, 'category')} value={category} onChange={setCategory} options={CATEGORIES.map((row) => row.id)} labels={Object.fromEntries(CATEGORIES.map((row) => [row.id, categoryLabel(row.id, lang)]))} />
            <Field label={tr(lang, 'supplier')} value={supplier} onChange={setSupplier} />
          </div>
          <h3 className="form-section">{tr(lang, 'packSection')}</h3>
          <div className="form-grid three">
            <SelectField label={tr(lang, 'pieceUnit')} value={unit} onChange={setUnit} options={PIECE_UNITS.map((row) => row.id)} labels={Object.fromEntries(PIECE_UNITS.map((row) => [row.id, row.labels[lang]]))} />
            <SelectField label={tr(lang, 'packName')} value={packName} onChange={setPackName} options={PACK_NAMES.map((row) => row.id)} labels={Object.fromEntries(PACK_NAMES.map((row) => [row.id, row.labels[lang]]))} />
            <Field label={tr(lang, 'packUnits')} value={packUnits} onChange={setPackUnits} type="number" />
            <label className="field toggle-field wide"><span>{tr(lang, 'splitAllowed')}</span><input type="checkbox" checked={splitAllowed} disabled={per <= 1} onChange={(event) => setSplitAllowed(event.target.checked)} /></label>
          </div>
          <h3 className="form-section">{tr(lang, 'pricesSection')} · {per > 1 ? `1 ${packName} = ${per} ${unit}` : unit}</h3>
          <div className="price-levels">
            <label className="field"><span>{tr(lang, 'costPerPack')}</span><input type="number" value={cost} onChange={(event) => setCost(event.target.value)} /><small>{per > 1 ? `${money(piece(cost), lang)} / ${unit}` : ' '}</small></label>
            <label className="field level retail"><span>{tr(lang, 'priceRetail')} *</span><input type="number" value={retail} onChange={(event) => setRetail(event.target.value)} /><small>{per > 1 ? `${money(piece(retail), lang)} / ${unit} · ` : ''}{tr(lang, 'markup')} {margin(retail)}</small></label>
            <label className="field level wholesale"><span>{tr(lang, 'priceWholesale')}</span><input type="number" value={wholesale} placeholder={retail} onChange={(event) => setWholesale(event.target.value)} /><small>{per > 1 && wholesale ? `${money(piece(wholesale), lang)} / ${unit} · ` : ''}{tr(lang, 'markup')} {margin(wholesale || retail)}</small></label>
            <label className="field level dealer"><span>{tr(lang, 'priceDealer')}</span><input type="number" value={dealer} placeholder={wholesale || retail} onChange={(event) => setDealer(event.target.value)} /><small>{per > 1 && dealer ? `${money(piece(dealer), lang)} / ${unit} · ` : ''}{tr(lang, 'markup')} {margin(dealer || wholesale || retail)}</small></label>
          </div>
          <p className="form-hint">{tr(lang, 'priceLevelsHint')}</p>
          <h3 className="form-section">{tr(lang, 'stockSection')}</h3>
          <div className="form-grid">
            <Field label={tr(lang, 'minStockPacks')} value={minStock} onChange={setMinStock} type="number" />
            <SelectField label={tr(lang, 'taxLabel')} value={taxRate} onChange={setTaxRate} options={['18', '8', '2', '0']} labels={{ '18': 'ƏDV 18%', '8': 'Sadələşdirilmiş 8%', '2': 'Sadələşdirilmiş 2%', '0': 'ƏDV-dən azad' }} />
            <label className="field barcode-field"><span>{tr(lang, 'barcode')} *</span><div className={capture ? 'barcode-capture active' : 'barcode-capture'}><input ref={barcodeRef} data-scanner="allow" value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setBarcode(barcode.trim()); setCapture(false); } }} /><button type="button" onClick={() => { setBarcode(''); setCapture(true); window.setTimeout(() => barcodeRef.current?.focus(), 0); }}><ScanBarcode />{capture ? tr(lang, 'scanNow') : tr(lang, 'scanBarcode')}</button><button type="button" title={tr(lang, 'generateBarcodeHint')} onClick={() => setBarcode(nextInternalBarcode(new Set(products.map((row) => row.barcode))))}><Barcode />{tr(lang, 'generateBarcode')}</button></div></label>
            <label className="field shelf-field"><span>{tr(lang, 'shelf')}</span><input list="topdan-shelves" value={shelf} placeholder={tr(lang, 'shelfPlaceholder')} onChange={(event) => setShelf(event.target.value)} /><datalist id="topdan-shelves">{shelves.map((row) => <option key={row.code} value={row.code}>{row.zone}</option>)}</datalist></label>
            <Field label={tr(lang, 'sku')} value={sku} onChange={setSku} />
            <Field label={tr(lang, 'comment')} value={comment} onChange={setComment} wide />
          </div>
          {!product && (
            <>
              <h3 className="form-section">{tr(lang, 'openingStock')}</h3>
              <div className="form-grid">
                {per > 1 && <Field label={`${tr(lang, 'qty')} · ${packName}`} value={openPacks} onChange={setOpenPacks} type="number" />}
                <Field label={`${tr(lang, 'qty')} · ${unit}`} value={openPieces} onChange={setOpenPieces} type="number" />
              </div>
              <p className="form-hint">{tr(lang, 'openingStockHint')}</p>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" onClick={save}><Check />{tr(lang, 'save')}</button>
      </div>
    </Modal>
  );
}

/** Each goods group has its own colour on the picture-less card. */
const ACCENTS = ['#0a4f9c', '#0e7490', '#15803d', '#b45309', '#9d174d', '#6d28d9', '#334155'];
export const categoryAccent = (category: string) => ACCENTS[Math.max(0, CATEGORIES.findIndex((row) => row.id === category)) % ACCENTS.length]!;

/** Goods arriving at the warehouse: packs and loose pieces, from a supplier. */
export function StockReceiveModal({ lang, product, session, warehouseId, onClose, onDone }: { lang: Lang; product: Product; session: SessionUser; warehouseId: string; onClose: () => void; onDone: (text: string) => void }) {
  const per = packUnitsOf(product);
  const [packs, setPacks] = useState(per > 1 ? '1' : '');
  const [pieces, setPieces] = useState(per > 1 ? '' : '1');
  const [supplier, setSupplier] = useState(product.supplier ?? '');
  const [invoice, setInvoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const units = Math.max(0, Math.floor(Number(packs) || 0)) * per + Math.max(0, Math.floor(Number(pieces) || 0));
  const submit = async () => {
    if (units <= 0) { setError(tr(lang, 'requiredFields')); return; }
    setBusy(true);
    try {
      await marketCoreClient.inventory.adjust({ productId: product.id, warehouseId, qtyDelta: units, actorId: session.id, role: session.role, note: [tr(lang, 'receiveStock'), supplier.trim(), invoice.trim()].filter(Boolean).join(' · ') });
      onDone(`${product.name[lang]} · ${qtyLabel(product, units, lang)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={tr(lang, 'receiveStock')} subtitle={product.name[lang]} onClose={onClose}>
      <div className="form-grid">
        {per > 1 && <Field label={`${tr(lang, 'qty')} · ${product.packName}`} value={packs} onChange={setPacks} type="number" />}
        <Field label={`${tr(lang, 'qty')} · ${product.unit}`} value={pieces} onChange={setPieces} type="number" />
        <Field label={tr(lang, 'supplier')} value={supplier} onChange={setSupplier} />
        <Field label={tr(lang, 'supplierInvoice')} value={invoice} onChange={setInvoice} />
      </div>
      <p className="form-hint">{qtyLabel(product, units, lang)}</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" disabled={busy} onClick={() => void submit()}><PackagePlus />{tr(lang, 'receiveStock')}</button>
      </div>
    </Modal>
  );
}

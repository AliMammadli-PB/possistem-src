/**
 * The medicine form and the lot intake. A medicine is created with no stock;
 * stock only ever arrives as a lot (number, expiry, quantity), so every box on
 * the shelf can be traced to its batch and sold first-expiry-first-out.
 */
import { useRef, useState } from 'react';
import { Check, ImagePlus, PackagePlus, ScanBarcode } from 'lucide-react';

import { marketCoreClient } from './core/client';
import { parseMoneyInput } from './domain';
import { Field, Modal, SelectField } from './forms';
import { money, newId } from './format';
import { categoryLabel, tr } from './i18n';
import { DOSAGE_FORMS, PHARMA_CATEGORIES, STORAGE, packUnitsOf, parseGs1, qtyLabel, unitPriceFromPack } from './pharmacy';
import { ProductVisual } from './ProductVisual';
import type { Lang, Product, SessionUser } from './types';

/** A new medicine's first lot, received right after it is created. */
export type OpeningLot = { lotNumber: string; expiresAt: number; packs: number };

type Props = {
  lang: Lang;
  products: Product[];
  session: SessionUser;
  product: Product | null;
  onClose: () => void;
  onSave: (product: Product, lot: OpeningLot | null) => void;
  onReceive?: (product: Product) => void;
};

const dateToMs = (value: string) => (value ? new Date(`${value}T23:59:59`).getTime() : 0);

export function MedicineModal({ lang, products, session, product, onClose, onSave, onReceive }: Props) {
  const per = product ? packUnitsOf(product) : 1;
  const [nameAz, setNameAz] = useState(product?.name.az ?? '');
  const [nameRu, setNameRu] = useState(product?.name.ru ?? '');
  const [nameEn, setNameEn] = useState(product?.name.en ?? '');
  const [inn, setInn] = useState(product?.inn ?? '');
  const [strength, setStrength] = useState(product?.strength ?? '');
  const [dosageForm, setDosageForm] = useState(product?.dosageForm ?? 'tablet');
  const [category, setCategory] = useState(product?.category ?? 'Ağrıkəsici');
  const [manufacturer, setManufacturer] = useState(product?.manufacturer ?? '');
  const [country, setCountry] = useState(product?.country ?? '');
  const [regNo, setRegNo] = useState(product?.regNo ?? '');
  const [rxRequired, setRxRequired] = useState(product?.rxRequired ?? false);
  const [storage, setStorage] = useState(product?.storage ?? 'room');
  const [packUnits, setPackUnits] = useState(String(product?.packUnits ?? 1));
  const [splitAllowed, setSplitAllowed] = useState(product?.splitAllowed ?? false);
  const [taxRate, setTaxRate] = useState(String(product?.taxRate ?? 18));
  // Prices are entered per pack; a split medicine stores the unit price.
  const [cost, setCost] = useState(product ? ((product.costMinor * per) / 100).toFixed(2) : '');
  const [price, setPrice] = useState(product ? ((product.priceMinor * per) / 100).toFixed(2) : '');
  const [minStock, setMinStock] = useState(String(product ? Math.round(product.minStock / per) : 2));
  const [supplier, setSupplier] = useState(product?.supplier ?? '');
  const [comment, setComment] = useState(product?.comment ?? '');
  const [image, setImage] = useState<Product['image']>(product?.image ?? { kind: 'url', url: '' });
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [capture, setCapture] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [lotNumber, setLotNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [packs, setPacks] = useState('');
  const [error, setError] = useState('');

  const units = splitAllowed ? Math.max(1, Math.floor(Number(packUnits) || 1)) : 1;
  const unitPrice = unitPriceFromPack(parseMoneyInput(price || '0'), units);

  const pick = async () => { const url = await window.marketSystem?.image.pick(session.sessionToken); if (url) setImage({ kind: 'url', url }); };
  const file = (event: React.ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => setImage({ kind: 'url', url: String(reader.result) }); reader.readAsDataURL(selected); };
  // A scanned DataMatrix fills the barcode with its EAN and the lot fields too.
  const takeScan = (value: string) => {
    const gs1 = parseGs1(value);
    if (!gs1) { setBarcode(value.trim()); return; }
    setBarcode(gs1.ean13 ?? gs1.gtin);
    if (gs1.lot) setLotNumber(gs1.lot);
    if (gs1.expiry) setExpiry(new Date(gs1.expiry).toISOString().slice(0, 10));
  };

  const save = () => {
    const packPrice = parseMoneyInput(price || '0');
    const code = barcode.trim();
    if (!nameAz.trim() || packPrice <= 0 || !code) { setError(tr(lang, 'requiredFields')); return; }
    if (products.some((row) => row.barcode === code && row.id !== product?.id)) { setError(tr(lang, 'barcodeExists')); return; }
    const opening = !product && (packs || lotNumber || expiry)
      ? { lotNumber: lotNumber.trim(), expiresAt: dateToMs(expiry), packs: Math.floor(Number(packs) || 0) }
      : null;
    if (opening && (!opening.lotNumber || !opening.expiresAt || opening.packs <= 0)) { setError(tr(lang, 'lotFieldsRequired')); return; }
    const next: Product = {
      ...(product ?? { warehouseStock: {}, createdAt: Date.now(), active: true, accent: '#0e7c86' }),
      id: product?.id ?? newId('product'),
      sku: sku.trim() || `${inn.trim() || nameAz.trim()}`.normalize('NFKD').replace(/[^\w]/g, '').toUpperCase().slice(0, 10) + `-${code.slice(-4)}`,
      barcode: code,
      name: { az: nameAz.trim(), ru: nameRu.trim() || nameAz.trim(), en: nameEn.trim() || nameAz.trim() },
      category, unit: splitAllowed ? 'ədəd' : 'qutu',
      priceMinor: splitAllowed ? unitPrice : packPrice,
      costMinor: splitAllowed ? unitPriceFromPack(parseMoneyInput(cost || '0'), units) : parseMoneyInput(cost || '0'),
      minStock: Math.max(0, Math.floor(Number(minStock) || 0)) * units,
      taxRate: Number(taxRate) || 0, supplier: supplier.trim(), image, kind: 'product', comment: comment.trim(),
      inn: inn.trim(), strength: strength.trim(), dosageForm, packUnits: Math.max(1, Math.floor(Number(packUnits) || 1)),
      splitAllowed, rxRequired, storage, manufacturer: manufacturer.trim(), country: country.trim(), regNo: regNo.trim(),
    };
    onSave(next, opening);
  };

  return (
    <Modal title={product ? tr(lang, 'editMedicine') : tr(lang, 'newMedicine')} subtitle={tr(lang, 'medicineFormHint')} onClose={onClose} wide>
      <div className="product-form">
        <aside>
          <ProductVisual image={image} alt={nameAz || tr(lang, 'product')} accent="#0e7c86" category={category} dosageForm={dosageForm} />
          <button type="button" onClick={() => void pick()}><ImagePlus />{tr(lang, 'chooseImage')}</button>
          <label className="file-fallback">{tr(lang, 'fromFile')}<input type="file" accept="image/*" onChange={file} /></label>
          {image.kind === 'url' && image.url && <button type="button" onClick={() => setImage({ kind: 'url', url: '' })}>{tr(lang, 'removeImage')}</button>}
          <p>{tr(lang, 'imageHint')}</p>
          {product && onReceive && <button type="button" className="aside-primary" onClick={() => onReceive(product)}><PackagePlus />{tr(lang, 'receiveLot')}</button>}
        </aside>
        <section>
          <h3 className="form-section">{tr(lang, 'medicineSection')}</h3>
          <div className="form-grid">
            <Field label={`${tr(lang, 'productName')} · AZ *`} value={nameAz} onChange={setNameAz} />
            <Field label="Название · RU" value={nameRu} onChange={setNameRu} />
            <Field label="Name · EN" value={nameEn} onChange={setNameEn} />
            <Field label={tr(lang, 'inn')} value={inn} onChange={setInn} />
            <Field label={tr(lang, 'strength')} value={strength} onChange={setStrength} />
            <SelectField label={tr(lang, 'dosageForm')} value={dosageForm} onChange={setDosageForm} options={DOSAGE_FORMS.map((row) => row.id)} labels={Object.fromEntries(DOSAGE_FORMS.map((row) => [row.id, row.labels[lang]]))} />
            <SelectField label={tr(lang, 'category')} value={category} onChange={setCategory} options={PHARMA_CATEGORIES.map((row) => row.id)} labels={Object.fromEntries(PHARMA_CATEGORIES.map((row) => [row.id, categoryLabel(row.id, lang)]))} />
            <Field label={tr(lang, 'manufacturer')} value={manufacturer} onChange={setManufacturer} />
            <Field label={tr(lang, 'country')} value={country} onChange={setCountry} />
            <Field label={tr(lang, 'regNo')} value={regNo} onChange={setRegNo} />
            <SelectField label={tr(lang, 'storage')} value={storage} onChange={setStorage} options={STORAGE.map((row) => row.id)} labels={Object.fromEntries(STORAGE.map((row) => [row.id, row.labels[lang]]))} />
            <label className="field toggle-field"><span>{tr(lang, 'rxRequired')}</span><input type="checkbox" checked={rxRequired} onChange={(event) => setRxRequired(event.target.checked)} /></label>
          </div>
          <h3 className="form-section">{tr(lang, 'packSection')}</h3>
          <div className="form-grid">
            <Field label={tr(lang, 'packUnits')} value={packUnits} onChange={setPackUnits} type="number" />
            <label className="field toggle-field"><span>{tr(lang, 'splitAllowed')}</span><input type="checkbox" checked={splitAllowed} onChange={(event) => setSplitAllowed(event.target.checked)} /></label>
            <Field label={`${tr(lang, 'costPerPack')} · AZN`} value={cost} onChange={setCost} type="number" />
            <Field label={`${tr(lang, 'pricePerPack')} · AZN *`} value={price} onChange={setPrice} type="number" />
            <label className="field"><span>{tr(lang, 'unitPrice')}</span><input readOnly value={splitAllowed ? `${money(unitPrice, lang)} / ${DOSAGE_FORMS.find((row) => row.id === dosageForm)?.unit[lang]}` : '—'} /></label>
            <Field label={tr(lang, 'minStockPacks')} value={minStock} onChange={setMinStock} type="number" />
            <SelectField label={tr(lang, 'taxLabel')} value={taxRate} onChange={setTaxRate} options={['18', '8', '2', '0']} labels={{ '18': 'ƏDV 18%', '8': 'Sadələşdirilmiş 8%', '2': 'Sadələşdirilmiş 2%', '0': 'ƏDV-dən azad' }} />
            <Field label={tr(lang, 'supplier')} value={supplier} onChange={setSupplier} />
            <Field label={tr(lang, 'sku')} value={sku} onChange={setSku} />
            <label className="field barcode-field"><span>{tr(lang, 'barcode')} *</span><div className={capture ? 'barcode-capture active' : 'barcode-capture'}><input ref={barcodeRef} data-scanner="allow" value={barcode} onChange={(event) => setBarcode(event.target.value)} onBlur={() => takeScan(barcode)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); takeScan(barcode); setCapture(false); } }} /><button type="button" onClick={() => { setBarcode(''); setCapture(true); window.setTimeout(() => barcodeRef.current?.focus(), 0); }}><ScanBarcode />{capture ? tr(lang, 'scanNow') : tr(lang, 'scanBarcode')}</button></div></label>
            <Field label={tr(lang, 'comment')} value={comment} onChange={setComment} wide />
          </div>
          {!product && (
            <>
              <h3 className="form-section">{tr(lang, 'openingLot')}</h3>
              <div className="form-grid">
                <Field label={tr(lang, 'lotNumber')} value={lotNumber} onChange={setLotNumber} />
                <Field label={tr(lang, 'expiryDate')} value={expiry} onChange={setExpiry} type="date" />
                <Field label={tr(lang, 'qtyPacks')} value={packs} onChange={setPacks} type="number" />
              </div>
              <p className="form-hint">{tr(lang, 'openingLotHint')}</p>
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

/** Stock arrives as a lot: its number and expiry come from the box (or its DataMatrix). */
export function LotReceiveModal({ lang, product, session, onClose, onDone }: { lang: Lang; product: Product; session: SessionUser; onClose: () => void; onDone: (text: string) => void }) {
  const [lotNumber, setLotNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [packs, setPacks] = useState('1');
  const [supplier, setSupplier] = useState(product.supplier ?? '');
  const [scan, setScan] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const per = packUnitsOf(product);
  const units = Math.max(0, Math.floor(Number(packs) || 0)) * per;

  const readScan = (value: string) => {
    const gs1 = parseGs1(value);
    if (!gs1) return;
    if (gs1.lot) setLotNumber(gs1.lot);
    if (gs1.expiry) setExpiry(new Date(gs1.expiry).toISOString().slice(0, 10));
    setScan('');
  };
  const submit = async () => {
    if (!lotNumber.trim() || !expiry || units <= 0) { setError(tr(lang, 'lotFieldsRequired')); return; }
    setBusy(true);
    try {
      await marketCoreClient.lots.receive({ productId: product.id, lotNumber: lotNumber.trim(), expiresAt: dateToMs(expiry), qty: units, supplier: supplier.trim(), actorId: session.id });
      onDone(`${product.name[lang]} · ${lotNumber.trim()} · ${qtyLabel(product, units, lang)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={tr(lang, 'receiveLot')} subtitle={`${product.name[lang]}${product.strength ? ` · ${product.strength}` : ''}`} onClose={onClose}>
      <div className="form-grid">
        <label className="field wide"><span>{tr(lang, 'scanDataMatrix')}</span><input data-scanner="allow" value={scan} onChange={(event) => setScan(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); readScan(scan); } }} placeholder="(01)…(17)…(10)…" /></label>
        <Field label={`${tr(lang, 'lotNumber')} *`} value={lotNumber} onChange={setLotNumber} />
        <Field label={`${tr(lang, 'expiryDate')} *`} value={expiry} onChange={setExpiry} type="date" />
        <Field label={`${tr(lang, 'qtyPacks')} *`} value={packs} onChange={setPacks} type="number" />
        <Field label={tr(lang, 'supplier')} value={supplier} onChange={setSupplier} />
      </div>
      <p className="form-hint">{per > 1 ? `${qtyLabel(product, units, lang)} = ${units}` : qtyLabel(product, units, lang)}</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" disabled={busy} onClick={() => void submit()}><PackagePlus />{tr(lang, 'receiveLot')}</button>
      </div>
    </Modal>
  );
}

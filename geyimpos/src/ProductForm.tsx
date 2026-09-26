/**
 * The clothing product form. A new model is entered once and saved as one
 * product per size × colour (each with its own SKU, barcode and opening
 * stock); an existing product is one variant and is edited on its own.
 */
import { useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, Layers, ScanBarcode } from 'lucide-react';

import { APPAREL_CATEGORIES, COLORS, GENDERS, MATERIALS, SEASONS, SIZE_SCALES, buildVariants, colorHex, colorLabel, scaleFor } from './apparel';
import { parseMoneyInput } from './domain';
import { Field, Modal, SelectField } from './forms';
import { money, newId } from './format';
import { categoryLabel, tr } from './i18n';
import { ProductVisual } from './ProductVisual';
import type { Lang, Product, SessionUser } from './types';

type Props = {
  lang: Lang;
  products: Product[];
  session: SessionUser;
  /** The variant being edited, or null for a new model. */
  product: Product | null;
  /** A new size/colour for an existing model: its fields are copied, its id kept. */
  base?: Product | null;
  onClose: () => void;
  onSave: (products: Product[]) => void;
  /** From an edited variant: open the grid for more sizes/colours of its model. */
  onAddVariant?: (product: Product) => void;
};

export function ApparelProductModal({ lang, products, session, product, base, onClose, onSave, onAddVariant }: Props) {
  const seed = product ?? base ?? null;
  const [nameAz, setNameAz] = useState(seed?.name.az ?? '');
  const [nameRu, setNameRu] = useState(seed?.name.ru ?? '');
  const [nameEn, setNameEn] = useState(seed?.name.en ?? '');
  const [article, setArticle] = useState(seed?.internalCode ?? '');
  const [brand, setBrand] = useState(seed?.brand ?? '');
  const [gender, setGender] = useState(seed?.gender ?? 'Qadın');
  const [category, setCategory] = useState(seed?.category ?? 'Köynək');
  const [material, setMaterial] = useState(seed?.material ?? '');
  const [season, setSeason] = useState(seed?.season ?? 'Bütün mövsüm');
  const [supplier, setSupplier] = useState(seed?.supplier ?? '');
  const [unit, setUnit] = useState(seed?.unit ?? 'əd');
  const [taxRate, setTaxRate] = useState(String(seed?.taxRate ?? 18));
  const [cost, setCost] = useState(seed ? (seed.costMinor / 100).toFixed(2) : '');
  const [price, setPrice] = useState(seed ? (seed.priceMinor / 100).toFixed(2) : '');
  const [priceDiscount, setPriceDiscount] = useState(seed?.priceDiscountMinor ? (seed.priceDiscountMinor / 100).toFixed(2) : '');
  const [minPrice, setMinPrice] = useState(seed?.minPriceMinor ? (seed.minPriceMinor / 100).toFixed(2) : '');
  const [minStock, setMinStock] = useState(String(seed?.minStock ?? 1));
  const [comment, setComment] = useState(seed?.comment ?? '');
  const [image, setImage] = useState<Product['image']>(seed?.image ?? { kind: 'url', url: '' });
  const [error, setError] = useState('');

  // Editing one variant.
  const [color, setColor] = useState(product?.color ?? '');
  const [size, setSize] = useState(product?.size ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [capture, setCapture] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // A new model: the size × colour grid.
  const [scaleId, setScaleId] = useState(scaleFor(seed?.category ?? 'Köynək').id);
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const scale = SIZE_SCALES.find((row) => row.id === scaleId) ?? SIZE_SCALES[0]!;
  const cells = useMemo(() => (colors.length ? colors : ['']).flatMap((c) => sizes.map((s) => ({ color: c, size: s, key: `${c}|${s}` }))), [colors, sizes]);

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => set(list.includes(value) ? list.filter((row) => row !== value) : [...list, value]);
  const changeCategory = (next: string) => {
    setCategory(next);
    if (!product) { setScaleId(scaleFor(next).id); setSizes([]); }
  };
  const pick = async () => { const url = await window.marketSystem?.image.pick(session.sessionToken); if (url) setImage({ kind: 'url', url }); };
  const file = (event: React.ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => setImage({ kind: 'url', url: String(reader.result) }); reader.readAsDataURL(selected); };

  const save = () => {
    const priceMinor = parseMoneyInput(price);
    if (!nameAz.trim() || priceMinor <= 0) { setError(tr(lang, 'requiredFields')); return; }
    const common = {
      name: { az: nameAz.trim(), ru: nameRu.trim() || nameAz.trim(), en: nameEn.trim() || nameAz.trim() },
      category, unit, priceMinor, costMinor: parseMoneyInput(cost || '0'), minStock: Math.max(0, Number(minStock) || 0),
      taxRate: Number(taxRate) || 0, supplier: supplier.trim(), image, active: true, kind: 'product' as const,
      comment: comment.trim(), brand: brand.trim(), material, season, gender,
      priceDiscountMinor: parseMoneyInput(priceDiscount || '0'), minPriceMinor: parseMoneyInput(minPrice || '0'),
      accent: colorHex(color) ?? '#0a4f9c', createdAt: Date.now(),
    };
    const taken = new Set(products.filter((row) => row.id !== product?.id).map((row) => row.barcode));
    if (product) {
      const code = barcode.trim();
      if (!code || !sku.trim()) { setError(tr(lang, 'requiredFields')); return; }
      if (taken.has(code)) { setError(tr(lang, 'barcodeExists')); return; }
      onSave([{ ...product, ...common, internalCode: article.trim(), sku: sku.trim(), barcode: code, color, size, accent: colorHex(color) ?? product.accent, createdAt: product.createdAt, active: product.active }]);
      return;
    }
    if (!sizes.length) { setError(tr(lang, 'pickSize')); return; }
    const code = article.trim() || nameAz.trim();
    const { variants } = buildVariants(
      common,
      code,
      cells.map((cell) => ({ color: cell.color, size: cell.size, qty: Number(qty[cell.key] || 0) })),
      taken,
      () => newId('product'),
      base?.parentProductId || base?.id,
    );
    onSave(variants);
  };

  const title = product ? tr(lang, 'editProduct') : base ? tr(lang, 'addVariants') : tr(lang, 'newModel');
  return (
    <Modal title={title} subtitle={tr(lang, 'apparelFormHint')} onClose={onClose} wide>
      <div className="product-form">
        <aside>
          <ProductVisual image={image} alt={nameAz || tr(lang, 'product')} accent="#0a4f9c" category={category} color={color || colors[0]} />
          <button type="button" onClick={() => void pick()}><ImagePlus />{tr(lang, 'chooseImage')}</button>
          <label className="file-fallback">{tr(lang, 'fromFile')}<input type="file" accept="image/*" onChange={file} /></label>
          {image.kind === 'url' && image.url && <button type="button" onClick={() => setImage({ kind: 'url', url: '' })}>{tr(lang, 'removeImage')}</button>}
          <p>{tr(lang, 'imageHint')}</p>
        </aside>
        <section>
          <h3 className="form-section">{tr(lang, 'modelSection')}</h3>
          <div className="form-grid">
            <Field label={`${tr(lang, 'productName')} · AZ *`} value={nameAz} onChange={setNameAz} />
            <Field label="Название · RU" value={nameRu} onChange={setNameRu} />
            <Field label="Name · EN" value={nameEn} onChange={setNameEn} />
            <Field label={tr(lang, 'article')} value={article} onChange={setArticle} />
            <Field label={tr(lang, 'brand')} value={brand} onChange={setBrand} />
            <SelectField label={tr(lang, 'gender')} value={gender} onChange={setGender} options={GENDERS.map((row) => row.id)} labels={Object.fromEntries(GENDERS.map((row) => [row.id, row.labels[lang]]))} />
            <SelectField label={tr(lang, 'category')} value={category} onChange={changeCategory} options={APPAREL_CATEGORIES.map((row) => row.id)} labels={Object.fromEntries(APPAREL_CATEGORIES.map((row) => [row.id, categoryLabel(row.id, lang)]))} />
            <SelectField label={tr(lang, 'material')} value={material} onChange={setMaterial} options={['', ...MATERIALS]} labels={{ '': '—' }} />
            <SelectField label={tr(lang, 'season')} value={season} onChange={setSeason} options={SEASONS.map((row) => row.id)} labels={Object.fromEntries(SEASONS.map((row) => [row.id, row.labels[lang]]))} />
            <Field label={tr(lang, 'supplier')} value={supplier} onChange={setSupplier} />
            <SelectField label={tr(lang, 'unit')} value={unit} onChange={setUnit} options={['əd', 'cüt', 'dəst']} />
            <SelectField label={tr(lang, 'taxLabel')} value={taxRate} onChange={setTaxRate} options={['18', '8', '2', '0']} labels={{ '18': 'ƏDV 18%', '8': 'Sadələşdirilmiş 8%', '2': 'Sadələşdirilmiş 2%', '0': 'ƏDV-dən azad' }} />
          </div>
          <h3 className="form-section">{tr(lang, 'priceSection')}</h3>
          <div className="form-grid">
            <Field label={`${tr(lang, 'cost')} · AZN`} value={cost} onChange={setCost} type="number" />
            <Field label={`${tr(lang, 'price')} · AZN *`} value={price} onChange={setPrice} type="number" />
            <Field label={`${tr(lang, 'salePrice')} · AZN`} value={priceDiscount} onChange={setPriceDiscount} type="number" />
            <Field label={`${tr(lang, 'minPrice')} · AZN`} value={minPrice} onChange={setMinPrice} type="number" />
            <Field label={tr(lang, 'minStock')} value={minStock} onChange={setMinStock} type="number" />
            <label className="field"><span>{tr(lang, 'margin')}</span><input readOnly value={parseMoneyInput(price) > 0 ? `${money(parseMoneyInput(price) - parseMoneyInput(cost || '0'), lang)} · ${Math.round((1 - parseMoneyInput(cost || '0') / parseMoneyInput(price)) * 100)}%` : '—'} /></label>
            <Field label={tr(lang, 'comment')} value={comment} onChange={setComment} wide />
          </div>

          {product ? (
            <>
              <h3 className="form-section">{tr(lang, 'variantSection')}</h3>
              <div className="form-grid">
                <SelectField label={tr(lang, 'color')} value={color} onChange={setColor} options={['', ...COLORS.map((row) => row.id)]} labels={{ '': '—', ...Object.fromEntries(COLORS.map((row) => [row.id, row.labels[lang]])) }} />
                <Field label={tr(lang, 'size')} value={size} onChange={setSize} />
                <Field label={`${tr(lang, 'sku')} *`} value={sku} onChange={setSku} />
                <label className="field barcode-field"><span>{tr(lang, 'barcode')} *</span><div className={capture ? 'barcode-capture active' : 'barcode-capture'}><input ref={barcodeRef} data-scanner="allow" value={barcode} onChange={(event) => setBarcode(event.target.value.trim())} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setCapture(false); } }} /><button type="button" onClick={() => { setBarcode(''); setCapture(true); window.setTimeout(() => barcodeRef.current?.focus(), 0); }}><ScanBarcode />{capture ? tr(lang, 'scanNow') : tr(lang, 'scanBarcode')}</button></div></label>
              </div>
            </>
          ) : (
            <>
              <h3 className="form-section"><Layers />{tr(lang, 'sizeColorSection')}</h3>
              <div className="form-grid">
                <SelectField label={tr(lang, 'sizeScale')} value={scaleId} onChange={(next) => { setScaleId(next); setSizes([]); }} options={SIZE_SCALES.map((row) => row.id)} labels={Object.fromEntries(SIZE_SCALES.map((row) => [row.id, row.labels[lang]]))} />
              </div>
              <div className="chip-picker" role="group" aria-label={tr(lang, 'size')}>
                {scale.sizes.map((s) => <button type="button" key={s} aria-pressed={sizes.includes(s)} className={sizes.includes(s) ? 'active' : ''} onClick={() => toggle(sizes, s, setSizes)}>{s}</button>)}
                <button type="button" className="chip-all" onClick={() => setSizes(sizes.length === scale.sizes.length ? [] : [...scale.sizes])}>{tr(lang, 'all')}</button>
              </div>
              <div className="chip-picker colors" role="group" aria-label={tr(lang, 'color')}>
                {COLORS.map((c) => <button type="button" key={c.id} aria-pressed={colors.includes(c.id)} className={colors.includes(c.id) ? 'active' : ''} onClick={() => toggle(colors, c.id, setColors)}><i style={{ background: c.hex }} />{c.labels[lang]}</button>)}
              </div>
              {cells.length > 0 && (
                <div className="variant-grid-table">
                  <table>
                    <thead><tr><th>{tr(lang, 'color')}</th>{sizes.map((s) => <th key={s}>{s}</th>)}</tr></thead>
                    <tbody>
                      {(colors.length ? colors : ['']).map((c) => (
                        <tr key={c || 'none'}>
                          <th><i style={{ background: colorHex(c) ?? 'transparent' }} />{c ? colorLabel(c, lang) : '—'}</th>
                          {sizes.map((s) => {
                            const key = `${c}|${s}`;
                            return <td key={key}><input type="number" min={0} inputMode="numeric" aria-label={`${c} ${s}`} value={qty[key] ?? ''} placeholder="0" onChange={(event) => setQty((rows) => ({ ...rows, [key]: event.target.value }))} /></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>{tr(lang, 'variantGridHint').replace('{n}', String(cells.length))}</p>
                </div>
              )}
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </section>
      </div>
      <div className="modal-actions">
        {product && onAddVariant && <button type="button" className="modal-left" onClick={() => onAddVariant(product)}><Layers />{tr(lang, 'addVariant')}</button>}
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" onClick={save}><Check />{product ? tr(lang, 'save') : `${tr(lang, 'save')} · ${cells.length || 0}`}</button>
      </div>
    </Modal>
  );
}

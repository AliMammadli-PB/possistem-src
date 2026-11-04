// Group sale tiles only. Every size keeps its own product ID and recipe.
function psReadSizeName(name) {
  const match = /^(.+?)(?:\s*[·•|–-]\s*|\s+)(\d+(?:[.,]\d+)?)\s*(sm|cm|qr|kq|ml|l)\s*$/i.exec(name || '');
  if (!match) return null;
  const size = Number(match[2].replace(',', '.'));
  const unit = match[3].toLowerCase().replace(/^cm$/, 'sm');
  if (!Number.isFinite(size) || size <= 0 || size > (unit === 'sm' ? 300 : 100000)) return null;
  return { base: match[1].trim(), size, unit };
}

function psGroupOrderSizes(products, lang) {
  const groups = new Map();
  const keys = new Map();
  for (const product of products) {
    const variant = psReadSizeName(product.nameAz || localizedName(product, lang));
    if (!variant) continue;
    const key = JSON.stringify([product.categoryId, variant.base.replace(/\s+/g, ' ').toLocaleLowerCase('az'), variant.unit]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...variant, product });
    keys.set(product.id, key);
  }
  const emitted = new Set();
  return products.flatMap(product => {
    const key = keys.get(product.id);
    const rows = groups.get(key);
    if (!rows || rows.length < 2 || new Set(rows.map(row => row.size)).size !== rows.length) return [product];
    if (emitted.has(key)) return [];
    emitted.add(key);
    rows.sort((a, b) => a.size - b.size);
    const base = psReadSizeName(localizedName(product, lang))?.base || rows[0].base;
    const available = rows.some(({product: p}) => !p.soldOut && p.available !== false && p.available !== 0);
    return [{
      ...product, id: 'size-family:' + key, nameAz: base, nameTr: base, nameEn: base,
      priceMinor: Math.min(...rows.map(row => row.product.priceMinor)),
      soldOut: !available, available, __psSizeVariants: rows
    }];
  });
}
function PsOrderSizes({family,onPick,onClose,busy,error}){const h=psH,out=row=>!!row.product.soldOut||row.product.available===false||row.product.available===0;return jsxRuntimeExports.jsx(PsAdminDialog,{title:localizedName(family,useI18n().lang)+' — ölçü seçin',onClose,busy,children:h('div',{className:'ps-order-sizes'},h('p',null,'İstədiyiniz ölçünü seçin. Hər ölçünün qiyməti və kalkulyasiyası ayrıdır.'),error?h('p',{className:'ps-order-sizes-error',role:'alert'},error):null,...family.__psSizeVariants.map(row=>h('button',{key:row.product.id,type:'button',disabled:busy||out(row),onClick:()=>onPick(row.product)},h('strong',null,row.size+' '+(row.unit||'sm')),h('span',null,formatMoney(row.product.priceMinor),out(row)?h('small',null,'Bitib'):null))))});}
function PsStockMenuPicker({ onClose, onSaved, categories, categoryId }) {
  const h = psH;
  const [goods, setGoods] = reactExports.useState([]);
  const [query, setQuery] = reactExports.useState('');
  const [selected, setSelected] = reactExports.useState(null);
  const [price, setPrice] = reactExports.useState('');
  const [category, setCategory] = reactExports.useState(categoryId);
  const [busy, setBusy] = reactExports.useState(false);
  const [loading, setLoading] = reactExports.useState(true);
  const [error, setError] = reactExports.useState('');
  const lock = reactExports.useRef(false);

  reactExports.useEffect(() => {
    let live = true;
    void window.pos.erp.call('goods.list', {}).then(result => {
      if (!result.success) throw Error(result.error?.message || 'Mallar alınmadı');
      if (live) setGoods((result.data.goods || []).filter(good => !good.menuActive));
    }).catch(cause => { if (live) setError(cause.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  async function publish() {
    if (lock.current || !selected) return;
    const salePriceMinor = psMoneyIn(price);
    if (!psStockInputValid(price) || !Number.isSafeInteger(salePriceMinor) || salePriceMinor <= 0) {
      setError('Satış qiymətini 0 ₼-dən böyük yazın.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await psBusinessCall('catalog.stockEdit', {
        ingredientId: selected.id, name: selected.name, salePriceMinor,
        categoryId: category || '', publish: true
      }, newIdempotencyKey());
      if (!result.success) throw Error(result.error?.message || 'Mal menyuya əlavə edilmədi');
      window.dispatchEvent(new Event('possistem-catalog-changed'));
      await onSaved(result.data.menu);
      onClose();
    } catch (cause) {
      setError(cause.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const term = query.trim().toLocaleLowerCase('az');
  const matches = goods.filter(good => [good.name, good.barcode].some(
    value => String(value || '').toLocaleLowerCase('az').includes(term)));
  return jsxRuntimeExports.jsx(PsAdminDialog, {title: 'Menyuya mal əlavə et', busy, onClose: () => { if (!lock.current) onClose(); },
    children: h('div', {className: 'ps-stock-menu-picker'},
      selected ? h(reactExports.Fragment, null,
        h('div', {className: 'ps-menu-pick-selection'},
          h('strong', null, selected.name),
          h(OpsButton, {tone: 'quiet', disabled: busy, onClick: () => { setSelected(null); setError(''); }}, 'Malı dəyiş')),
        h('label', null, 'Menyu kateqoriyası',
          h(PsCategoryPick, {categories, value: category, onChange: setCategory, blank: 'Mallar', label: 'Menyu kateqoriyası'})),
        h(OpsField, {label: 'Satış qiyməti (₼)', value: price, onChange: setPrice, placeholder: '0.00'}),
        error ? h('p', {role: 'alert', className: 'ps-order-sizes-error'}, error) : null,
        h(OpsButton, {disabled: busy, onClick: publish}, busy ? 'Göndərilir…' : 'Menyuya əlavə et')
      ) : h(reactExports.Fragment, null,
        h('label', null, 'Anbar malı', h('input', {type: 'search', value: query,
          onChange: event => setQuery(event.target.value), placeholder: 'Ad və ya barkod'})),
        loading ? h('p', {role: 'status'}, 'Mallar alınır…') : null,
        error ? h('p', {role: 'alert', className: 'ps-order-sizes-error'}, error) : null,
        !loading && !error && !matches.length ? h('p', null, 'Uyğun anbar malı tapılmadı.') : null,
        h('div', {className: 'ps-menu-pick-results'}, matches.slice(0, 40).map(good =>
          h('button', {type: 'button', key: good.id, onClick: () => {
            setSelected(good);
            setPrice(good.basePriceMinor > 0 ? (good.basePriceMinor / 100).toFixed(2) : '');
            setError('');
          }}, h('strong', null, good.name), h('span', null, good.barcode || good.unit)))),
        matches.length > 40 ? h('small', null, 'Digər malları tapmaq üçün axtarışdan istifadə edin.') : null))
  });
}

function PsGroupExistingSizes({ products, categoryId, onSaved, onClose }) {
  const h = psH;
  const [base, setBase] = reactExports.useState(() => psReadSizeName(products[0].nameAz)?.base || '');
  const [sizes, setSizes] = reactExports.useState(() =>
    Object.fromEntries(products.map(p => [p.id, psReadSizeName(p.nameAz)?.size ?? ''])));
  const [busy, setBusy] = reactExports.useState(false);
  const [error, setError] = reactExports.useState('');
  const lock = reactExports.useRef(false);

  async function save() {
    if (lock.current) return;
    const sizeVariants = products.map(p => ({
      productId: p.id,
      sizeCm: Number(String(sizes[p.id]).replace(',', '.'))
    }));
    if (!base.trim() || sizeVariants.some(v => !Number.isFinite(v.sizeCm) || v.sizeCm <= 0 || v.sizeCm > 300)) {
      setError('Qrupun adını və hər məhsulun ölçüsünü yazın.');
      return;
    }
    if (new Set(sizeVariants.map(v => v.sizeCm)).size !== sizeVariants.length) {
      setError('Hər məhsula fərqli ölçü yazın.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.pos.catalogAdmin.upsertProduct(
        {nameAz: base.trim(), categoryId, sizeUnit: 'sm', sizeVariants},
        {idempotencyKey: newIdempotencyKey()});
      if (!result.success) throw Error(result.error?.message || 'Ölçülər birləşdirilmədi');
      window.dispatchEvent(new Event('possistem-catalog-changed'));
      await onSaved();
    } catch (cause) {
      setError(cause.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return jsxRuntimeExports.jsx(PsAdminDialog, {
    title: 'Ölçüləri birləşdir', onClose: () => { if (!lock.current) onClose(); }, busy,
    children: h('div', {className: 'ps-order-sizes'},
      h('p', null, 'Satışda bir ad görünəcək. Hər ölçünün qiyməti və resepti saxlanılır.'),
      jsxRuntimeExports.jsx(OpsField, {label: 'Satışda görünən ad', value: base, onChange: setBase, placeholder: 'Marqarit pizza'}),
      ...products.map(p => jsxRuntimeExports.jsx(OpsField, {
        key: p.id, label: p.nameAz + ' · ölçü (sm)',
        value: String(sizes[p.id]), onChange: value => setSizes(prev => ({...prev, [p.id]: value}))
      })),
      error ? h('p', {role: 'alert', className: 'ps-order-sizes-error'}, error) : null,
      jsxRuntimeExports.jsx(OpsButton, {disabled: busy, onClick: () => void save(), children: 'Birləşdir'}))
  });
}

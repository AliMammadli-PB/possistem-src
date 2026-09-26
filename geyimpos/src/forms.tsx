/** Modal dialogs and form primitives shared by the market screens. */
import { marketCoreClient } from './core/client';
import { money, newId } from './format';
import { roleLabel, tr } from './i18n';
import { ProductVisual } from './ProductVisual';
import { useEffect, useState } from 'react';
import { ArrowRightLeft, Boxes, Check, Plus, Trash2, UserCog, X } from 'lucide-react';

import type { Lang, Product, PurchaseOrder, Register, Role, SessionUser, StaffProfile, Warehouse } from './types';



export function WarehouseModal({ lang, onClose, onSave }: { lang: Lang; onClose: () => void; onSave: (warehouse: Warehouse) => void }) { const [name, setName] = useState(''); const [code, setCode] = useState(''); const [address, setAddress] = useState(''); const [manager, setManager] = useState(''); return <Modal title={tr(lang, 'addWarehouse')} subtitle="Çoxlu depo və satış zalı idarəsi" onClose={onClose}><div className="form-grid"><Field label={`${tr(lang, 'warehouseName')} *`} value={name} onChange={setName} /><Field label="Depo kodu *" value={code} onChange={setCode} /><Field label={tr(lang, 'address')} value={address} onChange={setAddress} wide /><Field label={tr(lang, 'manager')} value={manager} onChange={setManager} /></div><div className="modal-actions"><button onClick={onClose}>{tr(lang, 'cancel')}</button><button className="modal-primary" disabled={!name || !code} onClick={() => onSave({ id: newId('wh'), code, name, address, manager, active: true })}><Check />{tr(lang, 'save')}</button></div></Modal>; }

export function RegisterModal({ lang, onClose, onSave }: { lang: Lang; onClose: () => void; onSave: (register: Register) => void }) { const [name, setName] = useState(''); const [code, setCode] = useState(''); const [location, setLocation] = useState(''); return <Modal title={tr(lang, 'addRegister')} subtitle="Kassa 1 · Kassa 2 · Ekspress" onClose={onClose}><div className="form-grid"><Field label={`${tr(lang, 'registerName')} *`} value={name} onChange={setName} /><Field label="Kassa kodu *" value={code} onChange={setCode} /><Field label={tr(lang, 'location')} value={location} onChange={setLocation} wide /></div><div className="modal-actions"><button onClick={onClose}>{tr(lang, 'cancel')}</button><button className="modal-primary" disabled={!name || !code} onClick={() => onSave({ id: newId('reg'), code, name, location, status: 'closed', openingFloatMinor: 0 })}><Check />{tr(lang, 'save')}</button></div></Modal>; }

export function PurchaseModal({ lang, products, warehouses, session, onClose, onSave }: { lang: Lang; products: Product[]; warehouses: Warehouse[]; session: SessionUser; onClose: () => void; onSave: (order: PurchaseOrder) => void }) { const [supplier, setSupplier] = useState(''); const [date, setDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10)); const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? ''); const [productId, setProductId] = useState(products[0]?.id ?? ''); const [qty, setQty] = useState('1'); const [lines, setLines] = useState<Array<{ productId: string; qty: number; costMinor: number }>>([]); const addLine = () => { const product = products.find((row) => row.id === productId); const amount = Math.max(1, Number(qty) || 1); if (!product) return; setLines((rows) => rows.some((row) => row.productId === productId) ? rows.map((row) => row.productId === productId ? { ...row, qty: row.qty + amount } : row) : [...rows, { productId, qty: amount, costMinor: product.costMinor }]); }; return <Modal title={tr(lang, 'createOrder')} subtitle="Təchizatçı · depo · məhsul siyahısı" onClose={onClose} wide><div className="form-grid"><Field label={`${tr(lang, 'supplier')} *`} value={supplier} onChange={setSupplier} /><Field label={tr(lang, 'expectedDate')} value={date} onChange={setDate} type="date" /><SelectField label={tr(lang, 'warehouses')} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((row) => row.id)} labels={Object.fromEntries(warehouses.map((row) => [row.id, row.name]))} /></div><div className="order-line-builder"><SelectField label={tr(lang, 'product')} value={productId} onChange={setProductId} options={products.map((row) => row.id)} labels={Object.fromEntries(products.map((row) => [row.id, `${row.sku} · ${row.name[lang]}`]))} /><Field label={tr(lang, 'quantity')} value={qty} onChange={setQty} type="number" /><button onClick={addLine}><Plus />Siyahıya əlavə et</button></div><div className="draft-lines">{lines.map((line) => <div key={line.productId}><ProductVisual image={products.find((row) => row.id === line.productId)?.image ?? { kind: 'url', url: '' }} compact /><span><b>{products.find((row) => row.id === line.productId)?.name[lang]}</b><small>{money(line.costMinor, lang)} maya</small></span><strong>× {line.qty}</strong><button onClick={() => setLines((rows) => rows.filter((row) => row.productId !== line.productId))}><X /></button></div>)}</div><div className="modal-actions"><button onClick={onClose}>{tr(lang, 'cancel')}</button><button className="modal-primary" disabled={!supplier || !lines.length} onClick={() => onSave({ id: `PO-${new Date().toISOString().slice(5, 10).replace('-', '')}-${String(Date.now()).slice(-3)}`, supplier, expectedAt: date, createdAt: Date.now(), createdBy: session.id, warehouseId, status: 'ordered', lines })}><Check />{tr(lang, 'save')}</button></div></Modal>; }

export function TransferModal({ lang, products, warehouses, onClose, onSave }: { lang: Lang; products: Product[]; warehouses: Warehouse[]; onClose: () => void; onSave: (productId: string, from: string, to: string, qty: number) => void }) { const [productId, setProductId] = useState(products[0]?.id ?? ''); const [from, setFrom] = useState(warehouses[0]?.id ?? ''); const [to, setTo] = useState(warehouses[1]?.id ?? ''); const [qty, setQty] = useState('1'); const available = products.find((product) => product.id === productId)?.warehouseStock[from] ?? 0; const amount = Math.max(0, Number(qty) || 0); return <Modal title={tr(lang, 'transfer')} subtitle="Depolar arasında sənədli stok hərəkəti" onClose={onClose}><div className="form-grid"><SelectField label={tr(lang, 'product')} value={productId} onChange={setProductId} options={products.map((row) => row.id)} labels={Object.fromEntries(products.map((row) => [row.id, `${row.sku} · ${row.name[lang]}`]))} wide /><SelectField label="Çıxış deposu" value={from} onChange={setFrom} options={warehouses.map((row) => row.id)} labels={Object.fromEntries(warehouses.map((row) => [row.id, `${row.code} · ${row.name}`]))} /><SelectField label="Qəbul deposu" value={to} onChange={setTo} options={warehouses.map((row) => row.id)} labels={Object.fromEntries(warehouses.map((row) => [row.id, `${row.code} · ${row.name}`]))} /><Field label={`${tr(lang, 'quantity')} · Mövcud ${available}`} value={qty} onChange={setQty} type="number" /></div><div className="transfer-visual"><span>{warehouses.find((row) => row.id === from)?.name}<b>{available}</b></span><ArrowRightLeft /><span>{warehouses.find((row) => row.id === to)?.name}<b>+{amount}</b></span></div><div className="modal-actions"><button onClick={onClose}>{tr(lang, 'cancel')}</button><button className="modal-primary" disabled={from === to || amount <= 0 || amount > available} onClick={() => onSave(productId, from, to, amount)}><Check />{tr(lang, 'transfer')}</button></div></Modal>; }

/**
 * Writing stock off, with the reason it went.
 *
 * Separate from Transfer and from editing a product's stock: those move or
 * correct a number, this records goods that existed and are gone. The reasons
 * come from the core rather than being listed here, so the list the operator
 * picks from is the list the core will accept and the reports will group by.
 */
export function WasteModal({ lang, products, warehouses, onClose, onSave }: { lang: Lang; products: Product[]; warehouses: Warehouse[]; onClose: () => void; onSave: (input: { productId: string; warehouseId: string; qty: number; reason: string; note: string }) => void }) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasons, setReasons] = useState<Array<{ code: string; label: string }>>([]);

  useEffect(() => {
    if (!marketCoreClient.available()) return;
    void marketCoreClient.inventory.wasteReasons()
      .then((result) => {
        setReasons(result.reasons ?? []);
        setReason((current) => current || result.reasons?.[0]?.code || '');
      })
      .catch(() => undefined);
  }, []);

  const product = products.find((row) => row.id === productId);
  const available = product?.warehouseStock[warehouseId] ?? 0;
  const amount = Math.max(0, Number(qty) || 0);
  const lossMinor = (product?.costMinor ?? 0) * amount;

  return (
    <Modal title="Silinmə" subtitle="İtən malın sənədli qeydi" onClose={onClose}>
      <div className="form-grid">
        <SelectField label={tr(lang, 'product')} value={productId} onChange={setProductId}
          options={products.map((row) => row.id)}
          labels={Object.fromEntries(products.map((row) => [row.id, `${row.sku} · ${row.name[lang]}`]))} wide />
        <SelectField label={tr(lang, 'warehouses')} value={warehouseId} onChange={setWarehouseId}
          options={warehouses.map((row) => row.id)}
          labels={Object.fromEntries(warehouses.map((row) => [row.id, `${row.code} · ${row.name}`]))} />
        <Field label={`${tr(lang, 'quantity')} · Mövcud ${available}`} value={qty} onChange={setQty} type="number" />
        <SelectField label="Səbəb *" value={reason} onChange={setReason}
          options={reasons.map((row) => row.code)}
          labels={Object.fromEntries(reasons.map((row) => [row.code, row.label]))} />
        <Field label="Qeyd" value={note} onChange={setNote} wide />
      </div>
      {/* What this costs the shop, before it is written off rather than after. */}
      <p className="hint">Maya dəyəri ilə itki: <b>{money(lossMinor, lang)}</b></p>
      <div className="modal-actions">
        <button onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button className="modal-primary" disabled={!reason || amount <= 0}
          onClick={() => onSave({ productId, warehouseId, qty: amount, reason, note })}>
          <Trash2 />Sil
        </button>
      </div>
    </Modal>
  );
}

export function StaffModal({ lang, registers, warehouses, onClose, onSave }: { lang: Lang; registers: Register[]; warehouses: Warehouse[]; onClose: () => void; onSave: (profile: Partial<StaffProfile>, pin: string) => Promise<void> }) { const [name, setName] = useState(''); const [role, setRole] = useState<Role>('cashier'); const [pin, setPin] = useState(''); const [registerId, setRegisterId] = useState(registers[0]?.id ?? ''); const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? ''); const [error, setError] = useState(''); const submit = async () => { try { await onSave({ name, role, active: true, registerIds: role === 'warehouse' ? [] : [registerId], warehouseIds: role === 'cashier' || role === 'head_cashier' ? ['wh-sales'] : [warehouseId] }, pin); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Xəta'); } }; return <Modal title={tr(lang, 'addStaff')} subtitle="Müdir · Baş kassir · Kassir · Depo" onClose={onClose}><div className="role-select">{(['manager','head_cashier','cashier','warehouse'] as Role[]).map((item) => <button key={item} className={role === item ? 'active' : ''} onClick={() => setRole(item)}><UserCog /><b>{roleLabel(item, lang)}</b></button>)}</div><div className="form-grid"><Field label={`${tr(lang, 'name')} *`} value={name} onChange={setName} /><Field label="Yeni PIN · 4–8 rəqəm *" value={pin} onChange={(value) => setPin(value.replace(/\D/g, '').slice(0, 8))} type="password" />{role !== 'warehouse' && <SelectField label={tr(lang, 'registers')} value={registerId} onChange={setRegisterId} options={registers.map((row) => row.id)} labels={Object.fromEntries(registers.map((row) => [row.id, row.name]))} />}{(role === 'warehouse' || role === 'manager') && <SelectField label={tr(lang, 'warehouses')} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((row) => row.id)} labels={Object.fromEntries(warehouses.map((row) => [row.id, row.name]))} />}</div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button onClick={onClose}>{tr(lang, 'cancel')}</button><button className="modal-primary" disabled={!name || pin.length < 4} onClick={() => void submit()}><Check />{tr(lang, 'save')}</button></div></Modal>; }

export function RoleAvatar({ role, name, compact = false }: { role: Role; name?: string; compact?: boolean }) {
  const text = (name ?? role)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase('az'))
    .join('') || 'M';
  return <span className={compact ? `role-avatar ${role} compact` : `role-avatar ${role}`} aria-hidden="true">{text}</span>;
}
export function Kpi({ icon: Icon, label, value, note, tone }: { icon: typeof Boxes; label: string; value: string; note: string; tone: string }) { return <article className={`kpi ${tone}`}><span><Icon /></span><div><small>{label}</small><strong>{value}</strong><em>{note || '—'}</em></div></article>; }
/** On-screen digits for touch tills; the field stays typeable with a keyboard. */
export function NumPad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // The field opens prefilled with the total: the first digit replaces it.
  const [fresh, setFresh] = useState(true);
  const press = (key: string) => {
    const current = fresh ? '' : value;
    setFresh(false);
    if (key === '⌫') return onChange(current.slice(0, -1));
    if (key === 'C') return onChange('');
    if (key === '.' && current.includes('.')) return;
    if (/\.\d{2}$/.test(current) && key !== '.') return;
    onChange(current === '0' && key !== '.' ? key : current + key);
  };
  return <div className="num-pad" role="group" aria-label="Rəqəm klaviaturası">{['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '.', '00', '⌫'].map((key) => <button type="button" key={key} onClick={() => press(key)}>{key}</button>)}</div>;
}
export function Modal({ title, subtitle, onClose, wide = false, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={wide ? 'modal wide' : 'modal'}><header><div><p>{subtitle}</p><h2>{title}</h2></div><button onClick={onClose}><X /></button></header><div className="modal-body">{children}</div></section></div>; }
export function Field({ label, value, onChange, type = 'text', wide = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; wide?: boolean }) { return <label className={wide ? 'field wide' : 'field'}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
export function SelectField({ label, value, onChange, options, labels, wide = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string>; wide?: boolean }) { return <label className={wide ? 'field wide' : 'field'}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}</select></label>; }

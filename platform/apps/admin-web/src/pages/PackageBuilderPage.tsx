import { useLiveEffect, useDraftGuard } from '../lib/live';
import { useCallback,  useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useI18n } from '../i18n';
import { EditableNumberInput } from '../components/EditableNumberInput';
import { packageTotals, type Billing } from '../lib/package-totals';

/**
 * The website's package builder ("Paket qurucusu"): every feature the customer
 * can tick, its billing period, price, counts and texts, plus where printers can print
 * and the WhatsApp number orders go to. Saved as one document; the site reads
 * it on load (GET /package-builder).
 */

type Lang = 'az' | 'ru' | 'en';
type Text = Record<Lang, string>;
type Kind = 'base' | 'toggle' | 'quantity' | 'printers';
type Item = {
  id: string;
  kind: Kind;
  billing?: Billing;
  name: Text;
  description: Text;
  unit: Text;
  priceMinor: number;
  min: number;
  max: number;
  defaultOn: boolean;
  defaultQty: number;
  active: boolean;
};
type Content = { items: Item[]; printerTargets: Text[]; whatsappPhone: string; note: Text };

const LANGS: Lang[] = ['az', 'ru', 'en'];
const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'base', label: 'Əsas (həmişə daxil)', hint: 'Müştəri söndürə bilməz' },
  { id: 'toggle', label: 'Seçilə bilən', hint: 'Bəli / xeyr' },
  { id: 'quantity', label: 'Ədədlə', hint: 'Qiymət × say (məs. monitor)' },
  { id: 'printers', label: 'Printerlər', hint: 'Qiymət × say, hər birinə ad və təyinat' },
];
const blank = (): Text => ({ az: '', ru: '', en: '' });
const money = (minor: number) => `${(minor / 100).toFixed(2)} ₼`;

function newItem(): Item {
  return {
    id: `f-${Date.now().toString(36)}`,
    kind: 'toggle',
    billing: 'monthly',
    name: blank(),
    description: blank(),
    unit: blank(),
    priceMinor: 0,
    min: 0,
    max: 20,
    defaultOn: false,
    defaultQty: 1,
    active: true,
  };
}

/** Default selection shown to the visitor before editing quantities. */
function previewLines(content: Content) {
  return content.items
    .filter((i) => i.active)
    .map((i) => {
      const qty = i.kind === 'base' ? 1 : i.kind === 'toggle' ? (i.defaultOn ? 1 : 0) : Math.min(i.max, Math.max(i.min, i.defaultQty));
      return { item: i, qty, total: i.priceMinor * qty };
    });
}

export function PackageBuilderPage() {
  const t = useI18n();
  const [saved, setSaved] = useState<Content | null>(null);
  const [draft, setDraft] = useState<Content | null>(null);
  const [lang, setLang] = useState<Lang>('az');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pageRef=useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Content>('/admin/package-builder');
      const normalized={...data,items:data.items.map(item=>({...item,billing:item.billing??'monthly'}))};
      setSaved(normalized);
      setDraft(normalized);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }, [t.common.error]);

  useLiveEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  useDraftGuard(dirty);

  if (!draft) {
    return (
      <div className="page">
        {error ? <div className="banner-error" role="alert">{error}</div> : <p className="muted">{t.loading}</p>}
      </div>
    );
  }

  const setItem = (id: string, patch: Partial<Item>) =>
    setDraft(current=>current?{...current,items:current.items.map(i=>i.id===id?{...i,...patch}:i)}:current);
  const setText = (id: string, field: 'name' | 'description' | 'unit', value: string) => {
    const item = draft.items.find((i) => i.id === id)!;
    setItem(id, { [field]: { ...item[field], [lang]: value } });
  };
  const move = (index: number, by: number) => {
    const items = [...draft.items];
    const [row] = items.splice(index, 1);
    items.splice(index + by, 0, row!);
    setDraft({ ...draft, items });
  };
  const remove = (item: Item) => {
    if (!window.confirm(`"${item.name.az || 'Funksiya'}" silinsin?`)) return;
    setDraft({ ...draft, items: draft.items.filter((i) => i.id !== item.id) });
  };
  const add = () => {
    const item = newItem();
    setDraft({ ...draft, items: [...draft.items, item] });
    setOpen(item.id);
  };

  async function save() {
    if (!draft) return;
    const invalid=pageRef.current?.querySelector<HTMLInputElement>('input:invalid');
    if(invalid){invalid.focus();invalid.reportValidity();return;}
    const inconsistent=draft.items.find(i=>(i.kind==='quantity'||i.kind==='printers')&&(i.min>i.max||i.defaultQty<i.min||i.defaultQty>i.max));
    if(inconsistent){setOpen(inconsistent.id);setError('Minimum maksimumdan böyük ola bilməz. Başlanğıc say həmin aralıqda olmalıdır.');return;}
    const empty = draft.items.find((i) => !i.name.az.trim());
    if (empty) {
      setOpen(empty.id);
      setError('Hər funksiyanın AZ adı olmalıdır');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ ok: true; content: Content }>('/admin/package-builder', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setSaved(res.content);
      setDraft(res.content);
      setNotice('Yadda saxlanıldı — saytda dərhal görünür');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const lines = previewLines(draft);
  const totals=packageTotals(lines.map(({item,qty})=>({priceMinor:item.priceMinor,quantity:qty,billing:item.billing})));

  return (
    <div className="page pb-page" ref={pageRef}>
      <header className="page-head">
        <div>
          <h1>Paket qurucusu</h1>
          <p className="muted">
            Hər maddənin qiymətini və ödəniş növünü seçin. Aylıq və birdəfəlik məbləğlər ayrıca hesablanır.
            Ədədlə seçim qiyməti sayla vurur; ödəniş növü isə həmin məbləğin aylıq, yoxsa bir dəfə ödənəcəyini göstərir.
          </p>
        </div>
        <div className="pb-head-actions">
          <div className="support-filters" role="tablist" aria-label="Dil">
            {LANGS.map((l) => (
              <button key={l} type="button" role="tab" aria-selected={lang === l} className={`chip${lang === l ? ' active' : ''}`} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>Geri al</button>
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saxlanılır…' : 'Yadda saxla'}
          </button>
        </div>
      </header>

      {error ? <div className="banner-error" role="alert">{error}</div> : null}
      {notice && !dirty ? <p className="plans-admin-notice" role="status">{notice}</p> : null}

      <div className="pb-layout">
        <div className="pb-main">
          <section className="pb-items">
            {draft.items.map((item, index) => {
              const expanded = open === item.id;
              return (
                <article key={item.id} className={`pb-item${item.active ? '' : ' is-off'}${expanded ? ' is-open' : ''}`}>
                  <div className="pb-item-row">
                    <div className="pb-order">
                      <button type="button" className="btn ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Yuxarı">↑</button>
                      <button type="button" className="btn ghost" disabled={index === draft.items.length - 1} onClick={() => move(index, 1)} aria-label="Aşağı">↓</button>
                    </div>
                    <button type="button" className="pb-item-title" onClick={() => setOpen(expanded ? null : item.id)}>
                      <strong>{item.name[lang] || item.name.az || 'Yeni funksiya'}</strong>
                      <small>{KINDS.find((k) => k.id === item.kind)?.label}</small>
                    </button>
                    <label className="pb-price">
                      <EditableNumberInput
                        min={0} max={1_000_000} decimals={2}
                        value={item.priceMinor / 100}
                        onValueChange={value=>setItem(item.id,{priceMinor:Math.round(value*100)})}
                        aria-label="Qiymət"
                      />
                      <span>{item.billing==='one_time'?'₼ · bir dəfə':'₼ / ay'}{item.kind === 'quantity' || item.kind === 'printers' ? ' · ədəd' : ''}</span>
                    </label>
                    <label className="pb-billing">
                      <select aria-label="Ödəniş növü" value={item.billing??'monthly'} onChange={e=>setItem(item.id,{billing:e.target.value as Billing})}>
                        <option value="monthly">Aylıq</option>
                        <option value="one_time">Bir dəfə</option>
                      </select>
                    </label>
                    <label className="pb-switch" title="Saytda göstər">
                      <input type="checkbox" checked={item.active} onChange={(e) => setItem(item.id, { active: e.target.checked })} />
                      <span>{item.active ? 'Aktiv' : 'Gizli'}</span>
                    </label>
                  </div>

                  {expanded ? (
                    <div className="pb-item-body">
                      <label className="plans-admin-field">
                        <span>Ad ({lang.toUpperCase()})</span>
                        <input value={item.name[lang]} maxLength={60} onChange={(e) => setText(item.id, 'name', e.target.value)} />
                      </label>
                      <label className="plans-admin-field">
                        <span>Təsvir ({lang.toUpperCase()})</span>
                        <textarea rows={2} value={item.description[lang]} maxLength={240} onChange={(e) => setText(item.id, 'description', e.target.value)} />
                      </label>
                      <div className="pb-grid">
                        <label className="plans-admin-field">
                          <span>Növ</span>
                          <select value={item.kind} onChange={(e) => setItem(item.id, { kind: e.target.value as Kind })}>
                            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                          <small className="muted">{KINDS.find((k) => k.id === item.kind)?.hint}</small>
                        </label>
                        {item.kind === 'toggle' ? (
                          <label className="pb-switch pb-switch-field">
                            <input type="checkbox" checked={item.defaultOn} onChange={(e) => setItem(item.id, { defaultOn: e.target.checked })} />
                            <span>Saytda əvvəlcədən seçilsin</span>
                          </label>
                        ) : null}
                        {item.kind === 'quantity' || item.kind === 'printers' ? (
                          <>
                            <label className="plans-admin-field">
                              <span>Vahid ({lang.toUpperCase()})</span>
                              <input value={item.unit[lang]} maxLength={24} placeholder="ədəd" onChange={(e) => setText(item.id, 'unit', e.target.value)} />
                            </label>
                            <label className="plans-admin-field">
                              <span>Minimum</span>
                              <EditableNumberInput min={0} max={100} value={item.min} onValueChange={value=>setItem(item.id,{min:value})} />
                            </label>
                            <label className="plans-admin-field">
                              <span>Maksimum</span>
                              <EditableNumberInput min={0} max={100} value={item.max} onValueChange={value=>setItem(item.id,{max:value})} />
                            </label>
                            <label className="plans-admin-field">
                              <span>Başlanğıc say</span>
                              <EditableNumberInput min={0} max={100} value={item.defaultQty} onValueChange={value=>setItem(item.id,{defaultQty:value})} />
                            </label>
                          </>
                        ) : null}
                      </div>
                      <div className="pb-item-foot">
                        <span className="muted mono">{item.id}</span>
                        <button type="button" className="btn danger" onClick={() => remove(item)}>Sil</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <button type="button" className="btn secondary pb-add" onClick={add}>+ Funksiya əlavə et</button>
          </section>

          <section className="plans-admin-card">
            <h2>Printer harada çap edir — seçimlər ({lang.toUpperCase()})</h2>
            <p className="muted">Saytda hər printer adının yanında bu siyahıdan seçilir (məs. Mətbəx, Bar).</p>
            {draft.printerTargets.map((target, index) => (
              <div key={index} className="pb-target">
                <input
                  value={target[lang]}
                  maxLength={40}
                  placeholder={target.az}
                  onChange={(e) => setDraft({ ...draft, printerTargets: draft.printerTargets.map((x, i) => (i === index ? { ...x, [lang]: e.target.value } : x)) })}
                />
                <button type="button" className="btn danger" onClick={() => setDraft({ ...draft, printerTargets: draft.printerTargets.filter((_, i) => i !== index) })}>Sil</button>
              </div>
            ))}
            {draft.printerTargets.length < 12 ? (
              <button type="button" className="btn secondary" onClick={() => setDraft({ ...draft, printerTargets: [...draft.printerTargets, blank()] })}>+ Seçim əlavə et</button>
            ) : null}
          </section>

          <section className="plans-admin-card">
            <h2>Sifariş</h2>
            <label className="plans-admin-field">
              <span>WhatsApp nömrəsi (yalnız rəqəmlər, ölkə kodu ilə)</span>
              <input value={draft.whatsappPhone} inputMode="numeric" maxLength={15} onChange={(e) => setDraft({ ...draft, whatsappPhone: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="plans-admin-field">
              <span>Qeyd — kalkulyatorun altında ({lang.toUpperCase()})</span>
              <textarea rows={2} maxLength={400} value={draft.note[lang]} onChange={(e) => setDraft({ ...draft, note: { ...draft.note, [lang]: e.target.value } })} />
            </label>
          </section>
        </div>

        <aside className="pb-preview plans-admin-card">
          <h2>Önizləmə</h2>
          <p className="muted">Saytda ilk açılışda görünən seçim</p>
          <ul>
            {lines.map(({ item, qty, total: sum }) => (
              <li key={item.id} className={qty ? '' : 'is-off'}>
                <span>
                  {item.name[lang] || item.name.az || '—'}
                  {item.kind === 'quantity' || item.kind === 'printers' ? ` × ${qty}` : ''}
                  <small className="pb-billing-tag">{item.billing==='one_time'?'Bir dəfə':'Aylıq'}</small>
                </span>
                <b>{qty ? money(sum) : '—'}</b>
              </li>
            ))}
          </ul>
          <div className="pb-totals">
            <div className="pb-total"><span>Aylıq ödəniş</span><strong>{money(totals.monthlyMinor)}</strong></div>
            <div className="pb-total"><span>Birdəfəlik ödəniş</span><strong>{money(totals.oneTimeMinor)}</strong></div>
            <div className="pb-total is-first"><span>İlk ödəniş</span><strong>{money(totals.firstPaymentMinor)}</strong></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

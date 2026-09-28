/**
 * Shelves: which medicine sits where. A pharmacist picks a shelf and sees
 * every medicine on it with its stock and nearest expiry, or finds the
 * medicines that have no shelf yet. Shelves are kept in the core (shelf.*);
 * a medicine names its shelf in the medicine form.
 */
import { useMemo, useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';

import { marketCoreClient } from './core/client';
import { stockOf } from './domain';
import { Field } from './forms';
import { tr } from './i18n';
import { expiryState, nextLot, qtyLabel, type Lot } from './pharmacy';
import { ProductVisual } from './ProductVisual';
import type { Lang, Product, SessionUser, Shelf } from './types';

const NO_SHELF = '';

export function ShelvesPanel({ lang, products, shelves, lots, session, canEdit, notify, onChanged, onEdit }: {
  lang: Lang; products: Product[]; shelves: Shelf[]; lots: Map<string, Lot[]>; session: SessionUser; canEdit: boolean;
  notify: (text: string) => void; onChanged: () => void; onEdit: (product: Product) => void;
}) {
  const [selected, setSelected] = useState<string>(shelves[0]?.code ?? NO_SHELF);
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('');
  const active = products.filter((row) => row.active);
  const byShelf = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of active) map.set(product.shelf ?? NO_SHELF, [...(map.get(product.shelf ?? NO_SHELF) ?? []), product]);
    return map;
  }, [active]);
  const onShelf = (byShelf.get(selected) ?? []).sort((a, b) => a.name[lang].localeCompare(b.name[lang], 'az'));
  const current = shelves.find((row) => row.code === selected);
  // Shelves typed on a medicine but never created here still show up, so nothing is lost.
  const known = new Set(shelves.map((row) => row.code));
  const orphans = [...byShelf.keys()].filter((key) => key && !known.has(key));

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      notify(done);
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };
  const add = () => {
    const next = code.trim();
    if (!next) return;
    void run(() => marketCoreClient.shelves.save({ code: next, zone: zone.trim(), sort: shelves.length }, session.id), `${tr(lang, 'shelfSaved')} · ${next}`);
    setSelected(next);
    setCode('');
    setZone('');
  };

  return (
    <div className="shelves-layout">
      <aside className="shelf-list">
        {canEdit && (
          <div className="shelf-add">
            <Field label={tr(lang, 'shelfCode')} value={code} onChange={setCode} />
            <Field label={tr(lang, 'shelfZone')} value={zone} onChange={setZone} />
            <button type="button" className="primary-action" disabled={!code.trim()} onClick={add}><Plus />{tr(lang, 'addShelf')}</button>
          </div>
        )}
        {[...shelves.map((row) => row.code), ...orphans].map((key) => {
          const shelf = shelves.find((row) => row.code === key);
          return (
            <button type="button" key={key} className={selected === key ? 'active' : ''} onClick={() => setSelected(key)}>
              <MapPin />
              <span><b>{key}</b><small>{shelf?.zone || '—'}</small></span>
              <em>{byShelf.get(key)?.length ?? 0}</em>
            </button>
          );
        })}
        <button type="button" className={selected === NO_SHELF ? 'active muted' : 'muted'} onClick={() => setSelected(NO_SHELF)}>
          <MapPin />
          <span><b>{tr(lang, 'noShelf')}</b><small>{tr(lang, 'noShelfHint')}</small></span>
          <em>{byShelf.get(NO_SHELF)?.length ?? 0}</em>
        </button>
      </aside>
      <section className="shelf-content">
        <header>
          <div>
            <h2><MapPin /> {selected || tr(lang, 'noShelf')}</h2>
            <span>{current?.zone || (selected ? '' : tr(lang, 'noShelfHint'))}</span>
          </div>
          {canEdit && current && !onShelf.length && (
            <button type="button" onClick={() => void run(() => marketCoreClient.shelves.remove(current.code, session.id), `${tr(lang, 'shelfDeleted')} · ${current.code}`)}><Trash2 />{tr(lang, 'deleteShelf')}</button>
          )}
        </header>
        {!onShelf.length && <p className="shelf-empty">{tr(lang, 'shelfEmpty')}</p>}
        <div className="shelf-items">
          {onShelf.map((product) => {
            const lot = nextLot(lots.get(product.id) ?? []);
            return (
              <button type="button" key={product.id} disabled={!canEdit} onClick={() => onEdit(product)}>
                <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} category={product.category} dosageForm={product.dosageForm} />
                <span><b>{product.name[lang]}{product.strength ? ` ${product.strength}` : ''}</b><small>{[product.inn, product.manufacturer].filter(Boolean).join(' · ')}</small></span>
                <span className="shelf-stock">{qtyLabel(product, stockOf(product), lang)}</span>
                <span className={`med-expiry is-${expiryState(lot?.expires_at)}`}>{lot?.expires_at ? new Date(lot.expires_at).toLocaleDateString('az-AZ') : '—'}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

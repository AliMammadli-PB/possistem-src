import { useLiveEffect } from '../lib/live';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * Module gates — every catalogue area as an Açıq/Bağlı card.
 *
 * Parent card toggles the whole module. Expand to pick only some children
 * (e.g. Anbar açıq, amma yalnız stok + alış — sayım bağlı).
 */

type Surface = 'portal' | 'market' | 'restaurant';
type AccessPayload = Record<Surface, string[]>;
type Area = { key: string; label: string };
type Catalogue = Record<Surface, Area[]>;

type ChildDef = { surface: Surface; key: string; label: string };
type GroupDef = {
  id: string;
  title: string;
  hint: string;
  surface: Surface;
  /** Catalogue keys that belong to this module (order preserved). */
  keys: string[];
};

const SURFACE_TITLE: Record<Surface, string> = {
  restaurant: 'Restoran kassası',
  market: 'Market kassası',
  portal: 'Sayt (müştəri kabineti)',
};

/** Curated modules — leftovers from the catalogue become single-key cards. */
const GROUP_DEFS: GroupDef[] = [
  // —— Restoran ——
  { id: 'r-tables', title: 'Zal', hint: 'Masalar, oturacaq, zal planı', surface: 'restaurant', keys: ['tables'] },
  { id: 'r-kds', title: 'Mətbəx (KDS)', hint: 'Mətbəx ekranı və sifariş statusu', surface: 'restaurant', keys: ['kds'] },
  { id: 'r-refund', title: 'Qaytarma', hint: 'Kassada qaytarma əməliyyatı', surface: 'restaurant', keys: ['refund'] },
  {
    id: 'r-stock',
    title: 'Anbar',
    hint: 'Stok, təchizat — İdarə → Anbar',
    surface: 'restaurant',
    keys: ['stock', 'suppliers'],
  },
  { id: 'r-guests', title: 'Müştərilər', hint: 'Qonaq kartı və rezervasiya', surface: 'restaurant', keys: ['guests'] },
  { id: 'r-delivery', title: 'Çatdırılma', hint: 'Kuryer və çatdırılma sifarişləri', surface: 'restaurant', keys: ['delivery'] },
  { id: 'r-roster', title: 'İş qrafiki', hint: 'Növbə və işçi cədvəli', surface: 'restaurant', keys: ['roster'] },
  { id: 'r-catalog', title: 'Menyu', hint: 'Məhsul kataloqu və qiymətlər', surface: 'restaurant', keys: ['catalog'] },
  { id: 'r-reports', title: 'Hesabat', hint: 'Satış və dövr hesabatları', surface: 'restaurant', keys: ['reports'] },
  { id: 'r-cash', title: 'Kassa', hint: 'Nəğd hərəkət və bağlanış', surface: 'restaurant', keys: ['cash'] },
  { id: 'r-staff', title: 'İşçilər', hint: 'PIN, rollar, personal', surface: 'restaurant', keys: ['staff'] },
  { id: 'r-admin', title: 'İdarə', hint: 'Admin panel qapısı', surface: 'restaurant', keys: ['admin'] },
  {
    id: 'r-settings',
    title: 'Parametrlər',
    hint: 'Kassada Tənzimləmələr',
    surface: 'restaurant',
    keys: ['settings'],
  },

  // —— Market ——
  { id: 'm-dashboard', title: 'Panel', hint: 'Market ana panel', surface: 'market', keys: ['dashboard'] },
  { id: 'm-sale', title: 'Satış', hint: 'Pərakəndə satış ekranı', surface: 'market', keys: ['sale'] },
  {
    id: 'm-stock',
    title: 'Anbar',
    hint: 'Qalıq, anbarlar, alış, sayım, idxal',
    surface: 'market',
    keys: ['inventory', 'warehouses', 'purchases', 'stocktake', 'import'],
  },
  { id: 'm-returns', title: 'Qaytarma', hint: 'Market qaytarma', surface: 'market', keys: ['returns'] },
  { id: 'm-reports', title: 'Hesabat', hint: 'Market hesabatları', surface: 'market', keys: ['reports'] },
  { id: 'm-registers', title: 'Kassa', hint: 'Kassa aparatları', surface: 'market', keys: ['registers'] },
  { id: 'm-customers', title: 'Müştərilər', hint: 'Market müştəri kartları', surface: 'market', keys: ['customers'] },
  { id: 'm-staff', title: 'İşçilər', hint: 'Market personalı', surface: 'market', keys: ['staff'] },
  { id: 'm-settings', title: 'Parametrlər', hint: 'Market tənzimləmələri', surface: 'market', keys: ['settings'] },

  // —— Sayt ——
  { id: 'p-home', title: 'Ana səhifə', hint: 'Kabinet ana səhifəsi', surface: 'portal', keys: ['home'] },
  {
    id: 'p-anbar',
    title: 'Anbar',
    hint: 'Stok, məhsul, alış, sayım — sayt Anbarı',
    surface: 'portal',
    keys: [
      'anbar', 'product', 'enter', 'loss', 'move', 'inventory', 'stock', 'stockbalance',
      'supply', 'purchaseorder',
      'anbar.write', 'product.write', 'enter.write', 'loss.write', 'move.write', 'inventory.write',
      'purchaseorder.write', 'supply.write',
    ],
  },
  {
    id: 'p-sales',
    title: 'Satış və hesabat',
    hint: 'Satış, qaytarma, mənfəət, gündəlik hesabat',
    surface: 'portal',
    keys: [
      'emeliyyat', 'demand', 'demandreturns', 'customerorders', 'retailsales', 'retailreturns',
      'salepoints', 'salereports', 'profit', 'dailyreports', 'producttransactions', 'comprehensive',
    ],
  },
  {
    id: 'p-parties',
    title: 'Tərəf-müqabillər',
    hint: 'Müştəri / təchizatçı kartları',
    surface: 'portal',
    keys: ['customer'],
  },
  {
    id: 'p-finance',
    title: 'Ödənişlər və borclar',
    hint: 'Ödəniş, borc, kredit, transfer',
    surface: 'portal',
    keys: [
      'transactions', 'settlements', 'cashtransactions', 'credittransaction',
      'transactions.write', 'credittransaction.write',
    ],
  },
  {
    id: 'p-cash',
    title: 'Kassa hərəkətləri',
    hint: 'Mədaxil, məxaric, hesablar, növbələr',
    surface: 'portal',
    keys: ['cashins', 'cashouts', 'cashes', 'shifts', 'cashins.write', 'cashouts.write'],
  },
  { id: 'p-chat', title: 'Chat', hint: 'Dəstək / daxili chat', surface: 'portal', keys: ['chat'] },
  { id: 'p-setup', title: 'Quraşdırma', hint: 'Onboarding və quraşdırma', surface: 'portal', keys: ['setup'] },
  { id: 'p-downloads', title: 'Yükləmələr', hint: 'POS quraşdırıcı və yeniləmələr', surface: 'portal', keys: ['downloads'] },
  { id: 'p-activity', title: 'Fəaliyyət', hint: 'Son əməliyyatlar', surface: 'portal', keys: ['activity'] },
  { id: 'p-integrations', title: 'İnteqrasiyalar', hint: 'Xarici bağlantılar', surface: 'portal', keys: ['integrations'] },
  {
    id: 'p-settings',
    title: 'Parametrlər',
    hint: 'Sayt Parametrlər menyusu',
    surface: 'portal',
    keys: ['settings'],
  },
  { id: 'p-support', title: 'Dəstək', hint: 'Dəstək biletləri', surface: 'portal', keys: ['support'] },
];

function token(surface: Surface, key: string) {
  return `${surface}:${key}`;
}

function buildGroups(catalogue: Catalogue): Array<GroupDef & { children: ChildDef[] }> {
  const claimed = new Set<string>();
  const out: Array<GroupDef & { children: ChildDef[] }> = [];

  for (const def of GROUP_DEFS) {
    const labelOf = (key: string) =>
      catalogue[def.surface].find((a) => a.key === key)?.label ?? key;
    const children = def.keys
      .filter((key) => catalogue[def.surface].some((a) => a.key === key))
      .map((key) => {
        claimed.add(token(def.surface, key));
        return { surface: def.surface, key, label: labelOf(key) };
      });
    if (children.length === 0) continue;
    out.push({ ...def, children });
  }

  // Anything not in a curated group still gets its own card.
  for (const surface of ['restaurant', 'market', 'portal'] as Surface[]) {
    for (const area of catalogue[surface]) {
      const id = token(surface, area.key);
      if (claimed.has(id)) continue;
      out.push({
        id: `auto-${id}`,
        title: area.label,
        hint: `${SURFACE_TITLE[surface]} · ${area.key}`,
        surface,
        keys: [area.key],
        children: [{ surface, key: area.key, label: area.label }],
      });
    }
  }

  return out;
}

function GateSwitch({
  on,
  partial,
  onClick,
  labels,
}: {
  on: boolean;
  partial?: boolean;
  onClick: () => void;
  labels?: { on: string; off: string; partial?: string };
}) {
  const text = partial
    ? (labels?.partial ?? 'Qismən')
    : on
      ? (labels?.on ?? 'Açıq')
      : (labels?.off ?? 'Bağlı');
  return (
    <button
      type="button"
      className={`gate-switch${on && !partial ? ' on' : ''}${partial ? ' partial' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="gate-knob" />
      <span className="gate-label">{text}</span>
    </button>
  );
}

export function ModuleGates({ customerId }: { customerId: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeSurface, setActiveSurface] = useState<Surface>('portal');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const groups = useMemo(
    () => (catalogue ? buildGroups(catalogue) : []),
    [catalogue],
  );

  const load = useCallback(() => {
    setLoading(true);
    setNotice('');
    void Promise.all([
      api<{ surfaces: Array<{ surface: Surface; areas: Area[] }> }>('/access-areas'),
      api<AccessPayload>(`/customers/${customerId}/access`),
    ])
      .then(([cat, current]) => {
        const next: Catalogue = { portal: [], market: [], restaurant: [] };
        for (const row of cat.surfaces) next[row.surface] = row.areas;
        setCatalogue(next);

        const picked = new Set<string>();
        for (const surface of ['portal', 'market', 'restaurant'] as Surface[]) {
          for (const key of current[surface] ?? []) {
            picked.add(token(surface, key));
          }
        }
        setEnabled(picked);
      })
      .catch(() => setNotice('İcazələr yüklənmədi'))
      .finally(() => setLoading(false));
  }, [customerId]);

  useLiveEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('az');
    if (!q) return groups;
    return groups.filter((g) => {
      const hay = [g.title, g.hint, g.surface, ...g.children.map((c) => `${c.label} ${c.key}`)]
        .join(' ')
        .toLocaleLowerCase('az');
      return hay.includes(q);
    });
  }, [groups, query]);

  const bySurface = useMemo(() => {
    const map: Record<Surface, typeof filtered> = { restaurant: [], market: [], portal: [] };
    for (const g of filtered) map[g.surface].push(g);
    return map;
  }, [filtered]);

  useEffect(() => {
    if (loading) return;
    if (bySurface[activeSurface].length > 0) return;
    const next = (['portal', 'restaurant', 'market'] as Surface[]).find(
      (surface) => bySurface[surface].length > 0,
    );
    if (next) setActiveSurface(next);
  }, [activeSurface, bySurface, loading]);

  const childOn = (c: ChildDef) => enabled.has(token(c.surface, c.key));

  const groupState = (g: { children: ChildDef[] }) => {
    const onCount = g.children.filter(childOn).length;
    if (onCount === 0) return { on: false, partial: false };
    if (onCount === g.children.length) return { on: true, partial: false };
    return { on: true, partial: true };
  };

  const persist = async (next: Set<string>) => {
    if (!catalogue) return;
    setSaving(true);
    setNotice('');
    try {
      const body: AccessPayload = { portal: [], market: [], restaurant: [] };
      for (const surface of ['portal', 'market', 'restaurant'] as Surface[]) {
        body[surface] = catalogue[surface]
          .map((a) => a.key)
          .filter((key) => next.has(token(surface, key)));
      }
      await api(`/customers/${customerId}/access`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setNotice('Tətbiq olundu. Sayt dərhal, kassa növbəti bağlantıda.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Tətbiq olunmadı');
      load();
    } finally {
      setSaving(false);
    }
  };

  const applyEnabled = (next: Set<string>) => {
    setEnabled(next);
    void persist(next);
  };

  const setChild = (c: ChildDef, next: boolean) => {
    const copy = new Set(enabled);
    const id = token(c.surface, c.key);
    if (next) copy.add(id);
    else copy.delete(id);
    applyEnabled(copy);
  };

  const toggleGroup = (g: { children: ChildDef[] }) => {
    const { on, partial } = groupState(g);
    const turnOn = !on || partial; // partial / off → all on; full on → all off
    const copy = new Set(enabled);
    for (const c of g.children) {
      const id = token(c.surface, c.key);
      if (turnOn) copy.add(id);
      else copy.delete(id);
    }
    applyEnabled(copy);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  if (loading) {
    return (
      <section className="card module-gates">
        <h2>Modul icazələri</h2>
        <p className="muted">Yüklənir…</p>
      </section>
    );
  }

  const surfaces = ['portal', 'restaurant', 'market'] as Surface[];
  const activeList = bySurface[activeSurface];

  return (
    <section className="card module-gates">
      <div className="section-heading">
        <div>
          <h2>Modul icazələri</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Bağlı modul saytda və kassada açılmır. Dəyişiklik dərhal tətbiq olunur.
            {saving ? ' · Saxlanır…' : ''}
          </p>
        </div>
      </div>

      <label className="gate-search">
        <span className="sr-only">Axtarış</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Anbar, parametrlər, kassa…"
          autoComplete="off"
        />
      </label>

      <div className="gate-surface-tabs" role="tablist" aria-label="İcazə səthləri">
        {surfaces.map((surface) => (
          <button
            key={surface}
            type="button"
            role="tab"
            aria-selected={surface === activeSurface}
            className={surface === activeSurface ? 'active' : ''}
            onClick={() => setActiveSurface(surface)}
          >
            <span>{SURFACE_TITLE[surface]}</span>
            <strong>{bySurface[surface].length}</strong>
          </button>
        ))}
      </div>

      <div className="gate-section gate-section-active">
        <div className="gate-section-head">
          <h3 className="gate-section-title">{SURFACE_TITLE[activeSurface]}</h3>
          <span className="muted">{activeList.length} modul</span>
        </div>
        <ul className="module-gate-list">
          {activeList.map((gate) => {
            const { on, partial } = groupState(gate);
            const open = expanded.has(gate.id) || (query.trim().length > 0 && gate.children.length > 1);
            const multi = gate.children.length > 1;
            return (
              <li
                key={gate.id}
                className={`${on ? (partial ? 'is-partial' : 'is-on') : 'is-off'}${open && multi ? ' is-open' : ''}`}
              >
                <div className="gate-row">
                  <div className="gate-copy">
                    {multi ? (
                      <button
                        type="button"
                        className="gate-expand"
                        aria-expanded={open}
                        onClick={() => toggleExpand(gate.id)}
                      >
                        <span className={`gate-chevron${open ? ' open' : ''}`} aria-hidden />
                        <strong>{gate.title}</strong>
                      </button>
                    ) : (
                      <strong>{gate.title}</strong>
                    )}
                    <p>{gate.hint}</p>
                    {multi ? (
                      <span className="gate-count">
                        {gate.children.filter(childOn).length}/{gate.children.length} açıq
                        {partial ? ' — yalnız seçilmişlər' : ''}
                      </span>
                    ) : null}
                  </div>
                  <GateSwitch on={on} partial={partial} onClick={() => toggleGroup(gate)} />
                </div>

                {multi && open ? (
                  <ul className="gate-children">
                    {gate.children.map((child) => {
                      const childEnabled = childOn(child);
                      return (
                        <li key={token(child.surface, child.key)} className={childEnabled ? 'is-on' : 'is-off'}>
                          <div>
                            <strong>{child.label}</strong>
                            <p className="gate-child-key">{child.key}</p>
                          </div>
                          <GateSwitch
                            on={childEnabled}
                            onClick={() => setChild(child, !childEnabled)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">Axtarışa uyğun modul tapılmadı.</p>
      ) : null}

      {notice ? (
        <p className={notice.includes('Tətbiq olundu') ? 'ok-line' : 'muted'} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

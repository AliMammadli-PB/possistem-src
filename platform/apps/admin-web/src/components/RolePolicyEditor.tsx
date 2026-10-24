import { useLiveEffect } from '../lib/live';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Staff roles — same catalog cards as ModuleGates (Açıq/Bağlı).
 * Simple: product tabs → role tabs → permission cards. Auto-save on toggle.
 */

export type RolePolicyRole = { name: string; permissions: string[]; operationPolicyVersion?: 1 };
export type PermissionEntry = { key: string; label: string; hint?: string };
export type PermissionGroup = { key: string; label: string; permissions: PermissionEntry[] };

export type PosProduct = 'restaurant' | 'market';

export const PRODUCT_LABEL: Record<PosProduct, string> = {
  restaurant: 'Restoran POS',
  market: 'Market POS',
};

/** The super admin's allow / deny for one worker, on top of their role. */
export type RoleUser = { userId: string; name?: string; allow: string[]; deny: string[] };
export type StaffRow = { id: string; name: string; role: string; active: boolean; objectId?: string; updatedAt?: number };

export type RolePolicy = {
  product?: PosProduct;
  products?: PosProduct[];
  roles: RolePolicyRole[];
  users?: RoleUser[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
  entitlements?: { unrestricted: boolean; allowed: string[]; updatedAt: string | null };
  catalogue?: PermissionGroup[];
};

type Props = {
  load: (product: PosProduct) => Promise<RolePolicy>;
  save: (roles: RolePolicyRole[], product: PosProduct, users?: RoleUser[]) => Promise<RolePolicy>;
  /** Market workers as their tills reported them; enables the İşçilər tab. */
  loadStaff?: (product: PosProduct) => Promise<StaffRow[]>;
  /** Opens this worker's rights (set from the page's İşçilər list; `at` re-triggers the same worker). */
  pickWorker?: { id: string; at: number } | null;
  /** Opens this role (the page's "Müdür icazələri" button; `at` re-triggers). */
  pickRole?: { name: string; at: number } | null;
  saveEntitlements?: (
    input: { unrestricted: boolean; allowed: string[] },
    product: PosProduct,
  ) => Promise<unknown>;
  subtitle?: string;
};

const DEFAULT_ROLES = ['waiter', 'kitchen', 'cashier', 'supervisor', 'manager'];

/**
 * Market roles start from what the till already grants them, so the first
 * toggle on the website changes one right instead of wiping the rest.
 * The manager (Müdür) starts with every right; POSSISTEM narrows it here and
 * the till hides whatever is left out. Seeded with every key in refresh().
 */
const MARKET_DEFAULT_ROLES: RolePolicyRole[] = [
  { name: 'cashier', permissions: ['DOCS_VIEW', 'OPEN_DRAWER', 'SALE_DISCOUNT'] },
  { name: 'head_cashier', permissions: ['CASH_IN', 'CASH_OUT', 'CLOSE_SHIFT', 'DOCS_VIEW', 'HOLD_CANCEL', 'OPEN_DRAWER', 'PARTIAL_REFUND', 'PRICE_OVERRIDE', 'SAFE_DROP', 'SALE_CANCEL', 'SALE_DISCOUNT', 'SALE_REFUND', 'VIEW_REPORTS'] },
  { name: 'warehouse', permissions: ['CREATE_PRODUCT', 'DOCS_DELETE', 'DOCS_EDIT', 'DOCS_VIEW', 'EDIT_PRODUCT', 'EDIT_STOCK', 'RECEIVE_PURCHASE', 'STOCK_ADJUSTMENT', 'TRANSFER_STOCK', 'VIEW_COST', 'VIEW_REPORTS'] },
  { name: 'manager', permissions: [] },
];
const ROLE_LABEL: Record<string, string> = { manager: 'Müdür', head_cashier: 'Baş kassir', cashier: 'Kassir', warehouse: 'Anbardar', administrator: 'Administrator' };
export const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;

/** Çek + printer — every role keeps these; package cannot lock them out. */
const ALWAYS_ON = new Set(['receipt.print', 'printer.manage']);

function withAlwaysOn(roles: RolePolicyRole[]): RolePolicyRole[] {
  return roles.map((role) => ({
    ...role,
    permissions: [...new Set([...role.permissions, ...ALWAYS_ON])],
  }));
}

function GateSwitch({
  on,
  partial,
  disabled,
  onClick,
}: {
  on: boolean;
  partial?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const text = partial ? 'Qismən' : on ? 'Açıq' : 'Bağlı';
  return (
    <button
      type="button"
      className={`gate-switch${on && !partial ? ' on' : ''}${partial ? ' partial' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="gate-knob" />
      <span className="gate-label">{text}</span>
    </button>
  );
}

export function RolePolicyEditor({ load, save, saveEntitlements, subtitle, loadStaff, pickWorker, pickRole }: Props) {
  const [policy, setPolicy] = useState<RolePolicy | null>(null);
  const [roles, setRoles] = useState<RolePolicyRole[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState(false);
  const [product, setProduct] = useState<PosProduct>('restaurant');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [mode, setMode] = useState<'roles' | 'workers'>('roles');
  const [worker, setWorker] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await load(product);
      setPolicy(next);
      setUsers(next.users ?? []);
      let seeded =
        next.roles.length > 0
          ? next.roles
          : product === 'market'
            ? MARKET_DEFAULT_ROLES
            : DEFAULT_ROLES.map((name) => ({ name, permissions: [] }));
      if (product === 'market') {
        // Same default as the API: a manager holding no market key means "all of them".
        const all = (next.catalogue ?? []).flatMap((g) => g.permissions.map((p) => p.key));
        const manager = seeded.find((r) => r.name === 'manager');
        if (!manager) {
          seeded = [...seeded.filter((r) => r.name !== 'manager'), { name: 'manager', permissions: all }];
        }
      }
      setRoles(withAlwaysOn(seeded));
      const roleNames = seeded.map((role) => role.name);
      setSelected((current) =>
        current && roleNames.includes(current) ? current : roleNames[0] ?? null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Səlahiyyətlər yüklənmədi');
    }
  }, [load, product]);

  useLiveEffect(() => { void refresh(); }, [refresh]);
  const workersOn = product === 'market' && Boolean(loadStaff);
  useEffect(() => {
    if (!pickWorker) return;
    setProduct('market');
    setMode('workers');
    setWorker(pickWorker.id);
  }, [pickWorker]);
  useEffect(() => {
    if (!pickRole) return;
    setProduct('market');
    setMode('roles');
    setSelected(pickRole.name);
    setQuery('');
  }, [pickRole]);
  useEffect(() => {
    if (!workersOn || !loadStaff) { setStaff([]); return; }
    void loadStaff(product).then((rows) => {
      setStaff(rows);
      setWorker((current) => (current && rows.some((r) => r.id === current) ? current : rows[0]?.id ?? null));
    }).catch(() => setStaff([]));
  }, [workersOn, loadStaff, product]);

  const groups = policy?.catalogue ?? [];
  const ent = policy?.entitlements;
  const sold = useMemo(() => {
    if (!ent || ent.unrestricted) return null;
    return new Set([...ent.allowed, ...ALWAYS_ON]);
  }, [ent]);
  const current = useMemo(() => roles.find((r) => r.name === selected) ?? null, [roles, selected]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('az');
    if (!q) return groups;
    return groups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((perm) => {
          const hay = `${group.label} ${perm.label} ${perm.hint ?? ''} ${perm.key}`.toLocaleLowerCase(
            'az',
          );
          return hay.includes(q);
        }),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, query]);

  const persistRoles = async (nextRoles: RolePolicyRole[], nextUsers?: RoleUser[]) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await save(withAlwaysOn(nextRoles), product, nextUsers);
      setPolicy((prev) => ({
        ...(prev ?? saved),
        ...saved,
        entitlements: prev?.entitlements,
        catalogue: prev?.catalogue,
        products: prev?.products,
      }));
      setStatus('Tətbiq olundu — kassalar qısa müddətdə yenilənir');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tətbiq olunmadı');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => {
    if (busy || ALWAYS_ON.has(key)) return;
    if (sold && !sold.has(key)) return;
    if (!selected) return;
    const nextRoles = roles.map((role) =>
      role.name !== selected
        ? role
        : {
            ...role,
            permissions: role.permissions.includes(key)
              ? role.permissions.filter((k) => k !== key)
              : [...role.permissions, key],
          },
    );
    setRoles(withAlwaysOn(nextRoles));
    void persistRoles(nextRoles);
  };

  const toggleGroup = (group: PermissionGroup) => {
    if (busy || !current || current.name === 'administrator') return;
    const keys = group.permissions
      .map((p) => p.key)
      .filter((key) => !ALWAYS_ON.has(key) && !(sold && !sold.has(key)));
    if (keys.length === 0) return;
    const allOn = keys.every((key) => current.permissions.includes(key));
    const nextRoles = roles.map((role) => {
      if (role.name !== selected) return role;
      const set = new Set(role.permissions);
      for (const key of keys) {
        if (allOn) set.delete(key);
        else set.add(key);
      }
      return { ...role, permissions: [...set] };
    });
    setRoles(withAlwaysOn(nextRoles));
    void persistRoles(nextRoles);
  };

  const groupState = (group: PermissionGroup) => {
    if (!current) return { on: false, partial: false };
    const keys = group.permissions.map((p) => p.key);
    const onCount = keys.filter(
      (key) => ALWAYS_ON.has(key) || current.permissions.includes(key),
    ).length;
    if (onCount === 0) return { on: false, partial: false };
    if (onCount === keys.length) return { on: true, partial: false };
    return { on: true, partial: true };
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const addRole = () => {
    const name = window.prompt('Yeni rolun adı')?.trim();
    if (!name) return;
    if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      setError('Bu adda rol artıq var');
      return;
    }
    const nextRoles = [...roles, { name, permissions: [] }];
    setRoles(nextRoles);
    setSelected(name);
    setError(null);
    void persistRoles(nextRoles);
  };

  const setSold = async (next: { unrestricted: boolean; allowed: string[] }) => {
    if (!saveEntitlements) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await saveEntitlements(next, product);
      await refresh();
      setStatus('Paket yeniləndi');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paket saxlanmadı');
    } finally {
      setBusy(false);
    }
  };

  if (!policy && !error) {
    return (
      <section className="card module-gates role-policy">
        <h2>İşçi rolları və səlahiyyətləri</h2>
        <p className="muted">Yüklənir…</p>
      </section>
    );
  }

  const allKeys = groups.flatMap((g) => g.permissions.map((p) => p.key));
  const lockedAdmin = Boolean(saveEntitlements);
  const products = policy?.products?.length ? policy.products : ([product] as PosProduct[]);
  const isAdminRole = current?.name === 'administrator';
  const isMarketManager = product === 'market' && current?.name === 'manager';

  return (
    <section className="card module-gates role-policy">
      <div className="section-heading">
        <div>
          <h2>İşçi rolları və səlahiyyətləri</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {subtitle ? `${subtitle} — ` : ''}
            Rol seçin, səlahiyyəti Açıq/Bağlı edin. Dəyişiklik dərhal tətbiq olunur.
            {busy ? ' · Saxlanır…' : ''}
          </p>
        </div>
      </div>

      {products.length > 1 ? (
        <div className="gate-surface-tabs" role="tablist" aria-label="POS növü">
          {products.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === product}
              className={key === product ? 'active' : ''}
              onClick={() => {
                setProduct(key);
                setStatus(null);
                setQuery('');
              }}
            >
              <span>{PRODUCT_LABEL[key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="ok-line" style={{ margin: 0 }}>
          {status}
        </p>
      ) : null}

      {ent ? (
        <div className="role-package">
          <div className="gate-row">
            <div className="gate-copy">
              <strong>Paket</strong>
              <p>
                {ent.unrestricted
                  ? 'Məhdudiyyətsiz — bütün imkanlar paylana bilər.'
                  : `${ent.allowed.length} / ${allKeys.length} imkan satılıb. Satılmayanlar bağlıdır.`}
              </p>
            </div>
            {saveEntitlements ? (
              <button type="button" className="btn ghost" onClick={() => setTier((v) => !v)}>
                {tier ? 'Bağla' : 'Paketi dəyiş'}
              </button>
            ) : null}
          </div>
          {tier && saveEntitlements ? (
            <div className="role-package-edit">
              <label className="role-package-check">
                <input
                  type="checkbox"
                  checked={ent.unrestricted}
                  onChange={(e) => void setSold({ unrestricted: e.target.checked, allowed: ent.allowed })}
                />
                <span>Məhdudiyyətsiz (hər şey açıqdır)</span>
              </label>
              {!ent.unrestricted ? (
                <div className="role-chip-row">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void setSold({ unrestricted: false, allowed: allKeys })}
                  >
                    Hamısını seç
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void setSold({ unrestricted: false, allowed: [] })}
                  >
                    Hamısını sil
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {workersOn ? (
        <div className="gate-surface-tabs" role="tablist" aria-label="Rol və ya işçi">
          <button type="button" role="tab" aria-selected={mode === 'roles'} className={mode === 'roles' ? 'active' : ''} onClick={() => setMode('roles')}><span>Rollar üzrə</span></button>
          <button type="button" role="tab" aria-selected={mode === 'workers'} className={mode === 'workers' ? 'active' : ''} onClick={() => setMode('workers')}><span>İşçilər üzrə</span><strong>{staff.length}</strong></button>
        </div>
      ) : null}

      {mode === 'workers' && workersOn ? (
        <WorkerRights
          staff={staff}
          worker={worker}
          setWorker={setWorker}
          roles={roles}
          users={users}
          groups={groups}
          sold={sold}
          busy={busy}
          onChange={(nextUsers) => { setUsers(nextUsers); void persistRoles(roles, nextUsers); }}
        />
      ) : <>
      <div className="gate-surface-tabs role-tabs" role="tablist" aria-label="Rollar">
        {roles.map((role) => (
          <button
            key={role.name}
            type="button"
            role="tab"
            aria-selected={role.name === selected}
            className={role.name === selected ? 'active' : ''}
            onClick={() => {
              setSelected(role.name);
              setQuery('');
            }}
          >
            <span>{roleLabel(role.name)}</span>
            <strong>{role.permissions.length}</strong>
          </button>
        ))}
        <button type="button" className="role-tab-add" onClick={addRole}>
          + Yeni rol
        </button>
      </div>

      {current ? (
        <div className="gate-section gate-section-active">
          <div className="gate-section-head">
            <h3 className="gate-section-title">{isMarketManager ? 'Müdür icazələri' : roleLabel(current.name)}</h3>
            {!isAdminRole ? (
              <label className="gate-search role-inline-search">
                <span className="sr-only">Axtarış</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Əməliyyatlar, alışlar, maaşlar…"
                  autoComplete="off"
                />
              </label>
            ) : null}
          </div>

          {isMarketManager ? (
            <p className="muted">Mağaza müdürünün kassada edə biləcəkləri. Bağlı olanlar Market POS-da gizlənir; dəyişiklik kassalara ~30 saniyəyə çatır.</p>
          ) : null}
          {isAdminRole ? (
            <p className="muted">{roleLabel(current.name)} həmişə bütün səlahiyyətlərə malikdir — dəyişdirilmir.</p>
          ) : groups.length === 0 ? (
            <p className="muted">Bu məhsul üçün səlahiyyət kataloqu gəlmədi.</p>
          ) : filteredGroups.length === 0 ? (
            <p className="muted">Axtarışa uyğun səlahiyyət yoxdur. Başqa söz yoxlayın.</p>
          ) : (
            <ul className="module-gate-list">
              {filteredGroups.map((group) => {
                const { on, partial } = groupState(group);
                const multi = group.permissions.length > 1;
                const open =
                  expanded.has(group.key) ||
                  (query.trim().length > 0 && multi) ||
                  !multi;
                const onCount = group.permissions.filter(
                  (p) => ALWAYS_ON.has(p.key) || current.permissions.includes(p.key),
                ).length;
                return (
                  <li
                    key={group.key}
                    className={`${on ? (partial ? 'is-partial' : 'is-on') : 'is-off'}${
                      open && multi ? ' is-open' : ''
                    }`}
                  >
                    <div className="gate-row">
                      <div className="gate-copy">
                        {multi ? (
                          <button
                            type="button"
                            className="gate-expand"
                            aria-expanded={open}
                            onClick={() => toggleExpand(group.key)}
                          >
                            <span className={`gate-chevron${open ? ' open' : ''}`} aria-hidden />
                            <strong>{group.label}</strong>
                          </button>
                        ) : (
                          <strong>{group.label}</strong>
                        )}
                        {multi ? (
                          <span className="gate-count">
                            {onCount}/{group.permissions.length} açıq
                            {partial ? ' — yalnız seçilmişlər' : ''}
                          </span>
                        ) : group.permissions[0]?.hint ? (
                          <p>{group.permissions[0].hint}</p>
                        ) : null}
                      </div>
                      <GateSwitch
                        on={on}
                        partial={partial}
                        disabled={isAdminRole || busy}
                        onClick={() => (multi ? toggleGroup(group) : toggle(group.permissions[0].key))}
                      />
                    </div>

                    {multi && open ? (
                      <ul className="gate-children">
                        {group.permissions.map((perm) => {
                          const essential = ALWAYS_ON.has(perm.key);
                          const locked = !essential && Boolean(sold && !sold.has(perm.key));
                          const childOn =
                            essential || (!locked && current.permissions.includes(perm.key));
                          return (
                            <li key={perm.key} className={childOn ? 'is-on' : 'is-off'}>
                              <div>
                                <strong>{perm.label}</strong>
                                {perm.hint ? <p>{perm.hint}</p> : null}
                                {essential ? (
                                  <span className="gate-count">Həmişə açıq</span>
                                ) : null}
                                {locked ? (
                                  <span className="gate-count">Paketlərə daxil deyil</span>
                                ) : null}
                                {locked && lockedAdmin ? (
                                  <button
                                    type="button"
                                    className="btn ghost gate-add-pkg"
                                    disabled={busy}
                                    onClick={() =>
                                      void setSold({
                                        unrestricted: false,
                                        allowed: [...(ent?.allowed ?? []), perm.key],
                                      })
                                    }
                                  >
                                    Paketə əlavə et
                                  </button>
                                ) : null}
                              </div>
                              <GateSwitch
                                on={childOn}
                                disabled={essential || locked || isAdminRole || busy}
                                onClick={() => toggle(perm.key)}
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
          )}
        </div>
      ) : (
        <p className="muted">Redaktə etmək üçün rol seçin.</p>
      )}
      </>}
    </section>
  );
}

/**
 * One worker's rights: each permission follows their role, or is allowed /
 * denied for this person only. Workers appear once a till has reported them.
 */
function WorkerRights({ staff, worker, setWorker, roles, users, groups, sold, busy, onChange }: {
  staff: StaffRow[]; worker: string | null; setWorker: (id: string) => void; roles: RolePolicyRole[]; users: RoleUser[];
  groups: PermissionGroup[]; sold: Set<string> | null; busy: boolean; onChange: (users: RoleUser[]) => void;
}) {
  const person = staff.find((s) => s.id === worker) ?? null;
  if (!staff.length) return <p className="muted">Bu müştərinin kassası hələ işçi siyahısını göndərməyib (Market POS 1.5.32+ açıq olduqda görünür).</p>;
  const row = users.find((u) => u.userId === worker) ?? { userId: worker ?? '', allow: [], deny: [] };
  const roleKeys = new Set(roles.find((r) => r.name === person?.role)?.permissions ?? []);
  const set = (key: string, state: 'role' | 'allow' | 'deny') => {
    if (!person) return;
    const next = { userId: person.id, name: person.name, allow: row.allow.filter((k) => k !== key), deny: row.deny.filter((k) => k !== key) };
    if (state === 'allow') next.allow.push(key);
    if (state === 'deny') next.deny.push(key);
    const rest = users.filter((u) => u.userId !== person.id);
    onChange(next.allow.length || next.deny.length ? [...rest, next] : rest);
  };
  return (
    <div className="gate-section gate-section-active">
      <div className="gate-surface-tabs role-tabs" role="tablist" aria-label="İşçilər">
        {staff.map((s) => {
          const own = users.find((u) => u.userId === s.id);
          return (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === worker} className={s.id === worker ? 'active' : ''} onClick={() => setWorker(s.id)}>
              <span>{s.name}{s.active ? '' : ' (passiv)'}</span>
              <strong>{roleLabel(s.role)}{own ? ` · ${own.allow.length + own.deny.length}` : ''}</strong>
            </button>
          );
        })}
      </div>
      {person ? (
        (
          <ul className="module-gate-list">
            {groups.map((group) => (
              <li key={group.key} className="is-open">
                <div className="gate-row"><div className="gate-copy"><strong>{group.label}</strong></div></div>
                <ul className="gate-children">
                  {group.permissions.map((perm) => {
                    const state = row.allow.includes(perm.key) ? 'allow' : row.deny.includes(perm.key) ? 'deny' : 'role';
                    const locked = Boolean(sold && !sold.has(perm.key));
                    const effective = state === 'allow' ? !locked : state === 'deny' ? false : roleKeys.has(perm.key);
                    return (
                      <li key={perm.key} className={effective ? 'is-on' : 'is-off'}>
                        <div>
                          <strong>{perm.label}</strong>
                          <span className="gate-count">{state === 'role' ? `Rol üzrə: ${roleKeys.has(perm.key) ? 'açıq' : 'bağlı'}` : state === 'allow' ? 'Bu işçiyə açıq' : 'Bu işçiyə bağlı'}{locked ? ' · paketdə yoxdur' : ''}</span>
                        </div>
                        <div className="role-chip-row" role="group" aria-label={perm.label}>
                          {(['role', 'allow', 'deny'] as const).map((option) => (
                            <button key={option} type="button" className={`btn ${state === option ? '' : 'ghost'}`} aria-pressed={state === option}
                              disabled={busy || (option === 'allow' && locked)} onClick={() => set(perm.key, option)}>
                              {option === 'role' ? 'Rol üzrə' : option === 'allow' ? 'Açıq' : 'Bağlı'}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

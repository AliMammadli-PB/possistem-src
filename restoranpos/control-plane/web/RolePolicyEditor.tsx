import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Staff roles — same catalog cards as ModuleGates (Açıq/Bağlı).
 * Simple: product tabs → role tabs → permission cards. Auto-save on toggle.
 */

export type RolePolicyRole = { name: string; permissions: string[] };
export type PermissionEntry = { key: string; label: string; hint?: string };
export type PermissionGroup = { key: string; label: string; permissions: PermissionEntry[] };

export type PosProduct = 'restaurant' | 'market';

export const PRODUCT_LABEL: Record<PosProduct, string> = {
  restaurant: 'Restoran POS',
  market: 'Market POS',
};

export type RolePolicy = {
  product?: PosProduct;
  products?: PosProduct[];
  roles: RolePolicyRole[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
  entitlements?: { unrestricted: boolean; allowed: string[]; updatedAt: string | null };
  catalogue?: PermissionGroup[];
};

type Props = {
  load: (product: PosProduct) => Promise<RolePolicy>;
  save: (roles: RolePolicyRole[], product: PosProduct) => Promise<RolePolicy>;
  saveEntitlements?: (
    input: { unrestricted: boolean; allowed: string[] },
    product: PosProduct,
  ) => Promise<unknown>;
  subtitle?: string;
};

const DEFAULT_ROLES = ['waiter', 'kitchen', 'cashier', 'supervisor', 'manager'];

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

export function RolePolicyEditor({ load, save, saveEntitlements, subtitle }: Props) {
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

  const refresh = useCallback(async () => {
    try {
      const next = await load(product);
      setPolicy(next);
      const seeded =
        next.roles.length > 0
          ? next.roles
          : DEFAULT_ROLES.map((name) => ({ name, permissions: [] }));
      setRoles(withAlwaysOn(seeded));
      setSelected((current) =>
        current && seeded.some((role) => role.name === current) ? current : seeded[0]?.name ?? null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Səlahiyyətlər yüklənmədi');
    }
  }, [load, product]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const persistRoles = async (nextRoles: RolePolicyRole[]) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await save(withAlwaysOn(nextRoles), product);
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
    if (ALWAYS_ON.has(key)) return;
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
    if (!current || current.name === 'administrator') return;
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
            <span>{role.name}</span>
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
            <h3 className="gate-section-title">{current.name}</h3>
            {!isAdminRole ? (
              <label className="gate-search role-inline-search">
                <span className="sr-only">Axtarış</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Anbar, kassa, hesabat…"
                  autoComplete="off"
                />
              </label>
            ) : null}
          </div>

          {isAdminRole ? (
            <p className="muted">Administrator həmişə bütün səlahiyyətlərə malikdir — dəyişdirilmir.</p>
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
                        disabled={isAdminRole}
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
                                disabled={essential || locked || isAdminRole}
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
    </section>
  );
}

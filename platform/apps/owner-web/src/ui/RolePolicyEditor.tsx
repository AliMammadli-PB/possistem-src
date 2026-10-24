import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Staff roles and permissions, edited on the website and applied on the till.
 *
 * Used twice with different plumbing: the customer's own portal passes its
 * customer-session calls, the admin panel passes the ones scoped to the
 * customer it has selected. The admin panel additionally gets the entitlement
 * editor - what POSSISTEM sold this customer - which the customer must never
 * see a write control for.
 *
 * The catalogue arrives with the policy rather than being bundled here: the two
 * tills check different permission vocabularies, and a list compiled into the
 * web app goes stale the moment a core adds a key.
 *
 * A customer can hold both tills, and the two do not share a vocabulary, so a
 * policy is per product. The switch appears only when there is something to
 * switch between - the server says which products this customer is licensed
 * for, rather than the screen offering a Market tab to a restaurant.
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
  /** Which products this customer holds a licence for. */
  products?: PosProduct[];
  roles: RolePolicyRole[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
  entitlements?: { unrestricted: boolean; allowed: string[]; updatedAt: string | null };
  catalogue?: PermissionGroup[];
};

type Props = {
  /** Each call is per product, because each product has its own policy. */
  load: (product: PosProduct) => Promise<RolePolicy>;
  save: (roles: RolePolicyRole[], product: PosProduct) => Promise<RolePolicy>;
  /** Present only in the admin panel: writing what the customer was sold. */
  saveEntitlements?: (
    input: { unrestricted: boolean; allowed: string[] },
    product: PosProduct,
  ) => Promise<unknown>;
  subtitle?: string;
};

const DEFAULT_ROLES = ['waiter', 'kitchen', 'cashier', 'supervisor', 'manager'];

export function RolePolicyEditor({ load, save, saveEntitlements, subtitle }: Props) {
  const [policy, setPolicy] = useState<RolePolicy | null>(null);
  const [roles, setRoles] = useState<RolePolicyRole[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState(false);
  const [product, setProduct] = useState<PosProduct>('restaurant');

  const refresh = useCallback(async () => {
    try {
      const next = await load(product);
      setPolicy(next);
      const seeded = next.roles.length > 0
        ? next.roles
        : DEFAULT_ROLES.map((name) => ({ name, permissions: [] }));
      setRoles(seeded);
      // Not `current ?? …`: the other product may not have a role by this name,
      // and a stale selection would show its permissions as an empty set.
      setSelected((current) =>
        current && seeded.some((role) => role.name === current) ? current : seeded[0]?.name ?? null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Səlahiyyətlər yüklənmədi');
    }
  }, [load, product]);

  useEffect(() => { void refresh(); }, [refresh]);

  const groups = policy?.catalogue ?? [];
  const ent = policy?.entitlements;
  const sold = useMemo(
    () => (ent && !ent.unrestricted ? new Set(ent.allowed) : null),
    [ent],
  );
  const current = useMemo(() => roles.find((r) => r.name === selected) ?? null, [roles, selected]);

  const toggle = (key: string) => {
    // A key that was not sold cannot be handed out. The server clamps anyway -
    // this only stops the customer being told "granted" and seeing nothing.
    if (sold && !sold.has(key)) return;
    setRoles((prev) => prev.map((role) => role.name !== selected ? role : {
      ...role,
      permissions: role.permissions.includes(key)
        ? role.permissions.filter((k) => k !== key)
        : [...role.permissions, key],
    }));
    setStatus(null);
  };

  const addRole = () => {
    const name = window.prompt('Yeni rolun adı')?.trim();
    if (!name) return;
    if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      setError('Bu adda rol artıq var');
      return;
    }
    setRoles((prev) => [...prev, { name, permissions: [] }]);
    setSelected(name);
    setError(null);
  };

  const onSave = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const saved = await save(roles, product);
      setPolicy((prev) => ({
        ...(prev ?? saved), ...saved,
        entitlements: prev?.entitlements, catalogue: prev?.catalogue, products: prev?.products,
      }));
      setStatus('Yadda saxlanıldı — kassalar 2 dəqiqə ərzində tətbiq edəcək');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yadda saxlanmadı');
    } finally { setBusy(false); }
  };

  const setSold = async (next: { unrestricted: boolean; allowed: string[] }) => {
    if (!saveEntitlements) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      await saveEntitlements(next, product);
      await refresh();
      setStatus('Paket yeniləndi');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paket saxlanmadı');
    } finally { setBusy(false); }
  };

  if (!policy && !error) return <p className="muted">Yüklənir…</p>;

  const allKeys = groups.flatMap((g) => g.permissions.map((p) => p.key));

  return (
    <section className="card" style={{ display: 'grid', gap: '1rem' }}>
      <header>
        <h2 style={{ margin: 0 }}>İşçi rolları və səlahiyyətləri</h2>
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
          {subtitle ? `${subtitle} — ` : ''}
          Rol seçin və hər səlahiyyəti açıb-bağlayın. Dəyişiklik kassalara özü gedir;
          işçi növbəti girişində qüvvəyə minir.
        </p>
        {policy?.updatedAt ? (
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85em' }}>
            Son dəyişiklik: {new Date(policy.updatedAt).toLocaleString('az-AZ')}
            {policy.updatedByKind === 'admin' ? ' · POSSISTEM dəstəyi tərəfindən' : ''}
            {policy.version ? ` · versiya ${policy.version}` : ''}
          </p>
        ) : null}
      </header>

      {(policy?.products?.length ?? 0) > 1 ? (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {policy!.products!.map((key) => (
            <button key={key} type="button" onClick={() => { setProduct(key); setStatus(null); }}
              aria-pressed={key === product}
              className={key === product ? 'button' : 'button ghost'}>
              {PRODUCT_LABEL[key]}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p role="alert" style={{ color: 'crimson', margin: 0 }}>{error}</p> : null}
      {status ? <p role="status" style={{ color: 'seagreen', margin: 0 }}>{status}</p> : null}

      {/* What POSSISTEM sold. Read-only for the customer, editable for us. */}
      {ent ? (
        <div style={{ border: '1px solid #e4e8ef', borderRadius: 10, padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <strong style={{ fontSize: '0.95em' }}>Paket</strong>
              <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85em' }}>
                {ent.unrestricted
                  ? 'Məhdudiyyətsiz — bu müştəri bütün imkanları paylaya bilər.'
                  : `${ent.allowed.length} / ${allKeys.length} imkan satılıb. Satılmayanlar aşağıda sönük görünür.`}
              </p>
            </div>
            {saveEntitlements ? (
              <button type="button" className="button ghost" onClick={() => setTier((v) => !v)}>
                {tier ? 'Bağla' : 'Paketi dəyiş'}
              </button>
            ) : null}
          </div>

          {tier && saveEntitlements ? (
            <div style={{ marginTop: '0.85rem', display: 'grid', gap: '0.6rem' }}>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ent.unrestricted}
                  onChange={(e) => void setSold({ unrestricted: e.target.checked, allowed: ent.allowed })}
                />
                <span>Məhdudiyyətsiz (hər şey açıqdır)</span>
              </label>
              {!ent.unrestricted ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="button ghost" disabled={busy}
                    onClick={() => void setSold({ unrestricted: false, allowed: allKeys })}>
                    Hamısını seç
                  </button>
                  <button type="button" className="button ghost" disabled={busy}
                    onClick={() => void setSold({ unrestricted: false, allowed: [] })}>
                    Hamısını sil
                  </button>
                  <span className="muted" style={{ fontSize: '0.85em', alignSelf: 'center' }}>
                    Tək-tək dəyişmək üçün aşağıdakı siyahıdan «paketə əlavə et» işarəsini basın.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {roles.map((role) => (
          <button key={role.name} type="button" onClick={() => setSelected(role.name)}
            aria-pressed={role.name === selected}
            className={role.name === selected ? 'button' : 'button ghost'}>
            {role.name}
            <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.85em' }}>
              ({role.permissions.length})
            </span>
          </button>
        ))}
        <button type="button" className="button ghost" onClick={addRole}>+ Yeni rol</button>
      </div>

      {current ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <strong>{current.name}</strong>
          {current.name === 'administrator' ? (
            <p className="muted">
              Administrator həmişə bütün səlahiyyətlərə malikdir — bu, səhvi geri qaytarmağın
              yeganə yoludur, ona görə dəyişdirilmir.
            </p>
          ) : groups.length === 0 ? (
            <p className="muted">Bu məhsul üçün səlahiyyət kataloqu gəlmədi.</p>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <p className="muted" style={{ margin: '0 0 0.25rem', textTransform: 'uppercase', fontSize: '0.75em' }}>
                  {group.label}
                </p>
                <div style={{ display: 'grid', gap: '0.25rem', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {group.permissions.map((perm) => {
                    const locked = Boolean(sold && !sold.has(perm.key));
                    return (
                      <label key={perm.key}
                        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', opacity: locked ? 0.45 : 1 }}
                        title={locked ? 'Bu imkan bu müştəriyə satılmayıb' : undefined}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={current.permissions.includes(perm.key)}
                          onChange={() => toggle(perm.key)}
                        />
                        <span>
                          <span style={{ display: 'block' }}>{perm.label}</span>
                          {perm.hint ? (
                            <span className="muted" style={{ display: 'block', fontSize: '0.8em' }}>{perm.hint}</span>
                          ) : null}
                          {locked && saveEntitlements ? (
                            <button type="button" className="button ghost" disabled={busy}
                              style={{ marginTop: '0.2rem', fontSize: '0.75em', padding: '0.1rem 0.4rem' }}
                              onClick={() => void setSold({
                                unrestricted: false,
                                allowed: [...(ent?.allowed ?? []), perm.key],
                              })}>
                              Paketə əlavə et
                            </button>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="muted">Redaktə etmək üçün rol seçin.</p>
      )}

      <div>
        <button type="button" className="button" disabled={busy} onClick={() => void onSave()}>
          {busy ? 'Yadda saxlanılır…' : 'Yadda saxla'}
        </button>
      </div>
    </section>
  );
}

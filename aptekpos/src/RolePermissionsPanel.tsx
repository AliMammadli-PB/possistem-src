import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { marketCoreClient } from './core/client';

type Catalogue = Record<string, { permission: string; label: string }[]>;
type RoleRow = { role: string; label: string; custom: boolean; permissions: string[] };

const GROUP_LABELS: Record<string, string> = {
  satis: 'Satış',
  kassa: 'Kassa',
  menyu: 'Menyu və məhsul',
  anbar: 'Anbar və stok',
  hesabat: 'Hesabatlar',
  sistem: 'Sistem',
  other: 'Digər',
};

/**
 * Which role may do what, edited in the app.
 *
 * Roles were three names baked into the seed and a grant could only be changed
 * by editing SQL, so "let this cashier refund" had no answer inside the product.
 *
 * The manager is deliberately not editable: the core restores its full grant on
 * every save, so a mistake made here can always be undone.
 */
export function RolePermissionsPanel({ actorRole }: { actorRole: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [cat, list] = await Promise.all([
        marketCoreClient.auth.permissionCatalogue(),
        marketCoreClient.auth.roles(),
      ]);
      setCatalogue(cat.groups ?? {});
      setRoles(list.roles ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!catalogue) return null;

  const manager = selected?.role === 'manager';

  const open = (role: RoleRow | null) => {
    setSelected(role);
    setName(role?.role ?? '');
    setLabel(role?.label ?? '');
    setDraft(role ? [...role.permissions] : []);
  };

  const toggle = (permission: string) =>
    setDraft((prev) =>
      prev.includes(permission) ? prev.filter((k) => k !== permission) : [...prev, permission],
    );

  const save = async () => {
    if (!name.trim()) {
      setError('Rol adı tələb olunur');
      return;
    }
    setBusy(true);
    try {
      await marketCoreClient.auth.saveRole(name.trim(), label.trim() || name.trim(), draft);
      setSelected(null);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (role: RoleRow) => {
    setBusy(true);
    try {
      await marketCoreClient.auth.deleteRole(role.role);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Only a role that may manage roles sees the editor; everyone else sees the
  // list, which is useful on its own ("what can a cashier do here?").
  const mayEdit = actorRole === 'manager';

  return (
    <section className="module-page role-permissions">
      <section className="page-intro">
        <div>
          <p>SƏLAHİYYƏTLƏR</p>
          <h2>Rollar və səlahiyyətlər</h2>
          <span>Rol seçin və hər səlahiyyəti açıb-bağlayın.</span>
        </div>
        <ShieldCheck />
      </section>

      {error && <p className="danger">{error}</p>}

      <div className="role-chips">
        {roles.map((role) => (
          <button
            key={role.role}
            type="button"
            className={selected?.role === role.role ? 'primary-action' : ''}
            onClick={() => open(role)}
          >
            {role.label || role.role}
            <small> ({role.permissions.length})</small>
          </button>
        ))}
        {mayEdit && (
          <button type="button" onClick={() => open(null)}>
            + Yeni rol
          </button>
        )}
      </div>

      {(selected || name) && (
        <div className="role-editor">
          <label>
            <span>Rol açarı</span>
            <input
              value={name}
              disabled={Boolean(selected) || !mayEdit}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span>Görünən ad</span>
            <input value={label} disabled={!mayEdit} onChange={(e) => setLabel(e.target.value)} />
          </label>

          {manager && (
            <p>
              Müdir həmişə bütün səlahiyyətlərə malikdir — bu, burada edilən səhvi geri
              qaytarmağın yeganə yoludur.
            </p>
          )}

          {Object.keys(catalogue)
            .sort()
            .map((group) => (
              <div key={group} className="role-group">
                <h4>{GROUP_LABELS[group] ?? group}</h4>
                {catalogue[group]!.map((perm) => (
                  <label key={perm.permission} className="role-permission">
                    <input
                      type="checkbox"
                      disabled={manager || !mayEdit}
                      checked={manager || draft.includes(perm.permission)}
                      onChange={() => toggle(perm.permission)}
                    />
                    <span>{perm.label || perm.permission}</span>
                  </label>
                ))}
              </div>
            ))}

          {mayEdit && (
            <div className="role-actions">
              <button
                type="button"
                className="primary-action"
                disabled={busy || manager}
                onClick={() => void save()}
              >
                {busy ? 'Saxlanılır…' : 'Saxla'}
              </button>
              <button type="button" onClick={() => { setSelected(null); setName(''); }}>
                Bağla
              </button>
              {selected?.custom && (
                <button type="button" className="danger" disabled={busy} onClick={() => void remove(selected)}>
                  Rolu sil
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

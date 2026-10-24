import { useLiveEffect } from '../lib/live';
import { FormEvent, useCallback,  useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';

type Reseller = {
  id: string;
  slug: string;
  name: string;
  email: string;
  phone: string | null;
  quota: number;
  used: number;
  remaining: number;
  active: boolean;
  createdAt: string;
  panelPath: string;
};

/** Bayiye verilecek tam link — kopyalanıp WhatsApp'tan gönderilebilsin diye mutlak. */
function panelUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

export function AdminPanelsPage() {
  const t = useI18n();
  const [rows, setRows] = useState<Reseller[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Yeni yaradılan panelin təhvil məlumatı — parol yalnız burada görünür. */
  const [created, setCreated] = useState<{ row: Reseller; password: string } | null>(null);
  const [copiedNew, setCopiedNew] = useState<'link' | 'all' | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [quota, setQuota] = useState('10');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Reseller[]>('/resellers')
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t.common.error));
  }, [t.common.error]);

  useLiveEffect(load, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setNotice(null);
    setCreated(null);
    setCopiedNew(null);
    try {
      const row = await api<Reseller>('/resellers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug: slug.trim().toLowerCase(),
          email,
          password,
          phone: phone || null,
          keyQuota: Math.max(0, Number(quota) || 0),
        }),
      });
      setCreated({ row, password });
      setName('');
      setSlug('');
      setEmail('');
      setPassword('');
      setPhone('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await api(`/resellers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (message) setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  };

  const onAddQuota = (row: Reseller) => {
    const raw = window.prompt(t.admins.addQuotaPrompt, '10');
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount < 1) return;
    void patch(row.id, { addQuota: amount });
  };

  const onResetPassword = (row: Reseller) => {
    const raw = window.prompt(`${row.name} — ${t.admins.resetPasswordPrompt}`);
    if (raw === null) return;
    if (raw.length < 8) {
      setError(t.admins.resetPasswordPrompt);
      return;
    }
    void patch(row.id, { password: raw }, t.admins.passwordReset);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.admins.title}</h1>
        </div>
      </header>
      <p className="muted" style={{ marginBottom: '1.2rem' }}>
        {t.admins.hint}
      </p>

      <div className="split">
        <section className="card">
          <h2>{t.admins.create}</h2>
          <form className="form-grid" onSubmit={(e) => void onCreate(e)}>
          <label>
            {t.admins.name}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {t.admins.slug}
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
              placeholder="mehmet-ticaret"
            />
          </label>
          <label>
            {t.admins.email}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label>
            {t.admins.password}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label>
            {t.admins.phone}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            {t.admins.quota}
            <input
              type="number"
              min={0}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              required
            />
          </label>
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? t.loading : t.admins.submit}
            </button>
          </form>
        </section>

        {created ? (
          <section className="card success-box">
            <h2>{t.admins.created}</h2>
            <p className="muted">{t.admins.createdHint}</p>
            <dl className="kv">
              <dt>{t.admins.colName}</dt>
              <dd>{created.row.name}</dd>
              <dt>{t.admins.panelLink}</dt>
              <dd>
                <a
                  className="link-value mono"
                  href={panelUrl(created.row.panelPath)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {panelUrl(created.row.panelPath)}
                </a>
              </dd>
              <dt>{t.admins.loginEmail}</dt>
              <dd className="mono">{created.row.email}</dd>
              <dt>{t.admins.loginPassword}</dt>
              <dd className="mono key-value">{created.password}</dd>
              <dt>{t.admins.colQuota}</dt>
              <dd className="mono">{created.row.quota}</dd>
            </dl>
            <p className="muted">{t.admins.passwordOnce}</p>
            <div className="download-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const text = [
                    created.row.name,
                    `${t.admins.panelLink}: ${panelUrl(created.row.panelPath)}`,
                    `${t.admins.loginEmail}: ${created.row.email}`,
                    `${t.admins.loginPassword}: ${created.password}`,
                    `${t.admins.colQuota}: ${created.row.quota}`,
                  ].join('\n');
                  void navigator.clipboard.writeText(text).then(() => setCopiedNew('all'));
                }}
              >
                {copiedNew === 'all' ? t.admins.copied : t.admins.copyAll}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(panelUrl(created.row.panelPath))
                    .then(() => setCopiedNew('link'));
                }}
              >
                {copiedNew === 'link' ? t.admins.copied : t.admins.copyLink}
              </button>
            </div>
          </section>
        ) : (
          <section className="card placeholder-card">
            <h2>{t.admins.waiting}</h2>
            <p className="muted">{t.admins.waitingHint}</p>
          </section>
        )}
      </div>

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
      {notice && <p className="notice" style={{ marginTop: '1rem' }}>{notice}</p>}

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <h2>{t.nav.admins}</h2>
        {rows && rows.length === 0 && (
          <p className="muted" style={{ marginTop: '.8rem' }}>
            {t.admins.empty}
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.admins.colName}</th>
                  <th>{t.admins.colLink}</th>
                  <th>{t.admins.colQuota}</th>
                  <th>{t.admins.colUsed}</th>
                  <th>{t.admins.colRemaining}</th>
                  <th>{t.admins.colStatus}</th>
                  <th>{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      <br />
                      <small className="muted mono">{r.email}</small>
                    </td>
                    <td>
                      <a
                        className="link-value mono"
                        href={panelUrl(r.panelPath)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {panelUrl(r.panelPath)}
                      </a>
                    </td>
                    <td className="mono">{r.quota}</td>
                    <td className="mono">{r.used}</td>
                    <td className="mono">{r.remaining}</td>
                    <td>{r.active ? t.admins.active : t.admins.passive}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(panelUrl(r.panelPath))
                              .then(() => setCopiedId(r.id));
                          }}
                        >
                          {copiedId === r.id ? t.admins.copied : t.admins.copyLink}
                        </button>
                        <button type="button" className="btn" onClick={() => onAddQuota(r)}>
                          {t.admins.addQuota}
                        </button>
                        <button type="button" className="btn" onClick={() => onResetPassword(r)}>
                          {t.admins.resetPassword}
                        </button>
                        <button
                          type="button"
                          className={r.active ? 'btn danger' : 'btn'}
                          onClick={() => void patch(r.id, { active: !r.active })}
                        >
                          {r.active ? t.admins.disable : t.admins.enable}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

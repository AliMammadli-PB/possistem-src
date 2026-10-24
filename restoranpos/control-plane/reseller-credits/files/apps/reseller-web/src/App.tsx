import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import * as api from './api';

/**
 * Bayi satış paneli.
 *
 * Bayi yeni müştəri + açar yaradır, öz müştərilərini görür və uzadır, kredit
 * tarixçəsinə baxır. Kredit = ay: bir satış ən çox 12 ay, hər ay 1 kredit;
 * krediti yalnız POSSISTEM verir. Silmə / redaktə bilərəkdən yoxdur.
 */

function LoginScreen() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [panelName, setPanelName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .panelInfo(slug)
      .then((info) => {
        if (alive) setPanelName(info.name);
      })
      .catch(() => {
        if (alive) setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.login(slug, email, password);
      api.setToken(data.token, data.expiresAt, slug);
      navigate(`/${slug}/panel`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi');
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>Panel tapılmadı</h1>
          <p className="muted">Bu link etibarsızdır və ya panel dayandırılıb.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="brand-block">
          <div className="brand-name">POSSISTEM</div>
          <div className="brand-sub">Satış paneli</div>
        </div>
        <h1>{panelName ?? '…'}</h1>
        <label>
          E-poçt
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </label>
        <label>
          Parol
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy || !panelName}>
          {busy ? 'Yoxlanılır…' : 'Daxil ol'}
        </button>
      </form>
    </div>
  );
}

type SaleResult = {
  customer: { name: string; email: string };
  term: string;
  expiresAt: string;
  activationKey: string;
};

function NewSaleForm({
  profile,
  onCreated,
}: {
  profile: api.ResellerMe;
  onCreated: (quota: api.Quota | null) => void;
}) {
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [voen, setVoen] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');
  const [term, setTerm] = useState<api.Term>(1);
  const [product, setProduct] = useState<api.Product>('restaurant');
  const [maxDevices, setMaxDevices] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [copied, setCopied] = useState(false);

  const trialsLeft = Math.max(0, profile.trialLimit - profile.trialsUsed);
  const affordable = (t: (typeof api.TERMS)[number]) =>
    t.value === 'trial7' ? trialsLeft > 0 : t.credits <= profile.remaining;
  const locked = !api.TERMS.some(affordable);
  const chosen = api.TERMS.find((t) => t.value === term) ?? api.TERMS[1]!;
  // Qalıq azalanda seçilmiş müddət artıq ödənilə bilmirsə, ödənilə bilənə keç.
  useEffect(() => {
    if (!affordable(chosen)) {
      const next = api.TERMS.find(affordable);
      if (next) setTerm(next.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.remaining, trialsLeft]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const data = await api.createSale({
        name,
        email,
        password,
        address,
        phone: phone || null,
        voen: voen || null,
        contactPerson: contactPerson || null,
        notes: notes || null,
        term,
        maxDevices: Math.min(profile.maxDevices, Math.max(1, Number(maxDevices) || 1)),
        product,
      });
      setResult({ ...data, term: chosen.label });
      onCreated(data.quota);
      setName('');
      setContactPerson('');
      setPhone('');
      setAddress('');
      setVoen('');
      setEmail('');
      setPassword('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2>Yeni müştəri və açar</h2>
        <p className="muted">
          Müştəri üçün giriş məlumatı və aktivasiya açarı bir addımda yaradılır.
        </p>
        {locked && (
          <p className="error" role="alert">
            Kredit bitib — yeni satış üçün POSSISTEM-dən kredit alın.
          </p>
        )}
        <form className="form-grid" onSubmit={(e) => void onSubmit(e)}>
          <p className="form-section">Müştəri</p>
          <label className="span-2">
            Restoran / müştəri adı
            <input value={name} onChange={(e) => setName(e.target.value)} required disabled={locked} />
          </label>
          <label>
            <span>Əlaqədar şəxs <span className="opt">istəyə bağlı</span></span>
            <input
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="Ad, Soyad"
              disabled={locked}
            />
          </label>
          <label>
            <span>Telefon <span className="opt">istəyə bağlı</span></span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+994 50 000 00 00"
              disabled={locked}
            />
          </label>
          <label className="span-2">
            Ünvan
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Şəhər, küçə, bina"
              required
              disabled={locked}
            />
          </label>
          <label>
            <span>VÖEN <span className="opt">istəyə bağlı</span></span>
            <input
              value={voen}
              onChange={(e) => setVoen(e.target.value)}
              inputMode="numeric"
              maxLength={20}
              placeholder="1234567890"
              disabled={locked}
            />
          </label>

          <p className="form-section">POS girişi</p>
          <label>
            E-poçt
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
              disabled={locked}
            />
          </label>
          <label>
            Parol
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={locked}
            />
          </label>

          <p className="form-section">Lisenziya</p>
          <label>
            Proqram
            <select value={product} onChange={(e) => setProduct(e.target.value as api.Product)} disabled={locked}>
              <option value="restaurant">Restoran POS</option>
              <option value="market">Market POS</option>
            </select>
          </label>
          <label>
            Müddət
            <select
              value={String(term)}
              onChange={(e) => setTerm(e.target.value === 'trial7' ? 'trial7' : (Number(e.target.value) as api.Term))}
              disabled={locked}
            >
              {api.TERMS.map((t) => (
                <option key={String(t.value)} value={String(t.value)} disabled={!affordable(t)}>
                  {t.label} — {t.value === 'trial7' ? `pulsuz (bu ay ${trialsLeft} qalıb)` : `${t.credits} kredit`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Maksimum cihaz <span className="opt">ən çox {profile.maxDevices}</span></span>
            <input
              type="number"
              min={1}
              max={profile.maxDevices}
              value={maxDevices}
              onChange={(e) => setMaxDevices(e.target.value)}
              disabled={locked}
            />
          </label>
          <p className="muted span-2 cost-line">
            Bu satış <b>{chosen.credits}</b> kredit silir · qalıq {profile.remaining} → {profile.remaining - chosen.credits}
          </p>
          <label className="span-2">
            <span>Qeyd <span className="opt">istəyə bağlı</span></span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Kassa sayı, avadanlıq, razılaşma şərtləri…"
              disabled={locked}
            />
          </label>

          {error && (
            <p className="error span-2" role="alert">
              {error}
            </p>
          )}
          <div className="span-2">
            <button type="submit" className="btn primary" disabled={busy || locked}>
              {busy ? 'Yaradılır…' : 'Yarat'}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="card success-box">
          <h2>Açar yaradıldı</h2>
          <p className="muted">Bu açar yalnız bir dəfə göstərilir — indi kopyalayın.</p>
          <dl className="kv">
            <dt>Müştəri</dt>
            <dd>{result.customer.name}</dd>
            <dt>E-poçt</dt>
            <dd>{result.customer.email}</dd>
            <dt>Müddət</dt>
            <dd>
              {result.term} · {api.formatDate(result.expiresAt)} tarixinədək
            </dd>
            <dt>Açar</dt>
            <dd className="mono key-value">{result.activationKey}</dd>
          </dl>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(result.activationKey).then(() => setCopied(true));
            }}
          >
            {copied ? 'Kopyalandı ✓' : 'Açarı kopyala'}
          </button>
        </section>
      )}
    </>
  );
}

function SetupCard() {
  const [info, setInfo] = useState<api.SetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .setup()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : 'Əlçatan deyil'));
  }, []);

  return (
    <section className="card">
      <h2>Quraşdırıcı</h2>
      <p className="muted">Müştəriyə veriləcək Windows quraşdırıcısı.</p>
      {error && <p className="error">{error}</p>}
      {info && (
        <>
          <dl className="kv">
            <dt>Versiya</dt>
            <dd className="mono">{info.version}</dd>
            <dt>Ölçü</dt>
            <dd>{api.formatBytes(info.sizeBytes)}</dd>
            <dt>Fayl</dt>
            <dd className="mono">{info.fileName}</dd>
          </dl>
          <a className="btn primary" href={info.downloadUrl} download={info.fileName}>
            Quraşdırıcını yüklə
          </a>
        </>
      )}
    </section>
  );
}

function RenewCell({
  row,
  remaining,
  onRenewed,
}: {
  row: api.Sale;
  remaining: number;
  onRenewed: (quota: api.Quota | null) => void;
}) {
  const [term, setTerm] = useState<1 | 3 | 6 | 12>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!row.licenseId || row.status === 'revoked' || row.status === 'suspended') return <>—</>;
  const licenseId = row.licenseId;

  const renew = async () => {
    const t = api.RENEW_TERMS.find((x) => x.value === term)!;
    const ok = window.confirm(
      `${row.name}: lisenziya ${t.label} uzadılacaq.\n${t.credits} kredit silinəcək (qalıq ${remaining} → ${remaining - t.credits}).`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.renew(licenseId, term);
      onRenewed(res.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="renew-cell">
      <select value={term} onChange={(e) => setTerm(Number(e.target.value) as 1 | 3 | 6 | 12)} disabled={busy} aria-label="Uzatma müddəti">
        {api.RENEW_TERMS.map((t) => (
          <option key={t.value} value={t.value} disabled={t.credits > remaining}>
            {t.label} · {t.credits} kr.
          </option>
        ))}
      </select>
      <button type="button" className="btn" disabled={busy || remaining < term} onClick={() => void renew()}>
        {busy ? '…' : 'Uzat'}
      </button>
      {error && <small className="error-inline">{error}</small>}
    </div>
  );
}

function SalesTable({
  remaining,
  onRenewed,
}: {
  remaining: number;
  onRenewed: (quota: api.Quota | null) => void;
}) {
  const [rows, setRows] = useState<api.Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .sales()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Xəta baş verdi'));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="card">
      <h2>Mənim satışlarım</h2>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Hələ satış yoxdur.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Müştəri</th>
                <th>E-poçt</th>
                <th>Ünvan</th>
                <th>Proqram / müddət</th>
                <th>Bitmə tarixi</th>
                <th>Durum</th>
                <th>Cihaz</th>
                <th>Tarix</th>
                <th>Uzat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.customerId}>
                  <td>
                    {r.name}
                    {(r.contactPerson || r.phone) && (
                      <>
                        <br />
                        <small className="muted">
                          {[r.contactPerson, r.phone].filter(Boolean).join(' · ')}
                        </small>
                      </>
                    )}
                    {r.voen && (
                      <>
                        <br />
                        <small className="muted mono">VÖEN {r.voen}</small>
                      </>
                    )}
                  </td>
                  <td className="mono">{r.email ?? '—'}</td>
                  <td className="wrap-cell">{r.address ?? '—'}</td>
                  <td>
                    {r.product === 'market' ? 'Market POS' : 'Restoran POS'}
                    <br />
                    <small className="muted">{r.isTrial ? 'Sınaq' : r.plan ?? '—'}</small>
                  </td>
                  <td>
                    {api.formatDate(r.validUntil)}
                    {r.status === 'active' && (api.daysLeft(r.validUntil) ?? 99) <= 7 && (
                      <>
                        <br />
                        <span className="badge-warn">{api.daysLeft(r.validUntil)} gün qalıb</span>
                      </>
                    )}
                  </td>
                  <td className={r.status === 'expired' ? 'status-expired' : undefined}>{api.statusLabel(r.status)}</td>
                  <td className="mono">
                    {r.redeemCount ?? 0}/{r.maxDevices ?? 0}
                  </td>
                  <td>{api.formatDate(r.createdAt)}</td>
                  <td>
                    <RenewCell
                      row={r}
                      remaining={remaining}
                      onRenewed={(quota) => {
                        onRenewed(quota);
                        load();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LedgerCard() {
  const [rows, setRows] = useState<api.LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .ledger()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Xəta baş verdi'));
  }, []);

  return (
    <section className="card">
      <h2>Kredit tarixçəsi</h2>
      <p className="muted">Alınan, satışa və uzatmaya xərclənən, geri qaytarılan kreditlər.</p>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Hələ hərəkət yoxdur.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarix</th>
                <th>Əməliyyat</th>
                <th>Müştəri</th>
                <th>Kredit</th>
                <th>Qeyd</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{api.formatDate(r.createdAt)}</td>
                  <td>
                    {api.LEDGER_REASON[r.reason] ?? r.reason}
                    {r.reason === 'sale' && r.months === 0 ? ' (sınaq)' : ''}
                  </td>
                  <td>{r.customerName ?? '—'}</td>
                  <td className={r.delta < 0 ? 'mono delta-neg' : 'mono delta-pos'}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="wrap-cell">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PanelScreen() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<api.ResellerMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Yeni satıştan sonra listeyi tazelemek için.
  const [salesKey, setSalesKey] = useState(0);

  const signOut = useCallback(() => {
    void api.logout().finally(() => navigate(`/${slug}`, { replace: true }));
  }, [navigate, slug]);

  useEffect(() => {
    void api
      .me()
      .then(setProfile)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Xəta baş verdi');
        navigate(`/${slug}`, { replace: true });
      });
  }, [navigate, slug]);

  if (error) return <div className="auth-page muted">{error}</div>;
  if (!profile) return <div className="auth-page muted">Yüklənir…</div>;

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <div className="brand-sub">Satış paneli</div>
          <h1>{profile.name}</h1>
        </div>
        <button type="button" className="btn ghost" onClick={signOut}>
          Çıxış
        </button>
      </header>

      <section className="quota-row">
        <div className="stat">
          <span className="stat-label">Alınan kredit (ay)</span>
          <span className="stat-value">{profile.quota}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Xərclənib</span>
          <span className="stat-value">{profile.used}</span>
        </div>
        <div className={profile.remaining > 0 ? 'stat' : 'stat stat-warn'}>
          <span className="stat-label">Qalıq kredit</span>
          <span className="stat-value">{profile.remaining}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sınaq (bu ay)</span>
          <span className="stat-value">
            {profile.trialsUsed}/{profile.trialLimit}
          </span>
        </div>
      </section>
      <p className="muted credit-note">
        1 kredit = 1 ay lisenziya. Satış və uzatma ən çox 12 ay ola bilər; kredit yalnız POSSISTEM-dən alınır.
      </p>

      <NewSaleForm
        profile={profile}
        onCreated={(quota) => {
          // Sınaq sayı da dəyişə bilər — profili serverdən yenilə.
          if (quota) setProfile((p) => (p ? { ...p, ...quota } : p));
          void api.me().then(setProfile).catch(() => undefined);
          setSalesKey((k) => k + 1);
        }}
      />

      <SalesTable
        key={salesKey}
        remaining={profile.remaining}
        onRenewed={(quota) => {
          if (quota) setProfile((p) => (p ? { ...p, ...quota } : p));
          setSalesKey((k) => k + 1);
        }}
      />
      <LedgerCard key={`ledger-${salesKey}`} />
      <SetupCard />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { slug = '' } = useParams();
  // Token başka bir panelin linkinde geçerli sayılmaz.
  if (!api.getToken() || api.getTokenSlug() !== slug) {
    return <Navigate to={`/${slug}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/:slug" element={<LoginScreen />} />
      <Route
        path="/:slug/panel"
        element={
          <RequireAuth>
            <PanelScreen />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <div className="auth-page">
            <div className="card auth-card">
              <h1>Panel linki lazımdır</h1>
              <p className="muted">
                Sizə verilən tam linki açın: <span className="mono">/pos/bayi/&lt;panel&gt;</span>
              </p>
            </div>
          </div>
        }
      />
    </Routes>
  );
}

import { useLiveEffect } from '../lib/live';
import { FormEvent,  useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';

type AndroidRelease = { versionName: string; apkUrl: string; sizeBytes: number; releaseNotes?: string; publishedAt?: string };

/** The Admin APK is linked only here, behind the panel login; the public site no longer lists it. */
function AndroidAppCard() {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [failed, setFailed] = useState(false);

  useLiveEffect(() => {
    void fetch('/downloads/android/admin/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<AndroidRelease>) : Promise.reject(new Error(String(r.status)))))
      .then((next) => { setRelease(next); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);

  return (
    <section className="card android-app-card" style={{ marginTop: '1.2rem' }}>
      <h2>Android tətbiqi</h2>
      <p className="muted">
        POSSİSTEM Admin — bu paneli telefondan idarə etmək üçün. Android 8 və yuxarı.
        {release ? ` Son versiya: ${release.versionName} · ${(release.sizeBytes / 1048576).toFixed(1)} MB` : failed ? ' Versiya məlumatı alınmadı.' : ''}
      </p>
      {release?.releaseNotes ? <p className="muted">{release.releaseNotes}</p> : null}
      <div className="actions">
        <a className="btn primary" href={release?.apkUrl ?? '#'} aria-disabled={!release} download>
          APK-nı yüklə
        </a>
      </div>
      <p className="muted">
        Quraşdırarkən Android “naməlum mənbə” icazəsi istəyə bilər. Samsung telefonlarda əvvəlcə
        Ayarlar → Təhlükəsizlik və məxfilik → Avtomatik bloklayıcı (Auto Blocker) müvəqqəti söndürülməlidir.
      </p>
    </section>
  );
}

/** POSSISTEM PIN: 10 digits that sign into every customer's Market POS as full manager. */
function SuperadminPinCard() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<{ set: boolean; updatedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLiveEffect(() => {
    void api<{ set: boolean; updatedAt: string | null }>('/admin/superadmin-pin')
      .then(setState)
      .catch(() => setState(null));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!/^\d{10}$/.test(pin)) return setError('PIN düz 10 rəqəm olmalıdır');
    if (pin !== confirm) return setError('PIN-lər eyni deyil');
    setBusy(true);
    try {
      const next = await api<{ set: boolean; updatedAt: string | null }>('/admin/superadmin-pin', {
        method: 'PUT',
        body: JSON.stringify({ pin, confirm }),
      });
      setState(next);
      setPin('');
      setConfirm('');
      setMessage('PIN saxlanıldı — kassalar ~30 saniyəyə yeniləyir');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'PIN saxlanmadı');
    } finally {
      setBusy(false);
    }
  };

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 10);

  return (
    <section className="card" style={{ marginTop: '1.2rem' }}>
      <h2>POSSISTEM PIN</h2>
      <p className="muted">
        10 rəqəmli PIN bütün müştərilərin Market POS-una tam müdür kimi girir. Serverdə yalnız hash saxlanılır.
        {' '}
        {state ? (state.set ? `Təyin edilib${state.updatedAt ? ` · ${new Date(state.updatedAt).toLocaleString('az')}` : ''}` : 'Hələ təyin edilməyib.') : ''}
      </p>
      <form className="form-grid" onSubmit={(e) => void onSubmit(e)} autoComplete="off">
        <label>
          Yeni PIN
          <input type="password" inputMode="numeric" autoComplete="new-password" value={pin}
            onChange={(e) => setPin(digits(e.target.value))} minLength={10} maxLength={10} required />
        </label>
        <label>
          PIN təkrar
          <input type="password" inputMode="numeric" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(digits(e.target.value))} minLength={10} maxLength={10} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="ok-line" role="status">{message}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saxlanır…' : state?.set ? 'PIN-i dəyiş' : 'PIN təyin et'}
        </button>
      </form>
    </section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const t = useI18n();
  const [url, setUrl] = useState('');
  const [chatCooldown, setChatCooldown] = useState(10);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [chatSaved, setChatSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  useLiveEffect(() => {
    void api<{ url: string }>('/settings/payment-url')
      .then((data) => setUrl(data.url))
      .catch(() => setUrl(''));
    void api<{ minutes: number }>('/settings/public-chat-cooldown')
      .then((data) => setChatCooldown(data.minutes))
      .catch(() => setChatCooldown(10));
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/settings/payment-url', { method: 'PATCH', body: JSON.stringify({ url }) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  };

  const onSaveChatCooldown = async (e: FormEvent) => {
    e.preventDefault();
    setChatBusy(true);
    setChatError(null);
    setChatSaved(false);
    try {
      await api('/settings/public-chat-cooldown', {
        method: 'PATCH',
        body: JSON.stringify({ minutes: chatCooldown }),
      });
      setChatSaved(true);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.settings.title}</h1>
        </div>
      </header>

      <section className="card">
        <h2>{t.settings.account}</h2>
        <dl className="kv">
          <dt>{t.settings.email}</dt>
          <dd className="mono">{user?.email}</dd>
          <dt>{t.settings.role}</dt>
          <dd className="mono">{user?.role}</dd>
        </dl>
        <Link className="btn" to="/change-password">
          {t.settings.changePassword}
        </Link>
      </section>

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <h2>{t.settings.paymentUrl}</h2>
        <p className="muted">{t.settings.paymentUrlHint}</p>
        <form className="form-grid" onSubmit={(e) => void onSave(e)}>
          <label>
            URL
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
              }}
              required
              placeholder="https://possistem.az/#elaqe"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t.loading : saved ? t.settings.saved : t.settings.save}
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <h2>{t.settings.chatCooldown}</h2>
        <p className="muted">{t.settings.chatCooldownHint}</p>
        <form className="form-grid" onSubmit={(e) => void onSaveChatCooldown(e)}>
          <label>
            {t.settings.chatCooldownMinutes}
            <input
              type="number"
              min={1}
              max={1440}
              value={chatCooldown}
              onChange={(e) => {
                setChatCooldown(Number(e.target.value));
                setChatSaved(false);
              }}
              required
            />
          </label>
          {chatError && (
            <p className="error" role="alert">
              {chatError}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={chatBusy}>
            {chatBusy ? t.loading : chatSaved ? t.settings.saved : t.settings.save}
          </button>
        </form>
      </section>

      <AndroidAppCard />
      {user?.role === 'superadmin' ? <SuperadminPinCard /> : null}
    </div>
  );
}

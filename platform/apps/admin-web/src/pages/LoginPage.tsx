import { useEffect, useState, type FormEvent } from 'react';
import { inAndroidApp, savedLogin, tellApp } from '../lib/android-app';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import brandLogo from '../assets/possistem-logo.png';

export function LoginPage() {
  const { login, insecureTransport } = useAuth();
  const navigate = useNavigate();
  const t = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const app = inAndroidApp();

  async function signIn(loginEmail: string, loginPassword: string, saved: boolean) {
    setBusy(true);
    setError(null);
    try {
      const user = await login(loginEmail, loginPassword);
      if (app && !saved) tellApp(remember ? { type: 'save-login', email: loginEmail, password: loginPassword } : { type: 'clear-login' });
      navigate(user.mustChangePassword ? '/change-password' : '/');
    } catch (err) {
      // A rejected saved login (changed password, disabled account) must not retry on every launch.
      if (saved && err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        tellApp({ type: 'clear-login' });
        setPassword('');
      }
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    void savedLogin().then((saved) => {
      if (!active || !saved) return;
      setEmail(saved.email);
      setPassword(saved.password);
      void signIn(saved.email, saved.password, true);
    });
    return () => { active = false; };
    // Runs once per visit to the login screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) void signIn(email, password, false);
  }

  return (
    <div className="auth-page">
      {insecureTransport && (
        <div className="banner-insecure" role="alert">
          {t.insecure}
        </div>
      )}
      <div className="auth-brand">
        <a href="/" aria-label="possistem ana səhifə">
          <img className="auth-logo" src={brandLogo} alt="possistem" />
        </a>
        <p className="auth-wordmark">{t.brand}</p>
        <p className="auth-tagline">{t.brandTagline}</p>
        <span className="auth-rule" />
        <h1>{t.login.title}</h1>
        <p>Mərkəzi sistemi təhlükəsiz idarə edin.</p>
      </div>
      <form className="auth-card" onSubmit={(e) => void onSubmit(e)}>
        <p className="eyebrow">{t.brandSub}</p>
        <h2>Xoş gəlmisiniz</h2>
        {error && <div className="error">{error}</div>}
        <label>
          {t.login.email}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          {t.login.password}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {app && (
          <label className="auth-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Bu telefonda yadda saxla və avtomatik daxil ol
          </label>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t.loading : t.login.submit}
        </button>
        <p className="auth-footnote">Yalnız səlahiyyətli əməkdaşlar üçün</p>
      </form>
    </div>
  );
}

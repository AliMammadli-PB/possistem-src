import { Suspense, lazy, useEffect, type FormEvent, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { PublicOnly, RequireAuth, useAuth } from './auth/AuthContext';
import { Checkbox, Field, PasswordField } from './ui/forms';
import { Alert, Button, Skeleton } from './ui/primitives';
const portalLogo = `${import.meta.env.BASE_URL}possistem-logo.png`;

const ChatPage = lazy(() => import('./pages/ChatPage'));

function Boot() {
  return (
    <main className="boot-screen" aria-busy="true" aria-label="Yüklənir">
      <img className="boot-mark" src={portalLogo} alt="" width={56} height={56} />
      <div className="boot-progress" />
      <p>Chat hazırlanır…</p>
    </main>
  );
}

function ChatOnly({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

function ChatLoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email')?.trim() ?? '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Chat girişi · possistem';
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await auth.signIn(email.trim(), password, rememberMe);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daxil olmaq mümkün olmadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="chat-login">
      <section className="chat-login-card">
        <a className="chat-login-brand" href="/" aria-label="Possistem ana səhifə">
          <img className="chat-mr-logo" src={portalLogo} alt="" width={52} height={52} />
        </a>
        <p className="eyebrow">possistem Chat</p>
        <h1 tabIndex={-1}>Restoran botuna daxil olun</h1>
        <p className="chat-login-copy">
          Yalnız chat — X/Z hesabat, masalar və digər əmrlər. Ana səhifəyə əlavə etmək üçün bu
          səhifəni paylaşın.
        </p>
        {error ? (
          <Alert tone="danger" title="Giriş alınmadı">
            {error}
          </Alert>
        ) : null}
        <form className="auth-form" onSubmit={submit} noValidate>
          <Field
            label="E-poçt"
            type="email"
            inputMode="email"
            autoComplete="username"
            prefixIcon="mail"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="ad@restoran.az"
          />
          <PasswordField
            label="Şifrə"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            placeholder="Şifrənizi yazın"
          />
          <Checkbox
            label="Məni xatırla"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          <Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">
            Chatə daxil ol
          </Button>
        </form>
      </section>
    </main>
  );
}

function StandaloneChat() {
  const auth = useAuth();
  useEffect(() => {
    document.title = 'Chat · possistem';
    document.documentElement.classList.add('chat-standalone');
    return () => document.documentElement.classList.remove('chat-standalone');
  }, []);

  return (
    <div className="chat-standalone-shell">
      <header className="chat-standalone-bar">
        <a className="chat-standalone-bar-brand" href="/" aria-label="Possistem ana səhifə" style={{textDecoration:'none',color:'inherit'}}>
          <img className="chat-mr-logo" src={portalLogo} alt="possistem" width={38} height={38} />
          <div>
            <strong>possistem Chat</strong>
            <small>{auth.customer?.name || 'Restoran botu'}</small>
          </div>
        </a>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon="logout"
          onClick={() => void auth.signOut()}
        >
          Çıxış
        </Button>
      </header>
      <Suspense
        fallback={
          <div className="chat-page chat-page-standalone">
            <Skeleton width="40%" height={24} />
            <Skeleton width="100%" height={320} />
          </div>
        }
      >
        <ChatPage standalone />
      </Suspense>
    </div>
  );
}

export default function ChatStandaloneApp() {
  return (
    <Suspense fallback={<Boot />}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <ChatLoginPage />
            </PublicOnly>
          }
        />
        <Route
          path="/"
          element={
            <ChatOnly>
              <StandaloneChat />
            </ChatOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

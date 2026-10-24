import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, forgotPassword, isMarketPortal, resetPassword, checkEmail, sendOtp } from '../api';
import * as api from '../api';
import { useAuth } from '../auth/AuthContext';
import { Checkbox, Field, PasswordField } from '../ui/forms';
import { Icon } from '../ui/Icon';
import { Alert, Button, LinkButton, SuccessState } from '../ui/primitives';

function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const market = isMarketPortal;
  return (
    <main className="auth-shell">
      <a className="skip-link" href="#auth-form">Formaya keç</a>
      <section className="auth-product" aria-label="possistem haqqında">
        <a className="auth-brand" href="https://possistem.az/">
          <img
            src={`${import.meta.env.BASE_URL}possistem-logo.png`}
            alt="possistem"
            width={40}
            height={40}
          />
          <strong>possistem</strong>
        </a>
        <div className="auth-product-copy">
          {market ? (
            <>
              <h1>Market kassası və stok.</h1>
              <p>Məhsul, anbar qalığı və kassa hesabatları bu paneldədir. Restoran botu və masa zalı yoxdur.</p>
              <ul>
                <li><Icon name="table" size={19} /><span><strong>Stok</strong><small>Kassada görünən qalığı artırın</small></span></li>
                <li><Icon name="wifi" size={19} /><span><strong>Kassa</strong><small>Onlayn kassaya 2-3 saniyəyə düşür</small></span></li>
                <li><Icon name="file" size={19} /><span><strong>X / Z</strong><small>Hesabatı printerdən çıxarın</small></span></li>
              </ul>
            </>
          ) : (
            <>
              <h1>Kassanızdan gələn vəziyyət, bir baxışda.</h1>
              <p>Quraşdırma, bağlantı, versiya və canlı restoran göstəricilərini vahid portalda idarə edin.</p>
              <ul>
                <li><Icon name="wifi" size={19} /><span><strong>Canlı bağlantı</strong><small>POS vəziyyəti və son sinxron vaxtı</small></span></li>
                <li><Icon name="setup" size={19} /><span><strong>Addım-addım quraşdırma</strong><small>Yükləmədən server təsdiqinə qədər</small></span></li>
                <li><Icon name="shield" size={19} /><span><strong>Təhlükəsiz hesab</strong><small>HttpOnly sessiya və qorunan məlumatlar</small></span></li>
              </ul>
            </>
          )}
        </div>
        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview-head"><span /><span>{market ? 'Market stok' : 'Əməliyyat vəziyyəti'}</span><i /></div>
          <div className="auth-preview-grid">
            {market ? (
              <>
                <div><small>Kassa</small><strong>Onlayn</strong><span className="preview-line success" /></div>
                <div><small>Stok</small><strong>Satış zalı</strong><span className="preview-line info" /></div>
                <div><small>Hesabat</small><strong>X / Z</strong><span className="preview-line neutral" /></div>
              </>
            ) : (
              <>
                <div><small>POS bağlantısı</small><strong>Onlayn</strong><span className="preview-line success" /></div>
                <div><small>Quraşdırma</small><strong>Tamamlanıb</strong><span className="preview-line info" /></div>
                <div><small>Versiya</small><strong>Aktualdır</strong><span className="preview-line neutral" /></div>
              </>
            )}
          </div>
        </div>
      </section>
      <section className="auth-panel" id="auth-form">
        <div className="auth-panel-inner">
          {eyebrow && !market ? <span className="auth-eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
          <p className="auth-description">{description}</p>
          {children}
        </div>
        <footer>
          <span>© {new Date().getFullYear()} possistem</span>
          <a href="https://possistem.az/#elaqe">Dəstək</a>
        </footer>
      </section>
    </main>
  );
}

function safeNext(value: string | null, fallback: string) {
  if (!value) return fallback;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value, 'https://possistem.az');
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'possistem.az') return fallback;
    if (url.pathname === '/' || url.pathname === '') return fallback;
    // BASE_URL is "/pos/app/" for the portal build and "/marketpos/" for the
    // market owner panel; strip whichever mount this bundle is served from.
    const mount = import.meta.env.BASE_URL.replace(/\/$/, '');
    if (url.pathname === mount || url.pathname === `${mount}/`) return '/';
    if (url.pathname.startsWith(`${mount}/`)) {
      const rest = url.pathname.slice(mount.length) || '/';
      return `${rest}${url.search}${url.hash}`;
    }
  } catch {
    // fall through
  }
  return fallback;
}

function emailFromParams(params: URLSearchParams): string {
  const direct = params.get('email')?.trim();
  if (direct) return direct;
  const next = params.get('next');
  if (!next) return '';
  try {
    return new URL(next, 'https://possistem.az').searchParams.get('email')?.trim() ?? '';
  } catch {
    return '';
  }
}

const REMEMBER_EMAIL_KEY = 'possistem_remember_email';

function loadRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistRememberedEmail(email: string, remember: boolean) {
  try {
    if (remember && email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState(() => emailFromParams(params) || loadRememberedEmail());
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await auth.signIn(email.trim(), password, rememberMe);
      persistRememberedEmail(email.trim(), rememberMe);
      navigate(safeNext(params.get('next'), result.redirectTo || '/'), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daxil olmaq mümkün olmadı.');
    } finally {
      setBusy(false);
    }
  };

  const sendLoginOtp = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const result = await api.sendOtp(email.trim(), 'login');
      setOtpSent(true);
      setInfo(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kod göndərilmədi.');
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.loginWithOtp(email.trim(), otpCode.trim(), rememberMe);
      persistRememberedEmail(email.trim(), rememberMe);
      await auth.refresh();
      navigate(safeNext(params.get('next'), result.redirectTo || '/'), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kod ilə giriş alınmadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Müştəri girişi"
      title="Yenidən xoş gəlmisiniz"
      description="Biznes hesabınıza daxil olun və sistem vəziyyətini izləyin."
    >
      <div className="auth-mode-tabs" role="tablist" aria-label="Giriş növü">
        <button type="button" role="tab" aria-selected={mode === 'password'} className={mode === 'password' ? 'active' : ''} onClick={() => setMode('password')}>Şifrə ilə</button>
        <button type="button" role="tab" aria-selected={mode === 'otp'} className={mode === 'otp' ? 'active' : ''} onClick={() => setMode('otp')}>Kod ilə</button>
      </div>
      {error ? <Alert tone="danger" title="Giriş alınmadı">{error}</Alert> : null}
      {info ? <Alert tone="info" title="Kod göndərildi">{info}</Alert> : null}
      {mode === 'password' ? (
        <form className="auth-form" onSubmit={submitPassword} noValidate>
          <Field label="E-poçt" type="email" inputMode="email" autoComplete="username" prefixIcon="mail" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="ad@biznes.az" />
          <PasswordField label="Şifrə" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Şifrənizi yazın" />
          <div className="auth-form-row">
            <Checkbox label="Məni xatırla" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            <Link to="/forgot-password">Şifrəni unutmusunuz?</Link>
          </div>
          <Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">Daxil olun</Button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitOtp} noValidate>
          <Field label="E-poçt" type="email" inputMode="email" autoComplete="username" prefixIcon="mail" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="ad@biznes.az" />
          {!otpSent ? (
            <Button type="button" variant="secondary" loading={busy} onClick={() => void sendLoginOtp()}>6 rəqəmli kod göndər</Button>
          ) : (
            <>
              <Field label="Təsdiq kodu" inputMode="numeric" autoComplete="one-time-code" prefixIcon="shield" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required placeholder="000000" hint="E-poçtunuza gələn 6 rəqəmli kod" />
              <div className="auth-form-row">
                <Checkbox label="Məni xatırla" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <button type="button" className="text-link" onClick={() => void sendLoginOtp()}>Kodu yenidən göndər</button>
              </div>
              <Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">Kod ilə daxil ol</Button>
            </>
          )}
        </form>
      )}
      <p className="auth-switch">Müştəri hesabını administrator yaradır. Sizə verilmiş hesabla daxil olun.</p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [values, setValues] = useState({
    name: '',
    businessName: '',
    email: '',
    password: '',
    confirmation: '',
    termsAccepted: false,
  });
  const [otpCode, setOtpCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [info, setInfo] = useState('');

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (values.name.trim().length < 2) nextErrors.name = 'Ad və soyadı qeyd edin.';
    if (values.businessName.trim().length < 2) nextErrors.businessName = 'Biznes adını qeyd edin.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) nextErrors.email = 'Düzgün e-poçt yazın.';
    if (values.password.length < 12) nextErrors.password = 'Şifrə ən azı 12 simvol olmalıdır.';
    if (values.password !== values.confirmation) nextErrors.confirmation = 'Şifrələr eyni deyil.';
    if (!values.termsAccepted) nextErrors.terms = 'Şərtləri qəbul etmək lazımdır.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateForm()) return;
    setBusy(true);
    setFormError('');
    setInfo('');
    try {
      const check = await checkEmail(values.email.trim());
      if (check.exists) {
        setFormError('Bu e-poçtla hesab artıq mövcuddur. Daxil olun.');
        return;
      }
      const result = await sendOtp(values.email.trim(), 'register');
      setInfo(result.message);
      setStep('otp');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Kod göndərilmədi.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (otpCode.length !== 6) {
      setFormError('6 rəqəmli kodu yazın.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const result = await auth.signUp({
        name: values.name.trim(),
        businessName: values.businessName.trim(),
        email: values.email.trim(),
        password: values.password,
        termsAccepted: values.termsAccepted,
        otpCode: otpCode.trim(),
      });
      navigate(result.redirectTo || '/onboarding/welcome', { replace: true });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Hesab yaradıla bilmədi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Yeni müştəri"
      title="Müştəri hesabı yaradın"
      description="E-poçtunuza kod göndərilir. Kodu təsdiqlədikdən sonra hesab aktiv olur."
    >
      {formError ? <Alert tone="danger" title="Hesab yaradılmadı">{formError}</Alert> : null}
      {info ? <Alert tone="info" title="Kod göndərildi">{info}</Alert> : null}
      {step === 'form' ? (
        <form className="auth-form" onSubmit={requestOtp} noValidate>
          <div className="form-grid">
            <Field label="Ad və soyad" autoComplete="name" prefixIcon="user" value={values.name} onChange={(event) => set('name', event.target.value)} error={errors.name} required />
            <Field label="Biznesin adı" autoComplete="organization" prefixIcon="building" value={values.businessName} onChange={(event) => set('businessName', event.target.value)} error={errors.businessName} required />
          </div>
          <Field label="E-poçt" type="email" inputMode="email" autoComplete="email" prefixIcon="mail" value={values.email} onChange={(event) => set('email', event.target.value)} error={errors.email} required />
          <PasswordField label="Şifrə" autoComplete="new-password" value={values.password} onChange={(event) => set('password', event.target.value)} error={errors.password} hint="Ən azı 12 simvol." required />
          <PasswordField label="Şifrəni təkrar yazın" autoComplete="new-password" value={values.confirmation} onChange={(event) => set('confirmation', event.target.value)} error={errors.confirmation} required />
          <Checkbox label="İstifadə şərtlərini və məlumatların işlənməsini qəbul edirəm." checked={values.termsAccepted} onChange={(event) => set('termsAccepted', event.target.checked)} error={errors.terms} />
          <Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">Kod göndər</Button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <Field label="Təsdiq kodu" inputMode="numeric" autoComplete="one-time-code" prefixIcon="shield" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required placeholder="000000" hint={`${values.email} ünvanına göndərildi`} />
          <Button type="button" variant="secondary" loading={busy} onClick={() => void sendOtp(values.email.trim(), 'register').then((r) => setInfo(r.message)).catch((e) => setFormError(e instanceof Error ? e.message : 'Kod göndərilmədi.'))}>Kodu yenidən göndər</Button>
          <Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">Hesabı tamamla</Button>
          <button type="button" className="text-link" onClick={() => setStep('form')}>Məlumatları dəyiş</button>
        </form>
      )}
      <p className="auth-switch">Artıq hesabınız var? <Link to="/login">Daxil olun</Link></p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<{ exists: boolean; message: string } | null>(null);
  const [sent, setSent] = useState<'reset' | 'otp' | null>(null);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setChecked(null);
    try {
      setChecked({exists:true,message:'Hesab mövcuddursa, seçdiyiniz bərpa üsulu ilə təlimat göndəriləcək.'});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yoxlama alınmadı.');
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    setBusy(true);
    setError('');
    try {
      await forgotPassword(email.trim());
      setSent('reset');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sorğu göndərilmədi.');
    } finally {
      setBusy(false);
    }
  };

  const sendLoginCode = async () => {
    setBusy(true);
    setError('');
    try {
      await sendOtp(email.trim(), 'login');
      setSent('otp');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kod göndərilmədi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell eyebrow="Şifrə bərpası" title="Girişinizi bərpa edin" description="Əvvəlcə e-poçtunuzu yoxlayın. Hesab varsa, şifrəni dəyişə və ya kod ilə daxil ola bilərsiniz.">
      {sent === 'reset' ? (
        <SuccessState
          title="E-poçtunuzu yoxlayın"
          description="Hesab mövcuddursa, şifrə yeniləmə keçidi göndərildi. Spam qovluğunu da yoxlayın."
          action={<LinkButton to="/login" variant="primary">Girişə qayıdın</LinkButton>}
        />
      ) : sent === 'otp' ? (
        <SuccessState
          title="Giriş kodu göndərildi"
          description="6 rəqəmli kod e-poçtunuza göndərildi. Kod ilə daxil olmaq üçün giriş səhifəsinə keçin."
          action={<LinkButton to={`/login?email=${encodeURIComponent(email.trim())}`} variant="primary">Kod ilə daxil ol</LinkButton>}
        />
      ) : (
        <>
          {error ? <Alert tone="danger" title="Sorğu tamamlanmadı">{error}</Alert> : null}
          {!checked ? (
            <form className="auth-form" onSubmit={check}>
              <Field label="Hesab e-poçtu" type="email" inputMode="email" autoComplete="email" prefixIcon="mail" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <Button type="submit" variant="primary" loading={busy}>E-poçtu yoxla</Button>
            </form>
          ) : checked.exists ? (
            <div className="auth-form">
              <Alert tone="info" title="Girişin bərpası">{checked.message}</Alert>
              <Button type="button" variant="primary" loading={busy} onClick={() => void sendReset()}>Şifrəmi dəyiş (keçid göndər)</Button>
              <Button type="button" variant="secondary" loading={busy} onClick={() => void sendLoginCode()}>Giriş kodu göndər</Button>
              <Button type="button" variant="ghost" onClick={() => navigate('/login')}>Şifrəmlə daxil ol</Button>
            </div>
          ) : (
            <SuccessState
              title="Hesab tapılmadı"
              description={checked.message}
              action={<LinkButton to="/register" variant="primary">Yeni hesab yaradın</LinkButton>}
            />
          )}
          <p className="auth-switch"><Link to="/login">Girişə qayıdın</Link></p>
        </>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) {
      setError('Yeni şifrə ən azı 12 simvol olmalıdır.');
      return;
    }
    if (password !== confirmation) {
      setError('Şifrələr eyni deyil.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await resetPassword(token, password);
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Şifrə yenilənmədi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell eyebrow="Yeni şifrə" title="Hesabınızı qoruyun" description="Əvvəl istifadə etmədiyiniz uzun və təhlükəsiz şifrə yaradın.">
      {!token ? (
        <Alert tone="danger" title="Keçid düzgün deyil">E-poçtdakı tam yeniləmə keçidini açın.</Alert>
      ) : complete ? (
        <SuccessState
          title="Şifrə yeniləndi"
          description="Bütün əvvəlki portal sessiyaları bağlandı. Yeni şifrənizlə daxil olun."
          action={<Button variant="primary" onClick={() => navigate('/login', { replace: true })}>Daxil olun</Button>}
        />
      ) : (
        <>
          {error ? <Alert tone="danger" title="Şifrə yenilənmədi">{error}</Alert> : null}
          <form className="auth-form" onSubmit={submit}>
            <PasswordField label="Yeni şifrə" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="Ən azı 12 simvol." required />
            <PasswordField label="Yeni şifrəni təkrar yazın" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            <Button type="submit" variant="primary" loading={busy}>Şifrəni yeniləyin</Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

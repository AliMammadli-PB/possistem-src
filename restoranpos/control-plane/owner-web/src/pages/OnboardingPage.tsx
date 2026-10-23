import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiError,
  completeOnboarding,
  formatBytes,
  getOnboarding,
  recordSetupDownload,
  saveOnboardingProgress,
  saveProfile,
  verifySetup,
  type OnboardingPayload,
} from '../api';
import { useAuth } from '../auth/AuthContext';
import { Checkbox, Field } from '../ui/forms';
import { Icon, type IconName } from '../ui/Icon';
import { Alert, Badge, Button, ErrorState, LinkButton, ProgressBar, Skeleton, SuccessState } from '../ui/primitives';
import { useToast } from '../ui/overlays';

const steps = [
  { number: 1, slug: 'welcome', title: 'Xoş gəlmisiniz', short: 'Başlanğıc', icon: 'home' as IconName },
  { number: 2, slug: 'business', title: 'Biznes məlumatları', short: 'Biznes', icon: 'building' as IconName },
  { number: 3, slug: 'license', title: 'Lisenziya vəziyyəti', short: 'Lisenziya', icon: 'key' as IconName },
  { number: 4, slug: 'download', title: 'Tətbiqi yükləyin', short: 'Yükləmə', icon: 'download' as IconName },
  { number: 5, slug: 'install', title: 'Quraşdırın', short: 'Quraşdırma', icon: 'windows' as IconName },
  { number: 6, slug: 'verify', title: 'Bağlantını yoxlayın', short: 'Yoxlama', icon: 'wifi' as IconName },
  { number: 7, slug: 'complete', title: 'Hazırdır', short: 'Tamamla', icon: 'check' as IconName },
];

export default function OnboardingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const { show } = useToast();
  const slug = location.pathname.split('/').filter(Boolean).at(-1) || 'welcome';
  const active = steps.find((step) => step.slug === slug);
  const [data, setData] = useState<OnboardingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getOnboarding());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Quraşdırma məlumatı yüklənmədi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  if (!active) return <Navigate to="/onboarding/welcome" replace />;
  if (loading) return <OnboardingSkeleton />;
  if (error || !data) {
    return (
      <ErrorState
        title="Quraşdırma açılmadı"
        description={error || 'Məlumatı əldə edə bilmədik.'}
        action={<Button icon="refresh" onClick={() => void reload()}>Yenidən yoxla</Button>}
      />
    );
  }

  const completed = new Set(data.onboarding.completedSteps);
  const go = (step: number) => navigate(`/onboarding/${steps[step - 1]?.slug || 'welcome'}`);
  const markAndGo = async (completedStep: number, nextStep: number) => {
    setBusy(true);
    try {
      const response = await saveOnboardingProgress(completedStep);
      setData((current) => current ? { ...current, onboarding: response.onboarding } : current);
      go(nextStep);
    } catch (cause) {
      show({ tone: 'danger', title: 'Addım saxlanılmadı', message: cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-sidebar">
        <a className="onboarding-brand" href="/" aria-label="Possistem ana səhifə">
          <img
            src={`${import.meta.env.BASE_URL}possistem-logo.png`}
            alt="possistem"
            width={40}
            height={40}
          />
          <strong>Possistem</strong>
        </a>
        <div className="onboarding-progress-mobile">
          <div><span>Quraşdırma</span><strong>{active.number} / 7</strong></div>
          <ProgressBar value={Math.round((completed.size / 7) * 100)} label="Quraşdırma tərəqqisi" />
        </div>
        <ol className="stepper">
          {steps.map((step) => {
            const done = completed.has(step.number) || (step.number === 7 && Boolean(data.onboarding.completedAt));
            const current = step.number === active.number;
            const available = step.number <= Math.max(data.onboarding.currentStep, active.number) || done;
            return (
              <li key={step.slug} className={`${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                <button type="button" disabled={!available} onClick={() => go(step.number)} aria-current={current ? 'step' : undefined}>
                  <span className="step-marker">{done ? <Icon name="check" size={16} /> : step.number}</span>
                  <span><strong>{step.short}</strong><small>{step.title}</small></span>
                </button>
              </li>
            );
          })}
        </ol>
        <Link className="onboarding-exit" to="/"><Icon name="chevron-left" size={17} /> Ana səhifəyə qayıt</Link>
      </aside>

      <main className="onboarding-main">
        <header className="onboarding-head">
          <span className="page-eyebrow">Addım {active.number} / 7</span>
          <h1>{active.title}</h1>
        </header>
        <div className="onboarding-content">
          {active.number === 1 ? (
            <WelcomeStep onNext={() => void markAndGo(1, 2)} busy={busy} />
          ) : active.number === 2 ? (
            <BusinessStep
              data={data}
              busy={busy}
              onBack={() => go(1)}
              onSaved={(nextData) => {
                setData(nextData);
                go(3);
              }}
              setBusy={setBusy}
            />
          ) : active.number === 3 ? (
            <LicenseStep data={data} busy={busy} onBack={() => go(2)} onNext={() => void markAndGo(3, 4)} />
          ) : active.number === 4 ? (
            <DownloadStep
              data={data}
              busy={busy}
              onBack={() => go(3)}
              onDownloaded={(next) => {
                setData((current) => current ? { ...current, onboarding: next } : current);
                go(5);
              }}
              setBusy={setBusy}
            />
          ) : active.number === 5 ? (
            <InstallStep busy={busy} onBack={() => go(4)} onNext={() => void markAndGo(5, 6)} />
          ) : active.number === 6 ? (
            <VerifyStep
              data={data}
              busy={busy}
              onBack={() => go(5)}
              setBusy={setBusy}
              onVerified={(next) => {
                setData((current) => current ? { ...current, onboarding: next } : current);
                go(7);
              }}
            />
          ) : (
            <CompleteStep
              data={data}
              busy={busy}
              onBack={() => go(6)}
              setBusy={setBusy}
              onComplete={async () => {
                await auth.refresh();
                navigate('/', { replace: true });
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function StepActions({
  onBack,
  primary,
  secondary,
}: {
  onBack?: () => void;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="step-actions">
      <div>{onBack ? <Button type="button" variant="ghost" icon="chevron-left" onClick={onBack}>Geri</Button> : null}{secondary}</div>
      <div>{primary}</div>
    </div>
  );
}

function WelcomeStep({ onNext, busy }: { onNext: () => void; busy: boolean }) {
  return (
    <>
      <div className="onboarding-hero-visual" aria-hidden="true">
        <div className="visual-monitor"><span /><div><i /><i /><i /></div><strong /></div>
        <div className="visual-status"><Icon name="check" size={18} /><span><strong>İdarə olunan quraşdırma</strong><small>Hər addımda nə etməli olduğunuzu görəcəksiniz</small></span></div>
      </div>
      <div className="onboarding-copy">
        <h2>Texniki bilik tələb olunmur</h2>
        <p>Biznes məlumatlarından başlayıb Windows tətbiqinin serverdə görünməsinə qədər bütün prosesi birlikdə keçəcəyik.</p>
        <div className="expectation-grid">
          <div><Icon name="clock" size={20} /><span><strong>Qısa və aydın</strong><small>Tamamlanan addımlar yadda saxlanılır</small></span></div>
          <div><Icon name="shield" size={20} /><span><strong>Etibarlı yoxlama</strong><small>Bağlantını server özü təsdiqləyir</small></span></div>
          <div><Icon name="help" size={20} /><span><strong>Dəstək həmişə var</strong><small>Xəta zamanı retry və kömək yolu</small></span></div>
        </div>
      </div>
      <StepActions primary={<Button variant="primary" iconAfter="arrow-right" loading={busy} onClick={onNext}>Başlayaq</Button>} />
    </>
  );
}

function BusinessStep({
  data,
  busy,
  onBack,
  onSaved,
  setBusy,
}: {
  data: OnboardingPayload;
  busy: boolean;
  onBack: () => void;
  onSaved: (data: OnboardingPayload) => void;
  setBusy: (busy: boolean) => void;
}) {
  const [values, setValues] = useState({
    businessName: data.customer.name || '',
    contactPerson: data.customer.contactPerson || '',
    phone: data.customer.phone || '',
    address: data.customer.address || '',
    voen: data.customer.voen || '',
    notifyEmail: data.customer.notifyEmail || data.customer.email,
  });
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveProfile(values);
      const refreshed = await getOnboarding();
      onSaved(refreshed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Məlumatlar saxlanılmadı.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="onboarding-form" onSubmit={submit}>
      <p>Bu məlumatlar hesab, quraşdırma və vacib bildirişlər üçün istifadə olunur.</p>
      {error ? <Alert tone="danger" title="Məlumatlar saxlanılmadı">{error}</Alert> : null}
      <div className="form-grid">
        <Field label="Biznesin adı" prefixIcon="building" value={values.businessName} onChange={(event) => set('businessName', event.target.value)} required />
        <Field label="Əlaqədar şəxs" prefixIcon="user" autoComplete="name" value={values.contactPerson} onChange={(event) => set('contactPerson', event.target.value)} required />
        <Field label="Telefon" prefixIcon="phone" type="tel" inputMode="tel" autoComplete="tel" value={values.phone} onChange={(event) => set('phone', event.target.value)} placeholder="+994 55 000 00 00" required />
        <Field label="Bildiriş e-poçtu" prefixIcon="mail" type="email" inputMode="email" value={values.notifyEmail} onChange={(event) => set('notifyEmail', event.target.value)} required />
      </div>
      <Field label="Ünvan" prefixIcon="map-pin" autoComplete="street-address" value={values.address} onChange={(event) => set('address', event.target.value)} required />
      <Field label="VÖEN" value={values.voen} onChange={(event) => set('voen', event.target.value)} hint="İstəyə bağlıdır." />
      <StepActions onBack={onBack} primary={<Button type="submit" variant="primary" loading={busy} iconAfter="arrow-right">Saxla və davam et</Button>} />
    </form>
  );
}

function LicenseStep({ data, busy, onBack, onNext }: { data: OnboardingPayload; busy: boolean; onBack: () => void; onNext: () => void }) {
  const license = data.license;
  return (
    <>
      {license ? (
        <div className="license-panel">
          <span className={`license-icon ${license.status === 'active' ? 'success' : 'warning'}`}><Icon name="key" size={26} /></span>
          <div><Badge tone={license.status === 'active' ? 'success' : 'warning'}>{license.status === 'active' ? 'Aktiv lisenziya' : license.status}</Badge><h2>{license.plan} planı</h2><p>{license.seats} kassa üçün nəzərdə tutulub.</p></div>
          <dl><div><dt>Başlanğıc</dt><dd>{new Date(license.validFrom).toLocaleDateString('az-AZ')}</dd></div><div><dt>Bitmə</dt><dd>{license.validUntil ? new Date(license.validUntil).toLocaleDateString('az-AZ') : 'Müddətsiz'}</dd></div></dl>
        </div>
      ) : (
        <Alert tone="warning" title="Bu hesabda aktiv lisenziya yoxdur">
          Tətbiqi və quraşdırma təlimatını görə bilərsiniz. POS-u aktivləşdirmək üçün satış komandası sizə aktivasiya açarı təqdim etməlidir.
        </Alert>
      )}
      <div className="onboarding-copy"><h2>Növbəti addımda nə olacaq?</h2><p>Windows tətbiqinin son versiyasını yükləyəcəksiniz. Aktivasiya açarınız yoxdursa, quraşdırmadan sonra dəstək vasitəsilə sorğu göndərə bilərsiniz.</p></div>
      <StepActions
        onBack={onBack}
        secondary={!license ? <LinkButton to="/support?topic=license" variant="secondary" icon="help">Lisenziya köməyi</LinkButton> : undefined}
        primary={<Button variant="primary" loading={busy} iconAfter="arrow-right" onClick={onNext}>Yükləməyə keç</Button>}
      />
    </>
  );
}

function DownloadStep({
  data,
  busy,
  onBack,
  onDownloaded,
  setBusy,
}: {
  data: OnboardingPayload;
  busy: boolean;
  onBack: () => void;
  onDownloaded: (state: OnboardingPayload['onboarding']) => void;
  setBusy: (busy: boolean) => void;
}) {
  const setup = data.setup;
  const [error, setError] = useState(data.setupError || '');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await recordSetupDownload();
      onDownloaded(response.onboarding);
      window.location.assign(response.setup.downloadUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yükləmə başlamadı.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? <Alert tone="danger" title="Yükləmə hazır deyil">{error}</Alert> : null}
      {setup ? (
        <div className="download-panel">
          <span className="download-platform"><Icon name="windows" size={32} /></span>
          <div className="download-main"><span>Windows tətbiqi</span><h2>{setup.productName}</h2><p>Son stabil versiya · təhlükəsiz update feed</p><div><Badge tone="info">v{setup.version}</Badge><span>{formatBytes(setup.sizeBytes)}</span>{setup.releaseDate ? <span>{new Date(setup.releaseDate).toLocaleDateString('az-AZ')}</span> : null}</div></div>
          <Button variant="primary" icon="download" loading={busy} onClick={() => void download()}>Yüklə</Button>
        </div>
      ) : null}
      {setup ? (
        <div className="requirements"><h3>Sistem tələbləri</h3><dl>{Object.entries(setup.requirements).map(([key, value]) => <div key={key}><dt>{requirementLabel(key)}</dt><dd>{value}</dd></div>)}</dl></div>
      ) : null}
      <Alert tone="info" title="Yükləmədən əvvəl">Açıq növbəsi olan köhnə POS qurulumunu yeniləyirsinizsə, əvvəlcə növbəni bağlayın və məlumatların sinxronlaşmasını gözləyin.</Alert>
      <StepActions onBack={onBack} primary={setup ? <Button variant="primary" icon="download" loading={busy} onClick={() => void download()}>Yüklə və davam et</Button> : <Button icon="refresh" onClick={() => window.location.reload()}>Yenidən yoxla</Button>} />
    </>
  );
}

function requirementLabel(key: string) {
  return ({ operatingSystem: 'Əməliyyat sistemi', architecture: 'Arxitektura', memory: 'Yaddaş', diskSpace: 'Disk', internet: 'İnternet' } as Record<string, string>)[key] || key;
}

function InstallStep({ busy, onBack, onNext }: { busy: boolean; onBack: () => void; onNext: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <>
      <div className="install-steps">
        {[
          ['1', 'Yüklənən faylı açın', 'Brauzerin Downloads / Yükləmələr bölməsindən possistem-Setup faylını başladın.'],
          ['2', 'Windows icazəsini təsdiqləyin', 'Quraşdırıcının adı və possistem məhsulunu yoxlayıb davam edin.'],
          ['3', 'Quraşdırmanı tamamlayın', 'Tətbiqi açın, hesab və sizə verilmiş aktivasiya açarı ilə quraşdırmanı tamamlayın.'],
          ['4', 'POS-u açıq saxlayın', 'Yoxlama zamanı server cihazın bağlantısını görməlidir.'],
        ].map(([number, title, description]) => (
          <div key={number}><span>{number}</span><div><strong>{title}</strong><p>{description}</p></div></div>
        ))}
      </div>
      <Checkbox label="Tətbiqi quraşdırdım və POS hazırda açıqdır." checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      <StepActions onBack={onBack} primary={<Button variant="primary" iconAfter="arrow-right" disabled={!confirmed} loading={busy} onClick={onNext}>Bağlantını yoxla</Button>} />
    </>
  );
}

function VerifyStep({
  data,
  busy,
  onBack,
  setBusy,
  onVerified,
}: {
  data: OnboardingPayload;
  busy: boolean;
  onBack: () => void;
  setBusy: (busy: boolean) => void;
  onVerified: (state: OnboardingPayload['onboarding']) => void;
}) {
  const [result, setResult] = useState<{ verified: boolean; reason?: string; lastSeenAt?: string | null; appVersion?: string | null } | null>(
    data.onboarding.verifiedAt ? { verified: true, appVersion: data.onboarding.installedVersion } : null,
  );
  const check = async () => {
    setBusy(true);
    try {
      const response = await verifySetup();
      setResult({ verified: response.verified, reason: response.reason, lastSeenAt: response.connection.lastSeenAt, appVersion: response.connection.appVersion });
      if (response.verified) onVerified(response.onboarding);
    } catch (cause) {
      setResult({ verified: false, reason: cause instanceof Error ? cause.message : 'Yoxlama tamamlanmadı.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className={`verify-visual ${result?.verified ? 'verified' : busy ? 'checking' : ''}`}>
        <span className="verify-ring"><Icon name={result?.verified ? 'check' : 'wifi'} size={34} /></span>
        <div><h2>{busy ? 'POS bağlantısı yoxlanılır…' : result?.verified ? 'Bağlantı təsdiqləndi' : 'POS serverdə görünməlidir'}</h2><p>{busy ? 'Pəncərəni bağlamayın. Bu adətən bir neçə saniyə çəkir.' : result?.verified ? `Versiya ${result.appVersion || 'məlum deyil'} serverə uğurla qoşulub.` : result?.reason || 'POS tətbiqini açıq saxlayın və yoxlamanı başladın.'}</p></div>
      </div>
      {result && !result.verified && !busy ? (
        <Alert tone="warning" title="Bağlantı hələ təsdiqlənməyib">{result.reason}<br />Firewall və interneti yoxlayın, POS-u açıq saxlayıb yenidən cəhd edin.</Alert>
      ) : null}
      <StepActions onBack={onBack} secondary={<LinkButton to="/support?topic=setup" variant="secondary" icon="help">Kömək alın</LinkButton>} primary={<Button variant="primary" icon="refresh" loading={busy} onClick={() => void check()}>{result?.verified ? 'Yenidən yoxla' : 'Bağlantını yoxla'}</Button>} />
    </>
  );
}

function CompleteStep({
  data,
  busy,
  onBack,
  setBusy,
  onComplete,
}: {
  data: OnboardingPayload;
  busy: boolean;
  onBack: () => void;
  setBusy: (busy: boolean) => void;
  onComplete: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const ready = Boolean(data.onboarding.verifiedAt);
  const complete = async () => {
    setBusy(true);
    setError('');
    try {
      await completeOnboarding();
      await onComplete();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Quraşdırma tamamlanmadı.');
    } finally {
      setBusy(false);
    }
  };
  if (!ready) {
    return <ErrorState title="Server yoxlaması tamamlanmayıb" description="Son addımı bitirmək üçün POS bağlantısı serverdə görünməlidir." action={<Button icon="chevron-left" onClick={onBack}>Yoxlamaya qayıt</Button>} />;
  }
  return (
    <>
      {error ? <Alert tone="danger" title="Tamamlamaq mümkün olmadı">{error}</Alert> : null}
      <SuccessState title="possistem istifadəyə hazırdır" description="Quraşdırma və server bağlantısı təsdiqləndi. İndi canlı vəziyyəti ana səhifədə izləyə bilərsiniz." />
      <div className="completion-summary">
        <div><span>Biznes</span><strong>{data.customer.name}</strong></div>
        <div><span>Lisenziya</span><strong>{data.license?.status === 'active' ? `${data.license.plan} · aktiv` : 'Satış təsdiqi tələb olunur'}</strong></div>
        <div><span>Quraşdırılmış versiya</span><strong className="mono">{data.onboarding.installedVersion || data.setup?.version || '—'}</strong></div>
        <div><span>Bildiriş e-poçtu</span><strong>{data.customer.notifyEmail}</strong></div>
      </div>
      <StepActions onBack={onBack} primary={<Button variant="primary" iconAfter="arrow-right" loading={busy} onClick={() => void complete()}>Ana səhifəni aç</Button>} />
    </>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="onboarding-shell" aria-busy="true">
      <aside className="onboarding-sidebar"><Skeleton width={160} height={42} />{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} width="100%" height={52} />)}</aside>
      <main className="onboarding-main"><Skeleton width={120} /><Skeleton width="60%" height={44} /><Skeleton width="100%" height={360} /></main>
    </div>
  );
}

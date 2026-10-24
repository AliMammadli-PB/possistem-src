import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  changePassword,
  getOnboarding,
  getSettings,
  saveNotificationEmail,
  saveProfile,
  type OnboardingPayload,
} from '../api';
import { useAuth } from '../auth/AuthContext';
import { Field, PasswordField } from '../ui/forms';
import { Icon } from '../ui/Icon';
import { PageHeader, Tabs } from '../ui/navigation';
import { Alert, Button, Card, ErrorState, Skeleton } from '../ui/primitives';
import { ConfirmDialog, useToast } from '../ui/overlays';
import { AvatarEditor } from '../ui/AvatarEditor';

const tabs = [
  { label: 'Profil', to: '/settings/profile' },
  { label: 'Təhlükəsizlik', to: '/settings/security' },
  { label: 'Bildirişlər', to: '/settings/notifications' },
];

export default function SettingsPage() {
  const pathname = useLocation().pathname;
  const tab = pathname.endsWith('/security') ? 'security' : pathname.endsWith('/notifications') ? 'notifications' : 'profile';

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Hesab" title="Parametrlər" description="Biznes məlumatları, giriş təhlükəsizliyi və bildiriş seçimləri." />
      <Tabs items={tabs} />
      {tab === 'security' ? <SecuritySettings /> : tab === 'notifications' ? <NotificationSettings /> : <ProfileSettings />}
    </div>
  );
}

function ProfileSettings() {
  const [data, setData] = useState<OnboardingPayload | null>(null);
  const [values, setValues] = useState({ businessName: '', contactPerson: '', phone: '', address: '', voen: '', notifyEmail: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { show } = useToast();

  useEffect(() => {
    void getOnboarding()
      .then((payload) => {
        setData(payload);
        setValues({
          businessName: payload.customer.name,
          contactPerson: payload.customer.contactPerson,
          phone: payload.customer.phone,
          address: payload.customer.address,
          voen: payload.customer.voen,
          notifyEmail: payload.customer.notifyEmail,
        });
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Profil yüklənmədi.'))
      .finally(() => setLoading(false));
  }, []);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  if (loading) return <SettingsSkeleton />;
  if (error || !data) return <ErrorState title="Profil yüklənmədi" description={error || 'Yenidən cəhd edin.'} />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await saveProfile(values);
      show({ tone: 'success', title: 'Profil məlumatları saxlanıldı' });
    } catch (cause) {
      show({ tone: 'danger', title: 'Profil saxlanılmadı', message: cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="settings-card">
        <div className="settings-section-head">
          <span>
            <Icon name="camera" size={22} />
          </span>
          <div>
            <h2>Avatar</h2>
            <p>Şəkilə klik edin və ya fayl seçin. Eyni avatar hər yerdə görünür.</p>
          </div>
        </div>
        <AvatarEditor />
      </Card>
      <Card className="settings-card">
      <div className="settings-section-head"><span><Icon name="building" size={22} /></span><div><h2>Biznes profili</h2><p>Müqavilə, quraşdırma və dəstək üçün istifadə olunan məlumatlar.</p></div></div>
      <form className="settings-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Biznesin adı" prefixIcon="building" value={values.businessName} onChange={(event) => set('businessName', event.target.value)} required />
          <Field label="Əlaqədar şəxs" prefixIcon="user" value={values.contactPerson} onChange={(event) => set('contactPerson', event.target.value)} required />
          <Field label="Telefon" prefixIcon="phone" type="tel" inputMode="tel" value={values.phone} onChange={(event) => set('phone', event.target.value)} required />
          <Field label="Bildiriş e-poçtu" prefixIcon="mail" type="email" value={values.notifyEmail} onChange={(event) => set('notifyEmail', event.target.value)} required />
        </div>
        <Field label="Ünvan" prefixIcon="map-pin" value={values.address} onChange={(event) => set('address', event.target.value)} required />
        <Field label="VÖEN" value={values.voen} onChange={(event) => set('voen', event.target.value)} hint="İstəyə bağlıdır." />
        <div className="settings-actions"><Button type="submit" variant="primary" loading={busy}>Dəyişiklikləri saxla</Button></div>
      </form>
    </Card>
    </>
  );
}

function SecuritySettings() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const { show } = useToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 12) {
      setError('Yeni şifrə ən azı 12 simvol olmalıdır.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('Yeni şifrələr eyni deyil.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changePassword(currentPassword, newPassword);
      show({ tone: 'success', title: 'Şifrə dəyişdirildi', message: 'Təhlükəsizlik üçün bütün sessiyalar bağlandı.' });
      navigate('/login', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Şifrə dəyişdirilmədi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="settings-card">
        <div className="settings-section-head"><span><Icon name="shield" size={22} /></span><div><h2>Şifrəni dəyişin</h2><p>Uzun və yalnız bu hesabda istifadə etdiyiniz şifrə seçin.</p></div></div>
        {error ? <Alert tone="danger" title="Şifrə dəyişdirilmədi">{error}</Alert> : null}
        <form className="settings-form narrow" onSubmit={submit}>
          <PasswordField label="Cari şifrə" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <PasswordField label="Yeni şifrə" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} hint="Ən azı 12 simvol." required />
          <PasswordField label="Yeni şifrəni təkrar yazın" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
          <Button type="submit" variant="primary" loading={busy}>Şifrəni dəyiş</Button>
        </form>
      </Card>
      <Card className="settings-card danger-zone">
        <div className="settings-section-head"><span><Icon name="logout" size={22} /></span><div><h2>Aktiv sessiya</h2><p>Bu cihazda müştəri portalından təhlükəsiz çıxın.</p></div></div>
        <Button variant="secondary" icon="logout" onClick={() => setConfirmLogout(true)}>Hesabdan çıx</Button>
      </Card>
      <ConfirmDialog
        open={confirmLogout}
        title="Hesabdan çıxmaq?"
        description="Bu brauzerdə müştəri sessiyası bağlanacaq."
        confirmLabel="Çıxış"
        onClose={() => setConfirmLogout(false)}
        onConfirm={() => void auth.signOut()}
      />
    </>
  );
}

function NotificationSettings() {
  const [email, setEmail] = useState('');
  const [hwid, setHwid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { show } = useToast();
  useEffect(() => {
    void getSettings()
      .then((data) => { setEmail(data.notifyEmail || data.email); setHwid(data.boundHwid); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Parametrlər yüklənmədi.'))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <SettingsSkeleton />;
  if (error) return <ErrorState title="Bildiriş parametrləri yüklənmədi" description={error} />;

  return (
    <Card className="settings-card">
      <div className="settings-section-head"><span><Icon name="bell" size={22} /></span><div><h2>E-poçt bildirişləri</h2><p>X/Z hesabatları və vacib sistem hadisələri üçün əlaqə ünvanı.</p></div></div>
      <div className="settings-form narrow">
        <Field label="Bildiriş e-poçtu" type="email" inputMode="email" prefixIcon="mail" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Button
          variant="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void saveNotificationEmail(email.trim())
              .then(() => show({ tone: 'success', title: 'Bildiriş e-poçtu saxlanıldı' }))
              .catch((cause) => show({ tone: 'danger', title: 'Parametr saxlanılmadı', message: cause instanceof Error ? cause.message : undefined }))
              .finally(() => setBusy(false));
          }}
        >
          Saxla
        </Button>
      </div>
      <div className="device-binding">
        <span><Icon name="monitor" size={20} /></span>
        <div><strong>Bağlı POS cihazı</strong><small>{hwid || 'Hələ cihaz bağlanmayıb'}</small></div>
        <span className="mono">{hwid ? 'HWID' : '—'}</span>
      </div>
    </Card>
  );
}

function SettingsSkeleton() {
  return <Card className="settings-card" aria-busy="true"><Skeleton width={220} height={28} /><Skeleton width="100%" height={320} /></Card>;
}

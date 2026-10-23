import { useEffect, useMemo, useState } from 'react';
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getWhatsapp,
  pushSubscribe,
  saveWhatsapp,
  testWhatsapp,
  vapidPublicKey,
  whatsappStatus,
  type WhatsappConfig,
} from '../api';
import { Checkbox, Field, TextareaField } from '../ui/forms';
import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/navigation';
import { Alert, Badge, Button, Card, ErrorState, Skeleton } from '../ui/primitives';
import { ConfirmDialog, useToast } from '../ui/overlays';

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function enablePush() {
  if (!window.isSecureContext) throw new Error('Bildirişlər üçün HTTPS tələb olunur.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Bu brauzer push bildirişlərini dəstəkləmir.');
  }
  const { publicKey } = await vapidPublicKey();
  if (!publicKey) throw new Error('Push xidməti serverdə hələ konfiqurasiya edilməyib.');
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Brauzer bildiriş icazəsi vermədi.');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await pushSubscribe(subscription.toJSON());
}

function WhatsappMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26A9.89 9.89 0 0 1 12.06 2a9.8 9.8 0 0 1 7 2.9 9.83 9.83 0 0 1 2.9 7c0 5.45-4.44 9.88-9.91 9.88M20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.23-6.16-3.48-8.42" />
    </svg>
  );
}

export default function IntegrationsPage() {
  const [config, setConfig] = useState<WhatsappConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [pushPermission, setPushPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const { show } = useToast();

  const connected = useMemo(
    () => config?.runtime.status === 'open' || config?.waStatus === 'connected',
    [config],
  );

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setConfig(await getWhatsapp());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İnteqrasiya məlumatı yüklənmədi.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!config || connected || !config.runtime.qrDataUrl) return;
    const timer = window.setInterval(() => {
      void whatsappStatus().then((status) => {
        setConfig((current) => current ? {
          ...current,
          waStatus: status.status === 'open' ? 'connected' : current.waStatus,
          waUser: status.waUser,
          runtime: status,
        } : current);
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [config, connected]);

  if (loading) return <IntegrationsSkeleton />;
  if (error || !config) {
    return <ErrorState title="İnteqrasiyalar yüklənmədi" description={error || 'Yenidən cəhd edin.'} action={<Button icon="refresh" onClick={() => void load()}>Yenidən yoxla</Button>} />;
  }

  const update = <K extends keyof WhatsappConfig>(key: K, value: WhatsappConfig[K]) =>
    setConfig((current) => current ? { ...current, [key]: value } : current);

  const connect = async () => {
    setBusy('connect');
    try {
      const result = await connectWhatsapp();
      setConfig((current) => current ? {
        ...current,
        waStatus: result.status === 'open' ? 'connected' : result.status,
        waUser: result.waUser,
        runtime: result,
      } : current);
      show({ tone: result.status === 'open' ? 'success' : 'info', title: result.status === 'open' ? 'WhatsApp bağlıdır' : 'QR kod hazırdır' });
    } catch (cause) {
      show({ tone: 'danger', title: 'WhatsApp bağlantısı alınmadı', message: cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await saveWhatsapp({
        enabled: config.enabled,
        recipientPhone: config.recipientPhone.trim(),
        adminName: config.adminName.trim() || 'Admin',
        messageTemplate: config.messageTemplate.trim(),
      });
      show({ tone: 'success', title: 'WhatsApp parametrləri saxlanıldı' });
    } catch (cause) {
      show({ tone: 'danger', title: 'Parametrlər saxlanılmadı', message: cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Əlaqə kanalları" title="İnteqrasiyalar" description="WhatsApp hesabatları və brauzer bildirişlərini idarə edin." />

      <div className="integration-grid">
        <Card className="integration-card integration-whatsapp">
          <div className="integration-head">
            <span className="brand-integration whatsapp"><WhatsappMark size={26} /></span>
            <div><h2>WhatsApp</h2><p>X/Z hesabatları və vacib POS hadisələri.</p></div>
            <Badge tone={connected ? 'success' : 'neutral'}>{connected ? 'Bağlıdır' : 'Bağlı deyil'}</Badge>
          </div>
          {connected ? (
            <Alert tone="success" title="WhatsApp bağlantısı aktivdir">
              {config.waUser ? `Bağlı hesab: ${config.waUser}` : 'Hesabat bildirişləri göndərilə bilər.'}
            </Alert>
          ) : (
            <Alert tone="info" title="Telefonunuzu əlaqələndirin">
              WhatsApp → Bağlı cihazlar → Cihazı əlaqələndir bölməsindən QR kodu oxudun.
            </Alert>
          )}
          {config.runtime.qrDataUrl && !connected ? (
            <div className="qr-panel">
              <img src={config.runtime.qrDataUrl} alt="WhatsApp cihaz əlaqələndirmə QR kodu" width={240} height={240} />
              <div><strong>QR kodu telefonla oxudun</strong><p>Kod qısa müddətə etibarlıdır. Bağlantı avtomatik yoxlanılır.</p></div>
            </div>
          ) : null}
          <div className="integration-actions">
            {!connected ? <Button variant="primary" loading={busy === 'connect'} onClick={() => void connect()}><WhatsappMark size={18} /> QR kod göstər</Button> : null}
            {connected ? <Button variant="secondary" onClick={() => setConfirmDisconnect(true)}>Bağlantını ayır</Button> : null}
          </div>
        </Card>

        <Card className="integration-card">
          <div className="integration-head">
            <span className="brand-integration push"><Icon name="bell" size={24} /></span>
            <div><h2>Brauzer bildirişləri</h2><p>POS oflayn olduqda və hesabat yarandıqda xəbər alın.</p></div>
            <Badge tone={pushPermission === 'granted' ? 'success' : 'neutral'}>{pushPermission === 'granted' ? 'Aktivdir' : pushPermission === 'denied' ? 'Bloklanıb' : 'Bağlıdır'}</Badge>
          </div>
          {pushPermission === 'denied' ? (
            <Alert tone="warning" title="Bildiriş icazəsi bloklanıb">Brauzer və ya telefon parametrlərindən possistem.az üçün bildiriş icazəsini aktivləşdirin.</Alert>
          ) : (
            <p className="muted-copy">iPhone-da push bildirişləri üçün saytı Safari-dən əsas ekrana əlavə edib həmin ikondan açın. Android və desktop brauzerlərində birbaşa aktivləşdirilə bilər.</p>
          )}
          <Button
            variant="secondary"
            icon="bell"
            loading={busy === 'push'}
            disabled={pushPermission === 'denied' || pushPermission === 'unsupported'}
            onClick={() => {
              setBusy('push');
              void enablePush()
                .then(() => {
                  setPushPermission(Notification.permission);
                  show({ tone: 'success', title: 'Brauzer bildirişləri aktivdir' });
                })
                .catch((cause) => show({ tone: 'danger', title: 'Bildiriş aktivləşmədi', message: cause instanceof Error ? cause.message : undefined }))
                .finally(() => setBusy(''));
            }}
          >
            Bildirişləri aktivləşdir
          </Button>
        </Card>
      </div>

      <Card>
        <div className="card-heading"><div><span className="section-eyebrow">WhatsApp parametrləri</span><h2>Bildiriş alıcısı</h2></div></div>
        <div className="form-grid">
          <Field label="Telefon (ölkə kodu ilə)" type="tel" inputMode="tel" prefixIcon="phone" value={config.recipientPhone} onChange={(event) => update('recipientPhone', event.target.value)} placeholder="994501234567" />
          <Field label="Müraciət adı" prefixIcon="user" value={config.adminName} onChange={(event) => update('adminName', event.target.value)} />
        </div>
        <TextareaField label="Mesaj şablonu" rows={4} value={config.messageTemplate} onChange={(event) => update('messageTemplate', event.target.value)} hint="Dəyişənlər: {admin}, {title}, {body}" />
        <Checkbox label="X/Z hesabatları üçün WhatsApp bildirişləri aktiv olsun" checked={config.enabled} onChange={(event) => update('enabled', event.target.checked)} />
        <div className="button-row">
          <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>Parametrləri saxla</Button>
          <Button
            variant="secondary"
            loading={busy === 'test'}
            disabled={!connected || !config.recipientPhone.trim()}
            onClick={() => {
              setBusy('test');
              void testWhatsapp(config.recipientPhone.trim())
                .then(() => show({ tone: 'success', title: 'Test mesajı göndərildi' }))
                .catch((cause) => show({ tone: 'danger', title: 'Test mesajı göndərilmədi', message: cause instanceof Error ? cause.message : undefined }))
                .finally(() => setBusy(''));
            }}
          >
            Test mesajı göndər
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDisconnect}
        title="WhatsApp bağlantısını ayırmaq?"
        description="X/Z və POS status bildirişləri bu kanala göndərilməyəcək. İstənilən vaxt yenidən QR ilə bağlaya bilərsiniz."
        confirmLabel="Bağlantını ayır"
        danger
        busy={busy === 'disconnect'}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          setBusy('disconnect');
          void disconnectWhatsapp()
            .then(() => {
              setConfig((current) => current ? { ...current, waStatus: 'disconnected', waUser: null, runtime: { ...current.runtime, status: 'disconnected', qrDataUrl: null } } : current);
              setConfirmDisconnect(false);
              show({ tone: 'success', title: 'WhatsApp bağlantısı ayrıldı' });
            })
            .catch((cause) => show({ tone: 'danger', title: 'Bağlantı ayrılmadı', message: cause instanceof Error ? cause.message : undefined }))
            .finally(() => setBusy(''));
        }}
      />
    </div>
  );
}

function IntegrationsSkeleton() {
  return (
    <div className="page-stack" aria-busy="true">
      <Skeleton width={180} /><Skeleton width="50%" height={42} />
      <div className="integration-grid"><Skeleton width="100%" height={340} /><Skeleton width="100%" height={340} /></div>
      <Skeleton width="100%" height={420} />
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useLiveEffect } from '../lib/live';

type WipeStatus = {
  customerName: string;
  available: boolean;
  devices: Array<{ id: string; hostname: string | null; appVersion: string | null; lastSeenAt: string | null }>;
  commands: Array<{
    id: string;
    deviceId: string | null;
    status: string;
    serverCleared: boolean;
    error: string | null;
    errorCode: string | null;
    createdAt: string;
  }>;
};

function statusLabel(c: WipeStatus['commands'][number]): string {
  if (c.status === 'done') return c.serverCleared ? 'Silindi' : 'Kassa silindi, server təmizlənir';
  if (c.status === 'pending') return 'Kassanın qoşulmasını gözləyir';
  if (c.status === 'taken') return 'Kassa icra edir';
  if (c.status === 'expired') return 'Vaxtı keçdi, kassa silinməyib';
  if (c.errorCode === 'E_UNKNOWN_METHOD') return 'Kassa köhnə versiyadadır, silinməyib';
  if (c.errorCode === 'E_NOT_HOST') return 'Əsas kassa deyil, silinməyib';
  return `Alınmadı: ${c.error ?? 'naməlum xəta'}`;
}

/** Restaurant only for now: other tills have their own databases and commands. */
export function CustomerDataWipe({ customerId }: { customerId: string }) {
  const [data, setData] = useState<WipeStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setData(await api<WipeStatus>(`/customers/${customerId}/data-wipe`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Məlumat alınmadı');
    }
  };
  useEffect(() => {
    setData(null);
    setOpen(false);
    setName('');
    setError('');
  }, [customerId]);
  useLiveEffect(() => {
    void load();
  }, [customerId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !data || name !== data.customerName) return;
    setBusy(true);
    setError('');
    try {
      setData(await api<WipeStatus>(`/customers/${customerId}/data-wipe`, {
        method: 'POST',
        body: JSON.stringify({ confirmName: name }),
      }));
      setOpen(false);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silmə başladılmadı');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p className="muted">{error}</p> : null;
  const inFlight = data.commands.some((c) => c.status === 'pending' || c.status === 'taken');
  const host = (id: string | null) => data.devices.find((d) => d.id === id)?.hostname ?? id ?? 'Kassa';

  return (
    <section className="customer-catalogue" id="data-wipe">
      <div className="section-heading catalogue-heading">
        <div>
          <p className="eyebrow">Təhlükəli əməliyyat</p>
          <h2>Bütün datanı sil</h2>
          <p className="muted compact-copy">
            Restoran kassalarında satış, ödəniş, hesabat, menyu, anbar, işçi, ayar və audit jurnalı silinir, kassa yeni
            kimi açılır. Hesab, lisenziya, abunə və ödənişlər qalır. Kassada köhnə bazanın nüsxəsi 30 gün saxlanır. Əmr
            24 saat keçərlidir; kassa o vaxta qədər qoşulmasa, silinmir.
          </p>
        </div>
      </div>

      {data.commands.length > 0 && (
        <ul className="activity-list">
          {data.commands.map((c) => (
            <li key={c.id}>
              <strong>{host(c.deviceId)}</strong>: {statusLabel(c)}{' '}
              <small>{new Date(c.createdAt).toLocaleString('az-AZ')}</small>
            </li>
          ))}
        </ul>
      )}

      {data.devices.length === 0 ? (
        <p className="muted">Bu müştərinin aktiv Restoran kassası yoxdur.</p>
      ) : !open ? (
        <button type="button" className="btn danger" disabled={inFlight || !data.available} onClick={() => setOpen(true)}>
          {inFlight ? 'Silmə gedir' : 'Bütün datanı sil'}
        </button>
      ) : (
        <form onSubmit={submit}>
          <p>
            Bu əməliyyat <strong>{data.devices.length}</strong> kassaya gedir:{' '}
            {data.devices.map((d) => `${d.hostname ?? d.id} (${d.appVersion ?? 'versiya bilinmir'})`).join(', ')}.
          </p>
          <label>
            Təsdiq üçün müştərinin adını tam yazın: <strong>{data.customerName}</strong>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-label="Müştərinin adı" />
          </label>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
            <button type="submit" className="btn danger" disabled={busy || name !== data.customerName}>
              Datanı sil
            </button>
            <button type="button" className="btn" onClick={() => { setOpen(false); setName(''); }}>
              Ləğv et
            </button>
          </div>
        </form>
      )}
      {error && <p className="muted" role="alert">{error}</p>}
    </section>
  );
}

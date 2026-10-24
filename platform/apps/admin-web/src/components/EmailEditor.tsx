import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';

type Props = {
  customerId: string;
  customerName: string;
  email: string | null;
  licenseId?: string | null;
  maxDevices?: number | null;
  onSaved: (email: string | null) => void;
  onCapacitySaved?: (maxDevices: number) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
};

export function EmailEditor({
  customerId,
  customerName,
  email,
  licenseId = null,
  maxDevices = null,
  onSaved,
  onCapacitySaved,
  onDeleted,
  onError,
}: Props) {
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email ?? '');
  const [deviceDraft, setDeviceDraft] = useState(maxDevices == null ? '' : String(maxDevices));
  const [busy, setBusy] = useState(false);
  const canEditDevices = Boolean(licenseId) && maxDevices != null;

  useEffect(() => {
    if (!editing) {
      setDraft(email ?? '');
      setDeviceDraft(maxDevices == null ? '' : String(maxDevices));
    }
  }, [email, maxDevices, editing]);

  const save = async (next: string | null) => {
    setBusy(true);
    onError('');
    const nextDevices = Number(deviceDraft);
    const devicesChanged = canEditDevices && nextDevices !== maxDevices;
    if (devicesChanged && (!Number.isInteger(nextDevices) || nextDevices < 1 || nextDevices > 50)) {
      onError('İstifadə sayı 1 ilə 50 arasında olmalıdır');
      setBusy(false);
      return;
    }
    try {
      const emailChanged = (next ?? '') !== (email ?? '');
      if (emailChanged) {
        const res = await api<{ ok: true; email: string | null }>(`/customers/${customerId}/email`, {
          method: 'PATCH',
          body: JSON.stringify({ email: next ?? '' }),
        });
        onSaved(res.email);
      }
      if (devicesChanged && licenseId) {
        const res = await api<{ maxDevices: number }>(`/customers/${customerId}/device-capacity`, {
          method: 'PATCH',
          body: JSON.stringify({ licenseId, maxDevices: nextDevices }),
        });
        onCapacitySaved?.(res.maxDevices);
      }
      setEditing(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${customerName} — Bu sahibkarın hesabı bütün POS-ları və bağlı cihazları ilə birlikdə silinəcək. Davam edilsin?`)) return;
    setBusy(true);
    onError('');
    try {
      await api(`/customers/${customerId}`, { method: 'DELETE', body: '{}' });
      onDeleted();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="email-editor">
        <input
          className="email-editor-input mono"
          type="email"
          value={draft}
          disabled={busy}
          autoFocus
          placeholder="email@example.com"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save(draft.trim() || null);
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        {canEditDevices ? (
          <label>
            {t.sales.usageCount}
            <input
              className="email-editor-input"
              type="number"
              min={1}
              max={50}
              step={1}
              inputMode="numeric"
              value={deviceDraft}
              disabled={busy}
              onChange={(e) => setDeviceDraft(e.target.value)}
            />
          </label>
        ) : null}
        {canEditDevices ? <p className="muted compact-copy">{t.sales.usageHint}</p> : null}
        <div className="row-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void save(draft.trim() || null)}
          >
            {t.common.save}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(false)}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="email-editor">
      <span className="mono">{email ?? '—'}</span>
      <div className="row-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(true)}>
          {t.sales.editEmail}
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
          Sahibkar hesabını sil
        </button>
      </div>
    </div>
  );
}

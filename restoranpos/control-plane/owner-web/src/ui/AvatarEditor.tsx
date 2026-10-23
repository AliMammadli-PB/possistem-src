import { useRef, useState, type ChangeEvent } from 'react';
import { removeAvatar, uploadAvatar } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './Icon';
import { Button } from './primitives';
import { useToast } from './overlays';

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function AvatarEditor({ compact = false }: { compact?: boolean }) {
  const { customer, patchCustomer } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { show } = useToast();
  const name = customer?.contactPerson || customer?.name || 'Müştəri';

  const pick = () => inputRef.current?.click();

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const avatarUrl = await uploadAvatar(file);
      patchCustomer({ avatarUrl });
      show({ tone: 'success', title: 'Avatar yeniləndi' });
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Avatar yüklənmədi',
        message: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeAvatar();
      patchCustomer({ avatarUrl: null });
      show({ tone: 'success', title: 'Avatar silindi' });
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Avatar silinmədi',
        message: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`avatar-editor${compact ? ' avatar-editor--compact' : ''}`}>
      <button
        type="button"
        className="avatar-editor-preview"
        onClick={pick}
        disabled={busy}
        aria-label="Avatar seçin"
        title="Avatar seçin"
      >
        {customer?.avatarUrl ? <img src={customer.avatarUrl} alt="" /> : <span>{initials(name)}</span>}
        <span className="avatar-editor-cam" aria-hidden="true">
          <Icon name="camera" size={14} />
        </span>
      </button>
      {compact ? null : (
        <div className="avatar-editor-copy">
          <h2>Profil şəkli</h2>
          <p>Header, müştəri portalı və canlı chat-də eyni şəkil görünür.</p>
          <div className="settings-actions">
            <Button type="button" variant="primary" icon="upload" loading={busy} onClick={pick}>
              Şəkil seç
            </Button>
            {customer?.avatarUrl ? (
              <Button type="button" variant="secondary" icon="trash" disabled={busy} onClick={() => void onRemove()}>
                Sil
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => void onFile(event)}
      />
    </div>
  );
}

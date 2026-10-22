import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

/**
 * Collects a manager PIN for one privileged operation. The PIN travels with that
 * operation to main, which verifies it (throttled) and alone decides who approved
 * - the renderer never learns or forwards an approver identity.
 */
type Props = {
  title?: string;
  superAdminOnly?: boolean;
  lang?: string;
  onClose: () => void;
  onApproved: (managerPin: string) => Promise<void> | void;
};

export function ManagerApprovalModal({ title = 'Menecer təsdiqi', onClose, onApproved, superAdminOnly = false, lang = 'az' }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
  const submit = async () => {
    if(busy)return;
    setError('');
    if (!(superAdminOnly ? /^\d{10}$/ : /^\d{4,10}$/).test(pin)) {
      setError('PIN yanlışdır');
      return;
    }
    setBusy(true);
    try {
      await onApproved(pin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/icazə|approval|permission|PIN/i.test(message) ? t('Şifrə yanlışdır və ya təsdiq icazəsi yoxdur','Неверный пароль или нет права подтверждения','Invalid password or approval permission') : message);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header>
          <div>
            <h3>{title}</h3>
            <p>{superAdminOnly?t('Superadminin 10 rəqəmli şifrəsi','10-значный пароль суперадминистратора','Superadmin’s 10-digit password'):'Məhdud əməliyyat üçün menecer PIN'}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Bağla"><X /></button>
        </header>
        <label className="field">
          <span>PIN</span>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>Ləğv et</button>
          <button type="button" className="modal-primary" disabled={busy} onClick={() => void submit()}><KeyRound />Təsdiq et</button>
        </div>
      </div>
    </div>
  );
}

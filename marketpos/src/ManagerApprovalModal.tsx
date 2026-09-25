import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

/**
 * Collects a manager PIN for one privileged operation. The PIN travels with that
 * operation to main, which verifies it (throttled) and alone decides who approved
 * - the renderer never learns or forwards an approver identity.
 */
type Props = {
  title?: string;
  onClose: () => void;
  onApproved: (managerPin: string) => Promise<void> | void;
};

export function ManagerApprovalModal({ title = 'Menecer təsdiqi', onClose, onApproved }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN yanlışdır');
      return;
    }
    try {
      await onApproved(pin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/icazə|approval|permission|PIN/i.test(message) ? 'PIN yanlışdır və ya təsdiq icazəsi yoxdur' : message);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header>
          <div>
            <h3>{title}</h3>
            <p>Məhdud əməliyyat üçün menecer PIN</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Bağla"><X /></button>
        </header>
        <label className="field">
          <span>PIN</span>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Ləğv et</button>
          <button type="button" className="modal-primary" onClick={() => void submit()}><KeyRound />Təsdiq et</button>
        </div>
      </div>
    </div>
  );
}

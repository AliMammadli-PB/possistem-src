import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

type Props = {
  title?: string;
  onClose: () => void;
  onApproved: (approver: { approverId: string; role: string; name: string }) => void;
};

export function ManagerApprovalModal({ title = 'Menecer təsdiqi', onClose, onApproved }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    const result = await window.marketSystem?.authExtra?.verifyManagerPin(pin);
    if (!result?.ok) {
      setError('PIN yanlışdır');
      return;
    }
    onApproved({ approverId: result.approverId, role: result.role, name: result.name });
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

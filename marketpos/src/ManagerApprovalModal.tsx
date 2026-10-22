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

export function ManagerApprovalModal({ title = 'Müdir təsdiqi', onClose, onApproved, superAdminOnly = false, lang = 'az' }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
  const submit = async () => {
    if(busy)return;
    setError('');
    if (!(superAdminOnly ? /^\d{10}$/ : /^\d{4,10}$/).test(pin)) {
      setError(t('Kod yanlışdır','Неверный код','Wrong code'));
      return;
    }
    setBusy(true);
    try {
      await onApproved(pin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/icazə|approval|permission|PIN/i.test(message) ? t('Müdir kodu yanlışdır və ya təsdiq icazəsi yoxdur','Неверный код руководителя или нет права подтверждения','Wrong manager code or no approval right') : message);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header>
          <div>
            <h3>{title}</h3>
            <p>{superAdminOnly?t('Müdirin 10 rəqəmli kodu','10-значный код руководителя','Manager’s 10-digit code'):t('Silmə, ləğv və qaytarma üçün müdir kodu (müdirin PIN-i və ya 10 rəqəmli kod)','Код руководителя для удаления, отмены и возврата (PIN руководителя или 10-значный код)','Manager code for delete, void and return (manager PIN or 10-digit code)')}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={t('Bağla','Закрыть','Close')}><X /></button>
        </header>
        <label className="field">
          <span>{t('Müdir kodu','Код руководителя','Manager code')}</span>
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
          <button type="button" disabled={busy} onClick={onClose}>{t('Bağla','Закрыть','Close')}</button>
          <button type="button" className="modal-primary" disabled={busy} onClick={() => void submit()}><KeyRound />{t('Təsdiqlə','Подтвердить','Confirm')}</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { tr } from './i18n';
import type { Lang, SessionUser, StaffProfile } from './types';

/**
 * Shown right after sign-in while the account still holds a factory PIN. Main
 * refuses every other call for such a session, so this is the only way on.
 */
export function ChangePinScreen({ lang, session, onChanged, onLogout }: {
  lang: Lang;
  session: SessionUser;
  onChanged: (profile: StaffProfile) => void;
  onLogout: () => void;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 8);

  const submit = async () => {
    setError('');
    if (!/^\d{4,8}$/.test(pin)) { setError(tr(lang, 'pinNew')); return; }
    if (pin !== confirm) { setError(tr(lang, 'pinMismatch')); return; }
    setBusy(true);
    try {
      const profile = await window.marketSystem!.auth.changePin(session.sessionToken, pin);
      onChanged(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Same frame as the email and activation gates (Restaurant POS look).
  return (
    <div className="ps-rest-gate">
      <div className="ps-rest-gate-photo" style={{ backgroundImage: 'url(./assets/login-bg.png)' }} aria-hidden="true" />
      <div className="ps-rest-gate-grid">
        <div className="ps-rest-gate-brand">
          <div className="ps-rest-gate-head">
            <div className="ps-brand-lockup ps-brand-lockup--hero"><img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--hero" draggable={false} /></div>
            <div>
              <p className="ps-rest-gate-wordmark">possistem</p>
              <p className="ps-rest-gate-sub">{tr(lang, 'gateTagline')}</p>
            </div>
          </div>
          <div className="ps-rest-gate-copy">
            <p className="ps-rest-gate-kicker">{session.name}</p>
            <h1 className="ps-rest-gate-title">{tr(lang, 'pinChangeTitle')}</h1>
            <div className="ps-rest-gate-rule" />
            <p className="ps-rest-gate-hint">{tr(lang, 'pinChangeHint')}</p>
          </div>
          <p className="ps-rest-gate-secure">{tr(lang, 'loginSecure')}</p>
        </div>
        <form className="ps-rest-gate-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="ps-rest-gate-mobile">
            <img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--compact" draggable={false} />
            <h2>{tr(lang, 'pinChangeTitle')}</h2>
          </div>
          <h2 className="ps-rest-gate-desk-title">{tr(lang, 'pinChangeTitle')}</h2>
          <div className="ps-rest-gate-rule ps-rest-gate-rule--card" />
          <label>
            <span>{tr(lang, 'pinNew')}</span>
            <input autoFocus type="password" inputMode="numeric" autoComplete="new-password" className="ps-rest-gate-input" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
          </label>
          <label>
            <span>{tr(lang, 'pinConfirm')}</span>
            <input type="password" inputMode="numeric" autoComplete="new-password" className="ps-rest-gate-input" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} />
          </label>
          {error && <p className="ps-rest-gate-error" role="alert">{error}</p>}
          <button type="submit" className="ps-rest-gate-submit" disabled={busy}>{busy ? '…' : tr(lang, 'pinSave')}</button>
          <div className="ps-rest-gate-links">
            <button type="button" onClick={onLogout}>{tr(lang, 'logout')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

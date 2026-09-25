import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
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

  return (
    <main className="ps-login-screen" style={{ backgroundImage: 'url(./assets/login-bg.png)' }}>
      <div className="ps-login-veil" aria-hidden />
      <form className="ps-login-glass" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2><KeyRound /> {tr(lang, 'pinChangeTitle')}</h2>
        <p>{session.name} · {tr(lang, 'pinChangeHint')}</p>
        <label className="field">
          <span>{tr(lang, 'pinNew')}</span>
          <input autoFocus type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        </label>
        <label className="field">
          <span>{tr(lang, 'pinConfirm')}</span>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onLogout}><LogOut />{tr(lang, 'logout')}</button>
          <button type="submit" className="modal-primary" disabled={busy}><KeyRound />{tr(lang, 'pinSave')}</button>
        </div>
      </form>
    </main>
  );
}

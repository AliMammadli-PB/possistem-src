import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function ChangePasswordPage() {
  const { changePassword, insecureTransport } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      {insecureTransport && (
        <div className="banner-insecure" role="alert">
          Insecure transport: COOKIE_SECURE=false
        </div>
      )}
      <form className="auth-card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Change password</h1>
        <p className="muted">You must set a new password before continuing.</p>
        {error && <div className="error">{error}</div>}
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
            minLength={12}
          />
        </label>
        <label>
          Confirm
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}

/**
 * Login screen shown when the backend requires a password (APP_PASSWORD set).
 */

import { useState, FormEvent } from 'react';
import { login } from '../services/api';

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        {/* The receipt symbol, painted by CSS rather than passed in: it has a
            light and a dark cut, this screen has no theme prop, and a background
            image can follow `[data-theme]` without one. Decorative — the <h1>
            under it is the name. */}
        <div className="login-brand" aria-hidden="true" />
        <h1>Sundry</h1>
        <p className="login-sub">Enter your password to continue</p>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // The login screen exists solely to take this one field, so focusing it
            // on mount saves a keystroke rather than stealing focus from anything else.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            required
          />
        </div>

        <button type="submit" className="btn-primary login-submit" disabled={loading || !password}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

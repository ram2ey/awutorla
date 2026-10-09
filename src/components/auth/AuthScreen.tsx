import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../lib/auth';
import { CenteredCardShell } from '../ui/CenteredCardShell';

export function AuthScreen() {
  const { signIn, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputClass = 'w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-mustard-400';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = reset ? await sendPasswordReset(email.trim()) : await signIn(email.trim(), password);
      if (result.error) setError(result.error);
      else if (reset) setMessage('If this email has a staff account, a password reset link has been sent.');
    } catch {
      setError('Could not reach the sign-in service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <CenteredCardShell>
    <div className="text-center space-y-2 mb-8">
      <img src="/logo.png" alt="Awutorla" className="h-16 w-auto mx-auto" />
      <h1 className="text-xl font-semibold">{reset ? 'Reset staff password' : 'Staff sign in'}</h1>
      <p className="text-xs text-gray-500">Atelier staff and administrators</p>
    </div>
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="staff-email" className="block text-xs font-semibold mb-1">Email</label>
        <input id="staff-email" type="email" autoComplete="username" required value={email}
          onChange={(event) => setEmail(event.target.value)} className={inputClass} />
      </div>
      {!reset && <div>
        <label htmlFor="staff-password" className="block text-xs font-semibold mb-1">Password</label>
        <input id="staff-password" type="password" autoComplete="current-password" required value={password}
          onChange={(event) => setPassword(event.target.value)} className={inputClass} />
      </div>}
      {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 rounded-xl p-3">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-800 bg-emerald-50 rounded-xl p-3">{message}</p>}
      <button disabled={busy} className="w-full bg-charcoal-950 text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50">
        {busy ? 'Please wait…' : reset ? 'Send reset link' : 'Sign in'}
      </button>
      <button type="button" onClick={() => { setReset(!reset); setError(null); setMessage(null); }}
        className="w-full text-xs text-gray-600 underline">
        {reset ? 'Back to staff sign in' : 'Forgot password?'}
      </button>
    </form>
  </CenteredCardShell>;
}

export default AuthScreen;

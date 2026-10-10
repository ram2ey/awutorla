import React, { useState } from 'react';
import { Lock, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { CenteredCardShell } from '../ui/CenteredCardShell';

// New/reset staff accounts must replace their temporary password before working.
export const SetNewPasswordScreen: React.FC = () => {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 12) {
      setErrorMessage('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await updatePassword(password);
      if (error) {
        setErrorMessage(error);
      } else {
        setSuccess(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CenteredCardShell>
      <div className="text-center space-y-2 mb-8">
        <img src="/logo.png" alt="Awutorla" className="h-12 w-auto mx-auto" />
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-accent-950 mt-3">Set New Password</h1>
        <p className="text-xs text-gray-500 font-sans">Enter your new credentials for Awutorla</p>
      </div>

      {success ? (
        <div className="space-y-5 text-center animate-in fade-in">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-600 flex items-center justify-center shadow-sm">
            <CheckCircle2 size={32} />
          </div>
          <p className="text-xs sm:text-sm text-gray-600 font-sans">
            Password updated successfully. You may now sign in to your atelier account.
          </p>
          <button
            onClick={() => signOut()}
            className="w-full py-3 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white shadow-md shadow-accent-900/15 transition-all"
          >
            Continue to Sign In
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 tracking-wide">New Password</label>
            <div className="relative">
              <input
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="w-full bg-white/90 border border-gray-200/90 rounded-xl p-2.5 pl-10 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 shadow-sm transition-all"
              />
              <Lock size={14} className="absolute left-3 top-3 text-gold-700" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 tracking-wide">Confirm New Password</label>
            <div className="relative">
              <input
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full bg-white/90 border border-gray-200/90 rounded-xl p-2.5 pl-10 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 shadow-sm transition-all"
              />
              <Lock size={14} className="absolute left-3 top-3 text-gold-700" />
            </div>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2 text-xs">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-md bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white shadow-accent-900/15 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin text-gold-300" />
                <span>Updating Password...</span>
              </>
            ) : (
              <span>Update Password</span>
            )}
          </button>
        </form>
      )}
    </CenteredCardShell>
  );
};

export default SetNewPasswordScreen;

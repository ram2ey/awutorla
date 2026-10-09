import React, { useEffect, useState } from 'react';
import {
  Shield,
  Scissors,
  User,
  Loader2,
  AlertCircle,
  UserPlus,
  Mail,
  Phone,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth, createStaffAccount } from '../../lib/auth';
import type { UserRole } from '../../types/database.types';

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  role: UserRole;
}

const ROLE_OPTIONS: { value: UserRole; label: string; icon: React.ReactNode }[] = [
  { value: 'tailor', label: 'Artisan Tailor', icon: <Scissors size={13} /> },
  { value: 'admin', label: 'Master Admin', icon: <Shield size={13} /> },
];

const inputClass =
  'w-full bg-white/90 border border-gray-200/90 rounded-xl p-2.5 pl-9 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 shadow-sm transition-all';
const labelClass = 'block text-xs font-semibold text-gray-700 mb-1 tracking-wide';

/**
 * Admin console for adding tailors/admins and managing team role privileges.
 */
export const TailorsManager: React.FC = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<Extract<UserRole, 'tailor' | 'admin'>>('tailor');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<{ email: string; tempPassword: string } | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role')
        .in('role', ['tailor', 'admin'])
        .order('role', { ascending: false });
      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message);
      } else {
        setProfiles((data as ProfileRow[]) || []);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleRoleChange = async (profileId: string, role: UserRole) => {
    setSavingId(profileId);
    setErrorMessage(null);
    const previous = profiles;
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, role } : p)));

    const { error } = await (supabase.from('profiles') as any).update({ role }).eq('id', profileId);
    if (error) {
      setErrorMessage(`Could not update role: ${error.message}`);
      setProfiles(previous);
    }
    setSavingId(null);
  };

  const resetAddForm = () => {
    setNewFullName('');
    setNewEmail('');
    setNewPhone('');
    setNewRole('tailor');
    setCreateError(null);
    setCreatedAccount(null);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    try {
      const result = await createStaffAccount(
        newFullName.trim(),
        newEmail.trim(),
        newRole,
        newPhone.trim() || undefined
      );

      setCreatedAccount({
        email: newEmail.trim(),
        tempPassword: result.tempPassword,
      });

      // Reload the team list so the newly created user appears immediately
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role')
        .in('role', ['tailor', 'admin'])
        .order('role', { ascending: false });
      if (data) setProfiles(data as ProfileRow[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(msg);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <p className="text-xs text-gray-500 font-sans">
          Manage roles across clients and atelier staff. Tailors access digital job cards; Admins manage workshop settings.
        </p>

        {!isAddFormOpen && (
          <button
            type="button"
            onClick={() => {
              resetAddForm();
              setIsAddFormOpen(true);
            }}
            className="px-4 py-2 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 shrink-0"
          >
            <UserPlus size={14} className="text-gold-300" />
            <span>Add Staff Member</span>
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2 text-xs">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Add Staff Account Form or Temporary Password Screen */}
      {isAddFormOpen && (
        <div className="p-6 glass rounded-2xl border border-gold-500/30 shadow-sm space-y-4">
          {createdAccount ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <span className="text-sm font-semibold">Staff Account Created Successfully</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed font-sans">
                Share this temporary password with <span className="font-semibold text-accent-950">{createdAccount.email}</span> directly — it will not be shown again.
              </p>
              <div className="flex items-center justify-between gap-2 p-3.5 bg-white/95 rounded-xl border border-gold-500/40 shadow-sm font-mono">
                <span className="text-base font-bold tracking-wider text-accent-950">{createdAccount.tempPassword}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(createdAccount.tempPassword)}
                  title="Copy password"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent-900 hover:bg-gold-50 transition-colors"
                >
                  <Copy size={15} />
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    resetAddForm();
                    setIsAddFormOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={resetAddForm}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-accent-800 to-accent-600 text-white hover:from-accent-700 transition-all shadow-sm"
                >
                  Add Another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-accent-950 uppercase tracking-wider">New Artisan / Staff Account</span>
                <button
                  type="button"
                  onClick={() => {
                    resetAddForm();
                    setIsAddFormOpen(false);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className={labelClass}>Full Name *</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={newFullName}
                      onChange={(e) => setNewFullName(e.target.value)}
                      placeholder="e.g. Kwame Mensah"
                      className={inputClass}
                    />
                    <User size={14} className="absolute left-3 top-3 text-gold-700" />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Email Address *</label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="artisan@awutorla.com"
                      className={inputClass}
                    />
                    <Mail size={14} className="absolute left-3 top-3 text-gold-700" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className={labelClass}>Ghana Phone (optional)</label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="024XXXXXXX"
                      className={`${inputClass} font-mono`}
                    />
                    <Phone size={14} className="absolute left-3 top-3 text-gold-700" />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Atelier Role</label>
                  <div className="flex bg-gray-100/90 rounded-xl p-1 border border-gray-200/60">
                    <button
                      type="button"
                      onClick={() => setNewRole('tailor')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        newRole === 'tailor'
                          ? 'bg-gradient-to-r from-accent-800 to-accent-950 text-gold-300 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <Scissors size={12} />
                      <span>Artisan Tailor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewRole('admin')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        newRole === 'admin'
                          ? 'bg-gradient-to-r from-accent-800 to-accent-950 text-gold-300 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <Shield size={12} />
                      <span>Master Admin</span>
                    </button>
                  </div>
                </div>
              </div>

              {createError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2 text-xs">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white shadow-md shadow-accent-900/15 transition-all flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-gold-300" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={14} className="text-gold-300" />
                      <span>Create Staff Account</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Profile List */}
      {isLoading ? (
        <div className="p-8 flex justify-center items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin text-accent-700" />
          <span>Loading atelier team...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => {
            const isSelf = p.id === user?.id;
            return (
              <div
                key={p.id}
                className="p-4 glass rounded-2xl flex flex-wrap items-center justify-between gap-3 border border-gray-200/70 hover:border-gold-500/30 transition-all shadow-sm"
              >
                <div className="text-sm">
                  <div className="font-semibold text-accent-950 flex items-center gap-2">
                    <span>{p.full_name || 'Unnamed Staff'}</span>
                    {isSelf && (
                      <span className="text-[10px] font-semibold text-gold-800 bg-gold-50 px-2 py-0.5 rounded-full border border-gold-500/30">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs font-mono mt-0.5">{p.phone_number || 'No phone on file'}</div>
                </div>

                <div className="flex bg-gray-100/90 rounded-xl p-1 border border-gray-200/60">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isSelf || savingId === p.id}
                      onClick={() => handleRoleChange(p.id, opt.value)}
                      title={isSelf ? "You cannot modify your own role here." : undefined}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        p.role === opt.value
                          ? 'bg-gradient-to-r from-accent-800 to-accent-950 text-gold-300 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TailorsManager;

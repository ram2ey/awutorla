import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from './api';
import { api } from './api';
import { clearOfflineStore, setOfflineStoreOwner } from './offlineStore';
import type { UserRole } from '../types/database.types';

async function describeFunctionError(error: unknown, fallback: string): Promise<string> {
  return error instanceof Error ? error.message : fallback;
}

export interface AuthProfile {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  role: UserRole;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
  // Temporary passwords must be replaced before accessing workshop records.
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export interface StaffAccountResult {
  userId: string;
  tempPassword: string;
}

/**
 * Creates a staff account through the admin-only app backend.
 */
export async function createStaffAccount(
  fullName: string,
  email: string,
  role: Extract<UserRole, 'tailor' | 'admin'>,
  phone?: string
): Promise<StaffAccountResult> {
  const { data, error } = await api.functions.invoke('create-staff-account', {
    body: { fullName, email, role, phone },
  });
  if (error) throw new Error(await describeFunctionError(error, 'Failed to create staff account.'));
  if (data?.error) throw new Error(data.error);
  return data as StaffAccountResult;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    let isMounted = true;

    api.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setOfflineStoreOwner(data.session?.user.id ?? null);
      setSession(data.session);
      setIsPasswordRecovery(!!data.session?.user.must_change_password);
      setLoading(false);
    });

    const { data: listener } = api.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;
      setIsPasswordRecovery(event === 'PASSWORD_RECOVERY' || !!newSession?.user.must_change_password);
      setOfflineStoreOwner(newSession?.user.id ?? null);
      if (!newSession) setIsPasswordRecovery(false);
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile(userId: string) {
      setProfile(null);
      try {
        const { data, error } = await api
          .from('profiles')
          .select('id, full_name, phone_number, role')
          .eq('id', userId)
          .maybeSingle();
        if (isMounted && !error) setProfile((data as unknown as AuthProfile) || null);
      } catch {
        // A failed profile lookup must deny access and finish the loading screen.
        if (isMounted) setProfile(null);
      } finally {
        if (isMounted) setLoadedProfileId(userId);
      }
    }

    if (userId) {
      loadProfile(userId);
    } else {
      setProfile(null);
      setLoadedProfileId(null);
    }

    return () => {
      isMounted = false;
    };
  }, [userId]);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { data, error } = await api.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const result = await api.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
    const role = (result.data as { role?: string } | null)?.role;
    if (result.error || (role !== 'tailor' && role !== 'admin')) {
      await api.auth.signOut();
      return { error: 'This account does not have staff access.' };
    }
    return { error: null };
  };

  const sendPasswordReset: AuthContextValue['sendPasswordReset'] = async (email) => {
    const { error } = await api.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: error?.message || null };
  };

  const updatePassword: AuthContextValue['updatePassword'] = async (newPassword) => {
    const { error } = await api.auth.updateUser({ password: newPassword });
    if (!error) setIsPasswordRecovery(false);
    return { error: error?.message || null };
  };

  const signOut = async () => {
    await api.auth.signOut();
    setIsPasswordRecovery(false);
    clearOfflineStore();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        profile,
        loading: loading || (!!session && loadedProfileId !== session.user.id),
        isPasswordRecovery,
        signIn,
        sendPasswordReset,
        updatePassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearOfflineStore, setOfflineStoreOwner } from './offlineStore';
import type { UserRole } from '../types/database.types';

// supabase-js's functions.invoke() throws a generic FunctionsHttpError ("Edge Function
// returned a non-2xx status code") for any non-2xx response — it does not surface the
// error body. That body is usually our own function's `{ error: "..." }` JSON, but a
// platform-level failure (e.g. the function was never deployed, or crashed on boot)
// instead returns Supabase's own error shape, or plain text/HTML. Try each in turn so
// callers see the most specific message available instead of the generic one.
async function describeFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const text = await error.context.text();
      if (text) {
        try {
          const body = JSON.parse(text);
          if (body?.error) return String(body.error);
          if (body?.message) return String(body.message);
        } catch {
          // Not JSON — fall through to the raw text below.
        }
        if (text.length < 300) return text;
      }
    } catch {
      // Response body was unreadable — fall through to the generic message below.
    }
  }
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
  // True after the user opens a password-reset email link — the app should show the
  // "set a new password" screen instead of its normal signed-in content until this
  // resolves (Supabase treats the reset link as a real, though narrowly-scoped, session).
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
 * Creates a tailor/admin account via the create-staff-account Edge Function. Must be
 * called by a signed-in admin — the function itself re-checks this server-side. There
 * is no self-service staff signup: this (and the Team Roles panel that calls it) is
 * the only way a tailor/admin account comes into existence. Throws on failure.
 */
export async function createStaffAccount(
  fullName: string,
  email: string,
  role: Extract<UserRole, 'tailor' | 'admin'>,
  phone?: string
): Promise<StaffAccountResult> {
  const { data, error } = await supabase.functions.invoke('create-staff-account', {
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

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setOfflineStoreOwner(data.session?.user.id ?? null);
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
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
        const { data, error } = await supabase
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const result = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
    const role = (result.data as { role?: string } | null)?.role;
    if (result.error || (role !== 'tailor' && role !== 'admin')) {
      await supabase.auth.signOut();
      return { error: 'This account does not have staff access.' };
    }
    return { error: null };
  };

  const sendPasswordReset: AuthContextValue['sendPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: error?.message || null };
  };

  const updatePassword: AuthContextValue['updatePassword'] = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) setIsPasswordRecovery(false);
    return { error: error?.message || null };
  };

  const signOut = async () => {
    setIsPasswordRecovery(false);
    clearOfflineStore();
    await supabase.auth.signOut();
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

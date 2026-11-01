import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { isConfigured } from '../config';
import { supabase } from '../supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (user) => {
    if (!user) return setProfile(null);
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    setProfile(data);
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session?.user).finally(() => setLoading(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(() => loadProfile(s?.user), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value = {
    session, user: session?.user ?? null, profile, loading,
    signOut: () => supabase.auth.signOut(),
    refreshProfile: () => loadProfile(session?.user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginInput, PublicUser } from '@fap/shared';
import * as authApi from '../api/auth';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login(input: LoginInput): Promise<PublicUser>;
  logout(): Promise<void>;
  /** Updates the signed-in user after the server logged them in or changed their details. */
  setCurrentUser(user: PublicUser): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .getCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const u = await authApi.login(input);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, setCurrentUser: setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

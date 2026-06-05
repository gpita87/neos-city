import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getMe, loginUser, registerUser } from '../lib/api';

const STORAGE_KEY = 'auth_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  // Persist the token to localStorage (the api.js interceptor reads it from there).
  const setToken = useCallback((next) => {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
    setTokenState(next || null);
  }, []);

  // Pull the current user from /me. Clears a stale/invalid token on 401.
  const refresh = useCallback(async () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setUser(null);
      return null;
    }
    try {
      const { user } = await getMe();
      setUser(user);
      return user;
    } catch (err) {
      if (err.response?.status === 401) {
        setToken(null);
        setUser(null);
      }
      return null;
    }
  }, [setToken]);

  // On mount, resolve the stored token (if any) into a user.
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { token, user } = await loginUser({ email, password });
    setToken(token);
    setUser(user);
    return user;
  }, [setToken]);

  const register = useCallback(async (data) => {
    const { token, user } = await registerUser(data);
    setToken(token);
    setUser(user);
    return user;
  }, [setToken]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, [setToken]);

  const value = { user, token, loading, login, register, logout, refresh, setToken };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

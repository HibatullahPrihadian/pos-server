import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api, getToken, setToken, setStoredBusiness } from '../api/client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setStoredBusiness(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await api.get('/api/auth/me');
      setUser(me);
      return me;
    } catch {
      logout();
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Logout otomatis ketika API mengembalikan 401.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('pos:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pos:unauthorized', onUnauthorized);
  }, []);

  const login = async (username, password) => {
    const data = await api.post('/api/auth/login', { username, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const isAdmin = user?.role === 'admin' || user?.is_admin === true;

  // Izin efektif user. Admin selalu semua izin (server juga menegakkan ini).
  const permissions = useMemo(() => {
    if (isAdmin) return null; // null = semua; `can` memperlakukannya sebagai true
    return Array.isArray(user?.permissions) ? user.permissions : [];
  }, [isAdmin, user]);

  const can = useCallback(
    (key) => {
      if (!key) return true;
      if (isAdmin) return true;
      return Array.isArray(permissions) && permissions.includes(key);
    },
    [isAdmin, permissions]
  );

  const value = {
    user,
    loading,
    login,
    logout,
    refresh,
    isAdmin,
    permissions,
    can,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return context;
};

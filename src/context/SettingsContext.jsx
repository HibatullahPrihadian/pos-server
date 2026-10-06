import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { useBusiness } from './BusinessContext';

const SettingsContext = createContext(null);

// Pengaturan toko dipakai banyak halaman (struk, kasir, laporan).
// Dimuat ulang saat mode usaha berganti karena tiap usaha punya setelan sendiri.
export const SettingsProvider = ({ children }) => {
  const { user } = useAuth();
  const { business } = useBusiness();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    // Tunggu mode usaha final agar setelan yang dimuat sesuai usaha aktif.
    // Mode 'all' (ringkasan owner) tidak memuat setelan usaha.
    if (!user || !business || business === 'all') return;
    setLoading(true);
    try {
      const data = await api.get('/api/settings');
      setSettings(data);
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [user, business]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SettingsContext.Provider value={{ settings, setSettings, loading, reload: load }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings harus dipakai di dalam SettingsProvider');
  return context;
};

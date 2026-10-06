import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { peekBusiness, setStoredBusiness, DEFAULT_BUSINESS } from '../api/client';

const BusinessContext = createContext(null);

export const BUSINESS_META = {
  minimarket: { label: 'Minimarket', description: 'Kasir, stok, pembelian, laporan' },
  fotokopi: { label: 'Fotokopi', description: 'Jasa cetak, pesanan & antrian' },
};

// Mode usaha aktif. Staf (satu usaha) langsung terkunci; owner memilih lewat
// BusinessPicker dan bisa berpindah lewat tombol "Ganti Usaha".
export const BusinessProvider = ({ children }) => {
  const { user } = useAuth();
  const [business, setBusinessState] = useState(null);

  const available = useMemo(() => {
    const fromUser = Array.isArray(user?.available_businesses) ? user.available_businesses : null;
    if (fromUser && fromUser.length > 0) return fromUser;
    if (user?.business) return [user.business];
    return [DEFAULT_BUSINESS];
  }, [user]);

  // Owner memilih "Semua Usaha" (all) atau salah satu usaha. 'all' hanya untuk
  // ringkasan gabungan; menu operasional tetap butuh usaha konkret.
  // WAJIB dideklarasikan sebelum useEffect di bawah: effect memakai setBusiness
  // di array dependency, dan array dependency dievaluasi saat render.
  const setBusiness = useCallback((next) => {
    setStoredBusiness(next);
    setBusinessState(next);
  }, []);

  const clearBusiness = useCallback(() => {
    setStoredBusiness(null);
    setBusinessState(null);
  }, []);

  // Pulihkan pilihan terakhir; buang bila bukan usaha yang tersedia bagi user ini.
  // State dan penyimpanan harus selalu sinkron karena header X-Business dibaca
  // dari penyimpanan, bukan dari context.
  useEffect(() => {
    if (!user) {
      setBusinessState(null);
      return;
    }
    const stored = peekBusiness();
    if (stored === 'all' && available.length > 1) {
      setBusinessState('all');
    } else if (stored && available.includes(stored)) {
      setBusinessState(stored);
    } else if (available.length === 1) {
      setBusiness(available[0]);
    } else {
      setStoredBusiness(null);
      setBusinessState(null);
    }
  }, [user, available, setBusiness]);

  // Pemilih mode hanya untuk user multi-usaha yang belum memilih; staf satu
  // usaha dianggap "sedang disiapkan" (bukan menunggu keputusan).
  const needsChoice = Boolean(user) && available.length > 1 && !business;
  const canSwitch = Boolean(user) && available.length > 1;

  const value = useMemo(
    () => ({ business, available, needsChoice, canSwitch, setBusiness, clearBusiness }),
    [business, available, needsChoice, canSwitch, setBusiness, clearBusiness]
  );

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
};

export const useBusiness = () => {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness harus dipakai di dalam BusinessProvider');
  return context;
};

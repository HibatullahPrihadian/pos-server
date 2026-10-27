import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

// Kunci cache versi di sessionStorage: berlaku selama sesi tab (F5 tidak hilang).
const CACHE_KEY = 'pos_app_version';

// Nilai bawaan bila global __APP_VERSION__ belum ter-inject (mis. unit test).
const FALLBACK = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
  commit: null,
  builtAt: null,
};

// Normalisasi payload apa pun menjadi { version, commit, builtAt }.
const normalize = (raw) => ({
  version: raw.version || FALLBACK.version,
  commit: raw.commit ?? null,
  builtAt: raw.builtAt ?? null,
});

// Cache versi hanya valid bila versinya sama dengan versi build yang sedang
// berjalan. Bila aplikasi baru di-deploy, cache lama (versi sebelumnya) harus
// dibuang agar layar tidak menampilkan versi basi sampai request selesai.
const isCacheFresh = (cached) => {
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return false;
  if (!cached.version) return false;
  return cached.version === FALLBACK.version;
};

// useAppVersion mengembalikan { version, commit, builtAt }.
// Sumber utama: endpoint publik GET /api/version (commit/builtAt bisa null).
// Nilai build (dari VERSION) dipakai sebagai cadangan bila endpoint gagal.
const useAppVersion = () => {
  const [info, setInfo] = useState(FALLBACK);

  useEffect(() => {
    let cancelled = false;

    // Baca cache saat mount agar versi tampil tanpa menunggu jaringan.
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (isCacheFresh(cached)) {
          setInfo(normalize(cached));
        } else {
          // Cache dari versi sebelumnya: buang agar tidak menampilkan versi lama.
          sessionStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {
      // Cache rusak atau storage diblokir: abaikan, pakai nilai bawaan.
    }

    const load = async () => {
      try {
        const data = await api.get('/api/version');
        // Hanya objek valid yang dipakai dan di-cache.
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        const next = normalize(data);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {
          // Penyimpanan diblokir: abaikan, state tetap dipakai.
        }
        if (!cancelled) setInfo(next);
      } catch {
        // Endpoint versi tidak tersedia: biarkan fallback dipakai, jangan lempar ke UI.
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // useMemo menjaga referensi objek tetap stabil antar-render.
  return useMemo(
    () => ({ version: info.version, commit: info.commit, builtAt: info.builtAt }),
    [info]
  );
};

export default useAppVersion;

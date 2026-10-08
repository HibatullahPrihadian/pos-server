import { useEffect, useRef } from 'react';

// Key yang tetap fire meski fokus di input teks (kasir sudah bergantung
// perilaku ini: F2/F4/F8 dari kolom barcode, F6/F7 hold, Esc untuk overlay).
// F5 (reload) sengaja tidak dipakai.
const ALWAYS_ACTIVE = new Set(['F2', 'F4', 'F6', 'F7', 'F8', 'Escape']);

const isTypingTarget = (el) => {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

// Selesaikan id kombo Alt+huruf. Scanner USB tidak pernah mengirim modifier,
// jadi kombo tidak akan pernah kepicu oleh hasil scan. Wajib pakai event.code
// (bukan event.key) karena di macOS Option+huruf menghasilkan karakter aksen
// (Option+M -> 'µ'), sedangkan code tetap 'KeyM'.
const resolveAltCombo = (event) => {
  const code = event.code || '';
  if (code.startsWith('Key') && code.length === 4) {
    return `Alt+${code.slice(3)}`;
  }
  const key = event.key || '';
  if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
    return `Alt+${key.toUpperCase()}`;
  }
  return null;
};

// Daftarkan hotkey global dengan penanganan default dicegah.
// map: { F2: fn, 'Alt+H': fn, H: fn, Escape: fn }
// - Huruf/angka tunggal: hanya di luar input teks (kasir, pencarian, qty,
//   nominal bayar) agar tidak bentrok dengan ketikan maupun output scanner USB.
// - Kombo Alt+huruf: selalu fire (scanner tidak pernah mengirim Alt).
// - Ctrl/Cmd: tidak pernah dicegat (copy/paste/select-all milik browser).
// - Alt+F4: diteruskan ke OS (tutup jendela).
const useHotkeys = (map, { enabled = true } = {}) => {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return undefined;

    const handler = (event) => {
      // Jangan ganggu shortcut browser/OS berbasis Ctrl atau Cmd.
      if (event.ctrlKey || event.metaKey) return;

      const registered = mapRef.current;

      if (event.altKey) {
        // Alt+F4 = tutup jendela, jangan dicegat aplikasi.
        if (event.key === 'F4') return;
        const comboId = resolveAltCombo(event);
        const fn = comboId ? registered[comboId] : undefined;
        if (typeof fn === 'function') {
          event.preventDefault();
          fn(event);
        }
        return;
      }

      const key = event.key;
      let fn = registered[key];
      // Huruf tunggal case-insensitive: tekan 'h' maupun 'H' (Shift/Caps)
      // sama-sama cocok ke binding 'H'. Kombo Alt tidak terpengaruh
      // (diselesaikan lebih dulu via event.code).
      if (typeof fn !== 'function' && key && key.length === 1) {
        fn = registered[key.toUpperCase()] || registered[key.toLowerCase()];
      }
      if (typeof fn !== 'function') return;
      if (!ALWAYS_ACTIVE.has(key) && isTypingTarget(event.target)) return;
      event.preventDefault();
      fn(event);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
};

export default useHotkeys;

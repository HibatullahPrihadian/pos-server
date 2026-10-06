# Fix: Blank Page di Halaman Login (TDZ `Cannot access 'l' before initialization`)

## Ringkasan
Halaman login blank karena `BusinessProvider` melempar `ReferenceError: Cannot access 'l' before initialization`
saat render. Penyebabnya adalah **temporal dead zone (TDZ)** di
`src/context/BusinessContext.jsx`: `useEffect` (baris ~28–44) menyertakan `setBusiness`
di array dependency, padahal `setBusiness` dideklarasikan dengan `const` **setelah**
`useEffect` (baris ~48). Array dependency dievaluasi sinkron saat render, sebelum
deklarasi `setBusiness` dieksekusi → error. Karena `BusinessProvider` membungkus
seluruh route (termasuk `/login`), seluruh app gagal render → blank page.

Error minified `Cannot access 'l' before initialization` di `index-CAGsKpWu.js`
cocok dengan akses `const setBusiness` (minified menjadi `l`) sebelum inisialisasi.

## Dampak
- Blank page di `/login` (dan seluruh halaman lain), aplikasi tidak bisa dipakai.
- Hanya terjadi pada bundle hasil `npm run build` terbaru (perubahan refactor
  `BusinessContext` Fase 3).

## Perubahan (1 file)
File: `src/context/BusinessContext.jsx`

Pindahkan deklarasi `setBusiness` (dan `clearBusiness` untuk kerapian) ke **atas**
`useEffect` pemulihan mode usaha, sehingga `setBusiness` sudah terinisialisasi
sebelum dipakai di dependency array.

Urutan yang benar:
1. `const [business, setBusinessState] = useState(null);`
2. `const available = useMemo(...)`
3. `const setBusiness = useCallback((next) => { setStoredBusiness(next); setBusinessState(next); }, []);`
4. `const clearBusiness = useCallback(() => { setStoredBusiness(null); setBusinessState(null); }, []);`
5. `useEffect(...)` dengan dependency `[user, available, setBusiness]`
6. `needsChoice`, `canSwitch`, `value`, `return`.

Alternatif yang setara (pilih salah satu, jangan keduanya):
- Pertahankan urutan sekarang tetapi ganti isi dependency menjadi `[user, available]`
  dan gunakan `setStoredBusiness`/`setBusinessState` langsung di dalam effect
  (tanpa `setBusiness`). Ini menghilangkan referensi ke `setBusiness` dari array
  dependency sehingga TDZ tidak terjadi.

Rekomendasi: **langkah 1–6 (pindahkan `setBusiness` ke atas)** karena paling jelas
dan mempertahankan perilaku persistensi mode usaha apa adanya.

## Catatan
- Tidak ada siklus import antar-module; `BusinessContext` hanya mengimpor
  `useAuth` (dari `AuthContext`) dan helper dari `api/client` (leaf). Jadi ini
  murni kesalahan urutan deklarasi dalam komponen, bukan circular import.
- Jangan mengubah `AuthContext`, `SettingsContext`, `App.jsx`, atau `Sidebar` —
  tidak ada masalah TDZ di sana (sudah dicek).

## Validasi
1. `npm run lint` → tanpa warning/error.
2. `npm run build` → sukses; buka bundle baru, pastikan tidak ada error
   `Cannot access '...' before initialization` di console.
3. Jalankan app (dev atau container) dan buka `/login`:
   - Halaman login tampil (form Username/Password), bukan blank.
   - Login owner `admin` → diarahkan ke `/overview` (mode `all`).
   - Login kasir → diarahkan sesuai izin (`/pos` atau `/`).
   - Refresh di `/login` dan di halaman dalam mode tertentu tidak crash.
4. Regresi cepat: buka beberapa halaman (`/`, `/pos`, `/print-orders`) memastikan
   `useBusiness()` mengembalikan nilai benar dan pemilih mode muncul untuk owner.

## Rollback
Perubahan terisolasi di satu file; kembalikan urutan deklarasi semula bila perlu.

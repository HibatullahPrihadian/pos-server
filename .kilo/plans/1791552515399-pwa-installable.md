# Plan: Jadikan POS instalabel di Chrome (PWA)

> **Status:** Setup PWA (§1–§6 di bawah) **sudah diimplementasikan** dan berjalan
> (container frontend rebuilt, `sw.js`/`manifest.webmanifest`/ikon tersaji 200
> via HTTPS `:9999`). Bagian §7 (Ganti logo) adalah pekerjaan **baru** yang
> sedang direncanakan.

## Masalah

Aplikasi POS tidak bisa diinstal di Chrome sebagai aplikasi terpisah karena
**belum ada setup PWA sama sekali**:

- Tidak ada file manifest (`manifest.webmanifest` / `manifest.json`).
- Tidak ada service worker (tidak ada fetch handler / offline support).
- Tidak ada ikon (192px & 512px), `apple-touch-icon`, maupun `theme-color`.
- `index.html` hanya punya `<title>`, tanpa `<link rel="manifest">` / meta PWA.

Chrome mensyaratkan **semua** hal berikut agar menampilkan "Install app"
(beforeinstallprompt / ikon install di address bar):

1. Dilayani via **HTTPS** (atau `localhost`). — Sudah terpenuhi: nginx sudah
   `listen 443 ssl` (`nginx/templates/default.conf.template:31`) dan README §4
   mewajibkan akses `https://<IP-LAN>:9999`.
2. Ada **web app manifest** valid dengan `name`/`short_name`, `start_url`,
   `display` standalone/fullscreen, `icons` 192 & 512 (PNG).
3. Ada **service worker** terdaftar dengan handler `fetch` + scope mengontrol
   `start_url`.

Tidak ada satupun dari #2 dan #3 saat ini.

## Keputusan

Pakai **`vite-plugin-pwa`** (devDependency). Paling efisien untuk proyek Vite:
satu dependency, manifest + service worker (Workbox) di-generate otomatis dari
`vite.config.js`, tanpa file SW manual yang harus dirawat. Alternatif manual
(manifest + `service-worker.js` tulis tangan di `public/`) tidak dipilih karena
lebih banyak kode untuk hasil yang sama.

> Ikon tetap wajib disiapkan manual (plugin tidak bisa membuat artwork). Tidak
> ada aset gambar di repo saat ini (`src/assets`, `public/` tidak ada; hanya ikon
> lucide `ShoppingBag` di UI). Rencana memakai satu SVG sumber lalu render ke PNG.

## Perubahan

### 1. Dependency
- Tambah devDependency: `vite-plugin-pwa` (versi terbaru yang kompatibel Vite 5,
  mis. `^0.20` atau `^1.x` — pastikan peer `vite ^5`).

### 2. Ikon (baru — belum ada sama sekali)
- Buat `public/` (belum ada) dan taruh:
  - `pwa-192x192.png` (192×192, ikon di dalam safe area, background solid)
  - `pwa-512x512.png` (512×512)
  - `pwa-512x512-maskable.png` (512×512, `purpose: maskable`, konten ikon
    berada dalam radius aman ~80% agar tidak terpotong saat ikon adaptif Android)
  - `apple-touch-icon.png` (180×180, untuk iOS "Add to Home Screen")
  - `favicon.ico` atau `favicon.svg` (opsional, hilangkan 404 favicon)
- Sumber: sederhanakan brand — kotak biru membulat (`#0a84ff`, sesuai
  `.invoice-brand-logo`) dengan glyph tas belanja putih. Dapat dibuat dari satu
  SVG kecil lalu di-render ke PNG (mis. `sharp` sekali pakai atau `rsvg-convert`),
  **tidak** perlu menambah dependency runtime — hanya alat dev sekali jalan.

### 3. `vite.config.js`
- Import `VitePWA` dari `vite-plugin-pwa`; tambahkan ke `plugins`.
- Konfigurasi minimal:
  - `registerType: 'autoUpdate'`
  - `manifest`: `name` "POS Minimarket", `short_name` "POS",
    `start_url: '/'`, `scope: '/'`, `display: 'standalone'`,
    `background_color: '#121212'`, `theme_color: '#0a84ff'`,
    `icons` (192, 512, 512-maskable).
  - `workbox`: jangan cache API (`/api/`, `/uploads/`) — app **tanpa mode
    offline** (README §12); hanya precache asset statis. Pastikan navigasi
    `navigateFallback` ke `index.html` (sudah konsisten dengan `try_files`
    nginx). `runtimeCaching` **tidak** menyertakan `/api/` & `/uploads/`.

### 4. `index.html`
- Tambah `<link rel="icon" href="/favicon.ico">` (jika dibuat).
- Tambah `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`.
- Tambah `<meta name="theme-color" content="#0a84ff">`.
- Tambah `<link rel="manifest" href="/manifest.webmanifest">` — biasanya
  di-inject otomatis oleh plugin; tambahkan manual bila tidak.
- `<link rel="manifest">` dan `<meta name="mobile-web-app-capable">` /
  `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style`
  untuk iOS (opsional tapi murah).

### 5. nginx (`nginx/templates/default.conf.template`)
- Pastikan `/manifest.webmanifest` dan `/sw.js` **tidak** di-cache agresif
  (SW harus selalu segar agar update terdeteksi). `index.html` sudah
  `no-cache` (baris 52-55); tambahkan aturan serupa untuk
  `location = /sw.js` dan `location = /manifest.webmanifest` → `no-cache`.
- `/assets/` sudah `immutable` — aman untuk file ber-hash hasil build.

### 6. Verifikasi (runnable)
- `npm run build` lalu cek `dist/` berisi `manifest.webmanifest`, `sw.js`,
  `registerSW.js`, dan ikon di `dist/`.
- `npm run lint` hijau.
- Manual di Chrome (via `https://<IP-LAN>:9999`): DevTools → Application →
  Manifest (tanpa error, ikon tampil) & Service Workers (aktif, status
  activated). Ikon install di address bar muncul → klik → terbuka sebagai
  jendela terpisah.

## Risiko / catatan
- **HTTPS wajib.** Install tidak akan muncul di `http://<IP-LAN>:9998` (yang
  hanya redirect). Pengguna harus memakai `https://<IP-LAN>:9999` dan memasang
  CA mkcert di perangkat (README §4) sebelum sertifikat dipercaya — tanpa ini
  Chrome memblokir secure context. Self-signed yang tak dipercaya juga
  menggagalkan install.
- **Tanpa offline.** SW sengaja tidak meng-cache API; bila LAN putus, aplikasi
  shell bisa terbuka tapi transaksi tetap gagal (sesuai batasan produk).
- `devOptions.enabled` plugin hanya untuk dev lokal opsional; dapat
  diaktifkan agar bisa diuji saat `npm run dev`.

## Urutan tugas
1. `npm i -D vite-plugin-pwa` (peer Vite 5).
2. Buat ikon PNG di `public/` (192, 512, 512-maskable, apple-touch-icon, favicon).
3. Edit `vite.config.js`: tambah plugin + konfigurasi manifest/workbox.
4. Edit `index.html`: meta/links PWA (theme-color, apple-touch-icon, manifest).
5. Edit nginx template: `no-cache` untuk `/sw.js` & `/manifest.webmanifest`.
6. Rebuild frontend (`docker compose up -d --build frontend`) dan uji install
   di Chrome via HTTPS LAN.

---

## 7. Ganti logo/ikon (PENGERJAAN BARU)

### Konteks
Ikon PWA saat ini memakai artwork inline SVG: `public/favicon.svg` (tile biru
membulat + glyph tas) dan `src/assets/icon-maskable.svg` (versi full-bleed,
glyph di-scale 0.62). PNG di `public/` di-render dari keduanya via `sips`.
Pengguna ingin memakai logo baru bergaya **keranjang belanja** (tile biru
membulat, keranjang + pegangan putih, aksen hijau).

Sumber yang ada sekarang `shopping-basket.png` **hanya 128×128 px** — terlalu
kecil untuk ikon 512 & maskable (buram bila di-upscale). Pengguna memilih
**menyediakan sumber resolusi tinggi**.

### Keputusan
- Sumber resolusi tinggi (SVG atau PNG ≥512×512) diletakkan di **`src/assets/`**
  (mis. `src/assets/logo-source.svg` atau `src/assets/logo-source.png`), **bukan**
  `public/`, agar file sumber mentah tidak ikut ter-copy ke `dist/`. Hanya ikon
  hasil render yang ada di `public/`.
- Render ulang ke **file yang sudah ada** (nama tetap, jadi manifest &
  `index.html` tidak berubah): `pwa-192x192.png`, `pwa-512x512.png`,
  `pwa-512x512-maskable.png`, `apple-touch-icon.png`, dan `favicon.svg`.
- Ganti juga artwork inline `public/favicon.svg` agar favicon konsisten dengan
  logo baru (sumber ini dipakai langsung sebagai favicon, bukan hasil render).

### Langkah implementasi
1. **Tunggu sumber resolusi tinggi** dari pengguna di `src/assets/`
   (path & format dikonfirmasi sebelum mulai).
2. Hapus file kerja lama `shopping-basket.png` di root repo (bukan aset runtime;
   cukup sumber sementara) — atau biarkan bila pengguna ingin menyimpannya.
3. Render ikon dari sumber baru:
   - sumber **SVG**: `sips -s format png src/assets/logo-source.svg --out public/<nama>.png -z <N> <N>` untuk tiap ukuran (192, 512, 512-maskable, 180).
   - sumber **PNG raster**: pakai `sips -z <N> <N> src/assets/logo-source.png --out public/<nama>.png`. Untuk maskable, sisipkan padding aman (~80% safe area) — bila raster sudah punya padding sendiri, cukup resize.
4. Untuk **maskable** (`pwa-512x512-maskable.png`): pastikan isi logo berada
   dalam radius aman ~80% dari tepi (glyph tidak menyentuh tepi) agar tidak
   terpotong oleh mask adaptif Android. Bila sumber tidak punya padding, buat
   varian ber-padding (sumber SVG dengan `transform scale(.62)` seperti pola
   `src/assets/icon-maskable.svg` sekarang, lalu render 512).
5. Update **`public/favicon.svg`** dengan artwork logo baru (tile membulat), agar
   favicon == ikon.
6. Verifikasi ukuran output: `file public/*.png` → 192×192, 512×512, 512×512,
   180×180.
7. Rebuild & restart: `docker compose up -d --build frontend`, lalu cek
   `curl -sk https://localhost:9999/pwa-512x512.png` (200 image/png) dan
   pastikan ikon baru muncul di Chrome (hard reload / clear SW cache bila ikon
   lama masih ter-cache — SW `autoUpdate` + `no-cache` `/sw.js` sudah menangani).

### Risiko / catatan
- Ikon di-cache oleh SW precache dan browser; setelah ganti, lakukan hard reload
  atau uninstall/reinstall app agar ikon baru tampil. Hash asset khusus PWA tidak
  berubah karena nama file tetap — bila perlu, naikkan versi agar SW inject ulang
  (plugin `autoUpdate` menangani lewat perubahan isi precache).
- Jangan commit sumber logo besar bila tidak diperlukan; simpan hanya ikon hasil
  render di `public/`.

### Pertanyaan terbuka
- Path & format sumber resolusi tinggi yang akan dipakai (mis.
  `src/assets/logo-source.svg` / `.png`)? → **menunggu pengguna menyediakan file.**


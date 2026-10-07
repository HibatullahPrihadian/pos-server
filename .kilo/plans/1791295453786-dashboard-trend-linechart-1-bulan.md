# Rencana: Dashboard Tren Penjualan → Line Chart, Window 1 Bulan (Reset per Bulan)

## Tujuan
Ganti semua chart tren di dashboard dari bar chart custom CSS menjadi **line chart (recharts)**, dengan time-series **1 bulan berjalan** (`awal bulan → hari ini`). Window ini **otomatis reset** setiap bulan baru karena dihitung ulang per request dari tanggal server/tanggal klien — tanpa cron/timer.

## Keputusan desain (terkunci)
1. **Scope**: ketiga dashboard —
   - Minimarket: `Tren Penjualan 7 Hari` → **Tren Penjualan Bulan Ini** (`src/pages/Dashboard.jsx` MinimarketDashboard)
   - Owner `all`: `Tren Gabungan 7 Hari` → **Tren Gabungan Bulan Ini** (`src/pages/OwnerDashboard.jsx`)
   - Fotokopi: `Pendapatan 7 Hari` → **Pendapatan Bulan Ini** (PrintDashboard di `Dashboard.jsx`)
2. **Interpretasi "reset tiap bulan baru"**: window kalender — `from = tanggal 1 bulan berjalan`, `to = hari ini`. Tanggal 1 bulan baru → chart otomatis hanya berisi hari itu. **Bukan** rolling 30 hari.
3. **Chart library**: `recharts` sudah ada di `package.json` (`^2.12.0`) tapi belum dipakai di `src/`. Pakai `LineChart` recharts; **tidak menambah dependency baru**. Implementation agent harus verifikasi terinstall (`npm ls recharts`; `npm install` bila belum).
4. **Zero-fill**: series harus kontinu (tanggal tanpa penjualan = `0`), agar line tidak "melayang"/putus. Backend zero-fill untuk dashboard minimarket & owner; **print-summary TIDAK** di-zero-fill di backend (dipakai juga tabel/CSV `PrintReports.jsx` yang harus tetap sparse) — frontend PrintDashboard zero-fill sendiri.
5. **Timezone sales**: tetap `CURRENT_DATE` / `DATE_TRUNC('month', CURRENT_DATE)` (konsisten dengan KPI "Penjualan Bulan Ini" yang sudah ada). Jangan dialihkan ke `APP_TIMEZONE` (itu khusus `purchases.date` yang ditulis klien).

## Temuan kode (verifikasi)
- Bar chart custom: `Dashboard.jsx:305-321` (minimarket), `Dashboard.jsx:128-144` (fotokopi), `OwnerDashboard.jsx:86-102` (owner).
- Backend trend 7 hari hardcoded: `backend/routes/reports.js:753-758` (`summarizeBusiness`, owner overview) dan `:925-930` (`/dashboard`) → `created_at >= CURRENT_DATE - INTERVAL '6 days'`.
- Overview merge tren per usaha: `reports.js:810-819`.
- Print dashboard fetch: `Dashboard.jsx:62-76` kirim `from = today-6` ke `/api/reports/print-summary`.
- Helper frontend siap pakai: `firstOfMonthIso()` & `todayIso()` dari `src/utils/formatters` (sudah dipakai `PrintReports.jsx`, `Reports.jsx`, dll.).
- Pola "bulan berjalan" default sudah ada di backend: `resolveRange` (`reports.js:153-160`).
- `recharts` terdaftar di `package.json:20`, nol import di `src/`.

## Perubahan

### 1. `backend/routes/reports.js`
- Tambah helper lokal (dekat `toIso`):
  ```js
  // Isi titik harian yang hilang dengan 0 antara from..to ('YYYY-MM-DD').
  const zeroFillDailySeries = (rows, from, to) => { /* ... */ };
  ```
  Output: `[{ date, grand_total, ...fieldLain }]` kontinu ascending.
- `summarizeBusiness` (`:753-758`): ganti filter trend ke
  `created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
  lalu `zeroFillDailySeries(..., monthStartIso, todayIsoServer)`.
- `/dashboard` `salesTrend` (`:925-930`): filter & zero-fill sama.
- Overview merge (`:810-819`): tetap jumlahkan per tanggal; karena kedua business sudah zero-fill ke window yang sama, hasil merge otomatis kontinu. Update komentar "7 hari" → "bulan berjalan".
- Helper ISO bulan-tanggal server di file ini: `toIso(new Date())` untuk today; untuk `DATE_TRUNC` hasil query gunakan `toIso` atas hasil `DATE_TRUNC('month', CURRENT_DATE)` atau bangun string dari `new Date()` konsisten dengan pola file (hindari drift from/to vs SQL).

### 2. `src/components/charts/TrendLineChart.jsx` (baru)
Komponen kecil shared, dipakai 3 dashboard:
- Props: `data: Array<{date: string, grand_total: number}>`, opsional `emptyLabel` (default "Belum ada data penjualan").
- Render recharts: `LineChart` + `Line` (stroke `#3b82f6` / ios-blue, `dot={false}` atau dot kecil), `Tooltip` format `formatCurrency`, `XAxis` tick `dd/MM` dengan thinned interval (`minTickGap` atau `interval="preserveStartEnd"` agar ~31 poin tidak tabrakan), `YAxis` tick compact (mis. `1,2jt`), `ResponsiveContainer` height ~192px (setara `h-48`).
- Empty state: bila `data.length === 0` **atau** semua `grand_total === 0` → tampilkan teks `emptyLabel` (pertahankan UX "belum ada penjualan"; jangan gambar garis datar tanpa data).
- Hindari komentar berlebih; ikuti gaya codebase.

### 3. `src/pages/Dashboard.jsx`
- **PrintDashboard**: `from = firstOfMonthIso()`, `to = todayIso()`; setelah `print-summary` ambil `rows`, zero-fill di frontend ke window tersebut (bisa import util kecil dari `TrendLineChart` file atau helper lokal — pilih satu tempat, mis. export `zeroFillDailySeries` dari modul chart/util). Card title → **"Pendapatan Bulan Ini"**; render `<TrendLineChart data={...} />`; hapus math `maxTrend`/bar yang tak terpakai.
- **MinimarketDashboard**: title → **"Tren Penjualan Bulan Ini"**; render `<TrendLineChart data={data.trend} />` (backend sudah zero-fill); hapus bar rendering & `maxTrend` bila tidak dipakai KPI lain.
- Import `firstOfMonthIso` di PrintDashboard.

### 4. `src/pages/OwnerDashboard.jsx`
- Title → **"Tren Gabungan Bulan Ini"**; `<TrendLineChart data={data.trend} />`; hapus bar & `maxTrend`.

### 5. `package.json`
- **Tanpa perubahan** bila recharts sudah terinstall. Hanya `npm install` bila `node_modules` belum punya (lockfile ikut ter-update bila perlu).

## Yang TIDAK berubah
- Endpoint CSV/laporan (`/reports/*` tab), tabel PrintReports, `top_products` (30 hari), KPI bulan/hari ini, query pembelian (APP_TIMEZONE).
- Route/guard izin dashboard.
- Zero-fill **tidak** ditambahkan ke `print-summary` backend.

## Validasi
1. `npm run lint` (0 warning), `npm run build`.
2. Rebuild **frontend + backend** (backend ikut berubah): `docker compose up -d --build frontend backend` (atau `--no-cache` bila perlu); hard-refresh.
3. Uji manual:
   - Minimarket (admin): dashboard → line chart "Tren Penjualan Bulan Ini", sumbu X berisi tanggal 1..hari ini; hari tanpa transaksi = titik di 0.
   - Owner mode `all`: "Tren Gabungan Bulan Ini" line gabungan minimarket+fotokopi.
   - Fotokopi: "Pendapatan Bulan Ini" line dari print-summary (hari kosong = 0).
   - Reset bulan: window selalu `1 bulan berjalan → hari ini` (cek query `DATE_TRUNC('month', CURRENT_DATE)` / `firstOfMonthIso()`); tanggal 1 = hanya 1 titik/empty state.
   - Laporan fotokopi (`/print-reports`): tabel/CSV tetap sparse (tanpa baris 0) — regresi zero-fill.
   - Mode minimarket/fotokopi lain tidak rusak (regresi).

## Risiko
- **Bundle**: recharts masuk bundle production (chunk >500kB sudah ada warning; dapat diterima).
- **Bentuk respon `/dashboard` & `/overview`**: `trend` kini kontinu (lebih banyak baris) — hanya dashboard yang mengonsumsi; pastikan tidak ada konsumen lain yang mengandalkan "hanya hari berjualan".
- **PrintSummary dipakai 2 tempat** — kesalahan zero-fill di backend akan merusak tabel laporan; jaga di frontend saja.
- Komponen chart baru dipakai 3 tempat — pastikan konsisten kosmetik (tinggi, warna, tooltip).

## Urutan eksekusi
1. Verifikasi `recharts` terinstall; `npm install` bila perlu.
2. Backend: helper zero-fill + ubah 2 query trend + komentar overview.
3. Buat `TrendLineChart.jsx`; wire 3 dashboard (termasuk `firstOfMonthIso` print).
4. `npm run lint` + `npm run build`; rebuild container frontend+backend; uji manual di atas.

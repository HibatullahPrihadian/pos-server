# Rencana: Export Laporan Bulanan PDF + Insight AI (kenari)

## Tujuan
Fitur export laporan penjualan **bulanan** berformat PDF untuk **Minimarket + Fotokopi**, tampilan dokumen mengikuti gaya **Invoice Grosir** (sheet A4 terang, accent bar brand, header toko, tabel gelap, recap total, terbilang, tanda tangan). PDF dihasilkan lewat **window.print() → "Save as PDF"** (pola yang sama dengan invoice grosir; tanpa library PDF baru). Insight naratif dihasilkan dari API **kenari.id** (OpenAI-compatible) dengan **cache per periode + fallback catatan bila gagal**.

## Keputusan desain (terkunci)
1. **Metode PDF**: sheet HTML + `window.print()` + `@media print` — sama seperti `InvoicePrint.jsx` / `Invoices.jsx`. Bukan jsPDF/Puppeteer.
2. **Isi laporan (Minimarket)**: header toko+periode → KPI (Penjualan, Transaksi, PPN, Laba Kotor, Laba Bersih, Retur) → **insight AI** → tabel penjualan harian → ringkasan laba rugi (mirroring `invoice-totals`) + beban per kategori → ringkasan per metode bayar → produk terlaris (top 10) → terbilang total + `receipt_footer` + blok tanda tangan.
3. **Isi laporan (Fotokopi)**: header+periode → KPI (Pendapatan, Pesanan Lunas, Rata-rata/pesanan, Jasa teratas) → **insight AI** → tabel penjualan harian → ringkasan per jasa (top) → recap total + terbilang + footer + tanda tangan. (Antrian queue tidak ikut; fokus pendapatan.)
4. **Periode**: memakai `from/to` yang sudah ada di halaman (default `firstOfMonthIso()` → `todayIso()`); judul dokumen menampilkan periode eksak. Tidak ada date-picker baru.
5. **AI = kenari.id**: `POST {KENARI_BASE_URL}/chat/completions` (default `https://kenari.id/v1`), OpenAI-compatible, model default **`mimo-v2-6-flash:free`** (pilihan user; env-overridable via `KENARI_MODEL`). **Key hanya di backend env** — tidak pernah di frontend/kode.
6. **Cache + fallback**: tabel `report_insights` UNIQUE(business, from_date, to_date). Generate saat preview pertama; buka lagi = cache instan; tombol **Regenerate** memaksa `refresh=1`. API gagal/key kosong/timeout → `content: null` + catatan "Insight AI tidak tersedia saat ini" di dokumen; bagian laporan lain tetap normal.
7. **Insight AI bukan sekadar data mentah**: prompt meminta narasi 4–6 poin Bahasa Indonesia yang membaca data (perbandingan vs periode sebelumnya dihitung server, hari tersibuk/terlemah, tren, mix metode bayar, top produk/jasa, rasio laba & PPN) — bukan rekap angka dobel.
8. **Sumber data laporan**: frontend reuses endpoint yang sudah ada (`/sales-summary`, `/profit-loss`, `/by-payment`, `/top-products` / `print-summary`, `print-top-services`) dengan query `{from,to}` — tidak ada endpoint laporan baru. Backend baru hanya **insight** + **tabel cache** + **client kenari**.
9. **Scope owner mode (`/overview`)**: di luar scope. PDF per-usaha di `/reports` (minimarket) dan `/print-reports` (fotokopi) saja.
10. **Keamanan key**: user menempelkan key di chat. Plan ini **tidak menulis nilai key**. Key diisi di `.env` host (sudah `.gitignore`), di-pass compose ke backend. Setelah setup, user disarankan **rotate key** (key pernah tampil di chat).

## Temuan kode (verifikasi)
- Invoice UI: `src/components/invoice/InvoicePrint.jsx` (206 baris; accent bar `#0a84ff/#64d2ff/#30d158`, sheet `210mm` padding `14mm 15mm`, `.invoice-*` CSS di `src/index.css:74–517`).
- Pola print portal: `Invoices.jsx` — preview Modal + `createPortal(<InvoicePrint print />)` + `body.invoice-printing` + `window.print()`; `@media print` menyembunyikan `#root`.
- CSV/export pola: `downloadFile` di `src/api/client.js` (auth + X-Business + blob). Halaman reports sudah punya date range default bulan-berjalan.
- Minimarket: `src/pages/Reports.jsx` (TABS, `exportCsv`, `report.view`). Fotokopi: `src/pages/PrintReports.jsx` (`print-summary`, `print-top-services`, `print.report`).
- Guard di `backend/routes/reports.js`: route fotokopi didaftarkan SEBELUM `router.use(requirePermission('report.view'))` (baris 138); route minimarket sesudahnya.
- Settings toko: `useSettings()` (`src/context/SettingsContext.jsx`) dipakai `Invoices.jsx` (`store_name`, alamat, NPWP, `receipt_footer`) — reuse untuk header laporan.
- Kenari docs (terverifikasi): base `https://kenari.id/v1`, `Authorization: Bearer kn-...`, `POST /v1/chat/completions` bentuk OpenAI; response `choices[0].message.content`; versi gratis memakai id akhiran `:free` (Rp 0, ada batas RPM/hari → HTTP 429). Model dipakai: `mimo-v2-6-flash:free` (dinamis — bila id tidak ada di `GET /v1/models`, ganti via env `KENARI_MODEL` tanpa ubah kode).
- Backend Node 20 (image `node:20-alpine`) → **global `fetch`**, tanpa npm baru. Backend `"type": "commonjs"`.
- Skema: `backend/init.sql` (`CREATE TABLE IF NOT EXISTS` + `ALTER ... IF NOT EXISTS`) hanya jalan di volume DB kosong; **tidak ada mekanisme migrasi runtime** selain `bootstrap.js` (ensure users). DB dev sudah berisi data → butuh ensure table saat server start.
- `.env` di-gitignore; `docker-compose.yml` mem-pass `${VAR}` ke backend (pola `JWT_SECRET` dsb.).

## Perubahan

### 1. Env & compose (tanpa key di git)
- `docker-compose.yml` backend service — tambah:
  - `KENARI_API_KEY: ${KENARI_API_KEY:-}`
  - `KENARI_BASE_URL: ${KENARI_BASE_URL:-https://kenari.id/v1}`
  - `KENARI_MODEL: ${KENARI_MODEL:-mimo-v2-6-flash:free}`
- `README`/dok lokal opsional: catat 3 varian env baru (jangan tulis nilai key).
- Implementer: minta user mengisi `.env` host `KENARI_API_KEY=<key kenari>`; **jangan commit key**.

### 2. Skema cache insight
- `backend/init.sql`: tambah
  ```sql
  CREATE TABLE IF NOT EXISTS report_insights (
    id SERIAL PRIMARY KEY,
    business VARCHAR(20) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    content TEXT NOT NULL,
    model VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business, from_date, to_date)
  );
  ```
- `backend/utils/bootstrap.js`: `ensureReportInsightsTable()` (CREATE TABLE IF NOT EXISTS, idempotent) dipanggil dari `server.js` bersama `ensureInitialUsers` — agar DB volume lama ikut punya tabel.

### 3. Backend: client kenari + helper insight
- **Baru** `backend/utils/kenari.js`:
  - `chatCompletion(messages, { maxTokens = 4000 })` → `fetch(${base}/chat/completions)`, header Bearer key, `temperature: 0.4`, `reasoning_effort: 'low'`, timeout `AbortController` ~60s. (Implementasi menaikkan dari 600/25s dan menambah `reasoning_effort`: model `mimo` reasoning — tanpa batas, penalaran menghabiskan 20–60s (timeout) atau seluruh `max_tokens` (`finish_reason=length` → `content` null → fallback terus-menerus). `reasoning_effort 'low'` menurunkan latensi ke ~5–15s; ceiling `max_tokens` 4000 mencegah `finish=length` (terbukti masih terjadi di 1600). Log `[kenari]` (tanpa key) di backend untuk diagnosis.)
  - Bila `KENARI_API_KEY` kosong / HTTP non-OK / throw → kembalikan `null` (tanpa log key).
- **Baru** `backend/utils/monthlyInsight.js`:
  - `buildInsightPayload({ pool, business, from, to })` — jalankan query ringkas:
    - Minimarket: total + daily dari pola `sales-summary` (completed), ringkas `gross_profit`/`net_profit`/expense, `by-payment`, `top-products` (5), + **periode sebelumnya** (range digeser mundur sepanjang durasi) untuk delta %.
    - Fotokopi: total + daily `print_orders` paid (pola print-summary), `print-top-services` (5) + periode sebelumnya.
    - Kirim agregat + deret harian ringkas (bukan seluruh row laporan) agar hemat token.
  - `getMonthlyInsight({ business, from, to, refresh })`:
    1. SELECT cache; bila ada & !refresh → return `{ content, model, cached: true }`.
    2. Build payload → `chatCompletion` system+user prompt (Bahasa Indonesia; output narasi 4–6 poin tanpa markdown berlebih).
    3. Sukses → UPSERT `report_insights` → return `{ content, model, cached: false }`.
    4. Gagal → return `{ content: null, reason: 'ai_unavailable' }` (**HTTP 200** agar frontend mudah; jangan 500).
  - Prompt system (ringkas, ditaruh di file ini): analis laporan toko; narasi praktis untuk pemilik; sebutkan perbandingan periode, hari tersimbol/terlemah, mix bayar/jasa, tren laba/PPN; angka dalam Rupiah; jangan mengarang angka di luar payload.

### 4. Backend: route insight di `backend/routes/reports.js`
- **Sebelum** guard `report.view` (blok fotokopi, sejajar `print-summary`):
  - `GET /print-monthly-insight?from=&to=&refresh=1` → `requirePermission('print.report', 'report.view')` → `getMonthlyInsight({ business: 'fotokopi', ... })`. `from/to` divalidasi `isValidDate`; default `resolveRange({})`.
- **Sesudah** `router.use(requirePermission('report.view'))`:
  - `GET /monthly-insight?from=&to=&refresh=1` → `getMonthlyInsight({ business: req.business, ... })`.
- Response keduanya: `{ from, to, content, model, cached, reason? }`. `business` dari konteks route (header X-Business), bukan query.

### 5. Frontend: komponen dokumen laporan
- **Baru** `src/components/reports/MonthlyReportPrint.jsx` — pola `InvoicePrint.jsx`:
  - Props: `business`, `report` (objek hasil perakitan), `settings`, `insight` (`{content, cached, reason}`), `print` (bool), `onRegenerate`.
  - Struktur: accent bar → `.report-head` (icon + `store_name` + alamat/telepon/NPWP | badge "LAPORAN BULANAN" + periode `formatDate(from) – formatDate(to)` + nama usaha + waktu generate) → KPI strip → kotak **Insight AI** (loading / narasi per paragraf / fallback note + chip "cached") → tabel harian (header gelap `#0f172a` gaya invoice) → recap laba rugi / ringkasan bayar·jasa → top produk/jasa → terbilang (`angkaTerbilang`) + `receipt_footer` + blok "Penerima" / "Hormat kami".
  - `print` mode: id `report-print-area` + class `report-print-area`.
- **Baru CSS** di `src/index.css` (mirror pola `.invoice-*`): `.report-sheet` (210mm, padding 14mm 15mm, font system stack, warna `#0f172a`), `.report-table`, `.report-kpi`, `.report-insight`, `#report-print-area` di `@media print` (visible, width 210mm, `print-color-adjust: exact`), `body.report-printing #root { display: none }`. Section tabel: `break-inside: avoid` bila muat; laporan boleh >1 halaman.

### 6. Frontend: tombol Export PDF di 2 halaman
- **`src/pages/Reports.jsx`** (minimarket):
  - Tombol `Export PDF` (ikon `FileDown`, sejajar `exportCsv`) → `exportPdf()`:
    1. `Promise.all` → `/api/reports/sales-summary`, `/profit-loss`, `/by-payment`, `/top-products` (limit 10) + `/api/reports/monthly-insight?from&to` — semua dengan `{ from, to }` state halaman.
    2. Set state preview (`report`, `insight`, `loading`), buka Modal xl (pola Modal di `Invoices.jsx`), render `<MonthlyReportPrint … />` + portal print area + `document.body.classList.toggle('report-printing', open)`.
    3. Tombol **Cetak / Simpan PDF** → `window.print()`.
    4. Tombol **Regenerate Insight** → refetch `/monthly-insight?…&refresh=1`, ganti state insight.
  - `settings` dari `useSettings()`. Toast bila fetch laporan gagal; insight gagal ≠ gagal preview.
- **`src/pages/PrintReports.jsx`** (fotokopi): pola sama — `/print-summary`, `/print-top-services` + `/print-monthly-insight`; label "Laporan Bulanan Fotokopi"; KPI/jasa sesuai section fotokopi.
- Tidak ada perubahan route/guard; tombol hanya muncul di halaman yang sudah terizinkan.

### 7. Tidak berubah
- Endpoint CSV/laporan existing; tabel `PrintReports` (sparse); dashboards; POS; invoice grosir; query `APP_TIMEZONE`/`purchases`; tanpa dependency npm baru; `package.json` frontend/backend tidak berubah.

## Risiko
- **Key bocor via chat**: key sudah tampil di chat — setelah `.env` terisi, user disarankan rotate key di dashboard kenari.
- **Kualitas narasi AI**: tergantung model/prompt; fallback catatan menjamin dokumen tetap bisa dicetak. `temperature 0.4`, `reasoning_effort: 'low'`, max 4000 token, timeout 60s (lihat catatan `maxTokens` di atas).
- **Model gratis `mimo-v2-6-flash:free`**: punya batas RPM/hari (429) dan best-effort lane — kecepatan tidak dijamin; 429/timeout = fallback note. Ganti ke model berbayar kapan saja lewat env `KENARI_MODEL` (tanpa ubah kode).
- **Latensi preview pertama** (5–30s): loading state di Modal insight; cache membuat buka berikutnya instan.
- **Volume DB lama tanpa tabel `report_insights`**: ditangani `ensureReportInsightsTable` saat server start (idempoten, pola bootstrap users).
- **Panjang dokumen**: tabel harian 31 baris + beberapa seksi bisa >1 halaman A4 — dapat diterima untuk print; jangan paksa 1 halaman.
- **Egress container backend → kenari.id**: perlu internet dari container; gagal = fallback note (bukan crash).
- **Pemakaian token**: tiap (usaha, periode, regenerate) = 1 call; cache membatasi biaya.

## Validasi
1. `npm run lint` (0 warning) + `npm run build`.
2. Isi `.env`: `KENARI_API_KEY=<key dari user>` (jangan commit); `docker compose up -d --build backend frontend`. Pastikan log backend start normal; `report_insights` terbentuk (`docker compose exec postgres psql -U postgres -d pos_minimarket -c '\d report_insights'`).
3. Uji manual:
   - Minimarket (admin, `/reports`): `Export PDF` → preview A4 gaya invoice; insight muncul (first load menunggu AI); `Cetak` → dialog → Save as PDF → dokumen berwarna accent, tabel, terbilang.
   - Buka lagi → insight instan (chip cached); `Regenerate` → narrative baru + row cache ter-update.
   - Fotokopi (`/print-reports`, izin print.report): preview laporan fotokopi + insight print.
   - Periode: default bulan berjalan; ganti date input → dokumen menampilkan periode baru; insight cache per periode berbeda.
   - Gagal AI (salah key sementara / tanpa internet): preview tetap terbuka, kotak insight menampilkan "Insight AI tidak tersedia saat ini", laporan lain normal.
   - Regresi: CSV Reports & PrintReports tetap; tabel PrintReports sparse; dashboard minimarket/fotokopi & invoice grosir tidak berubah.
   - Hak akses: kasir tanpa `report.view`/`print.report` tidak melihat tombol.

## Urutan eksekusi
1. `.env` + compose env `KENARI_*` (key diisi user, tidak di git).
2. Skema: `init.sql` + `ensureReportInsightsTable` di bootstrap/server.
3. Backend: `utils/kenari.js` → `utils/monthlyInsight.js` → route `/monthly-insight` + `/print-monthly-insight` di `reports.js`.
4. Frontend: CSS `.report-*` → `MonthlyReportPrint.jsx` → wire `Reports.jsx` → wire `PrintReports.jsx`.
5. `npm run lint` + `npm run build`; rebuild backend+frontend; uji manual di atas.

## Catatan implementer
- Jangan menaruh nilai API key di file apa pun selain `.env` (gitignored) — termasuk plan/README/log.
- Prompt & payload insight ditulis sekali di `monthlyInsight.js` agar konsisten minimarket/fotokopi (prefix payload berbeda, gaya narasi sama).
- Komponen laporan meniru visual invoice (light sheet, tabel gelap, accent bar) — jangan pakai tema gelap app di area cetak.

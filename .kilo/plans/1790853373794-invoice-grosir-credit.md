# Rencana: Invoice Generator Grosir (B2B) dengan Jatuh Tempo & Piutang

## Tujuan
Menambahkan fitur **invoice grosir untuk pelanggan B2B** yang bisa **bayar belakangan (kredit)** dengan **jatuh tempo yang dapat diatur**, pencatatan **pembayaran bertahap**, halaman **daftar piutang**, dan **cetak invoice A4**.

## Keputusan terkunci
1. **Diterbitkan dari POS**: kasir jual grosir seperti biasa (scan/pilih barang), lalu pilih pelanggan grosir + termin; transaksi disimpan sebagai **penjualan kredit** (stok berkurang, piutang timbul, belum ada kas diterima).
2. **Pelanggan B2B tabel baru terpisah** (`customers`): nama/perusahaan, kontak, alamat, NPWP, **termin default**, limit kredit (opsional).
3. **Jatuh tempo**: preset termin (Tunai/Net 7/14/30/60) + tanggal bebas per invoice; default dari pelanggan. Plus **peringatan jatuh tempo** (daftar invoice jatuh tempo/lewat jatuh tempo, KPI dashboard).
4. **Pembayaran bertahap + status piutang**: partial payment, status `unpaid`/`partial`/`paid`/`overdue`; halaman daftar piutang.
5. **Kas**: invoice kredit **tidak** menambah kas/expected_cash shift; pembayaran piutang dicatat **terpisah** dari shift kasir.
6. **Halaman "Invoice Grosir"** terpisah dari Transaksi (daftar, filter belum lunas/lewat jatuh tempo, catat pembayaran, cetak).
7. **Cetak invoice A4** via `window.print()` (kop toko, data pelanggan, item, total, jatuh tempo, catatan).

## Keputusan teknis penting
- **Jangan** mengubah alur checkout kas normal secara berisiko. Alih-alih menyisipkan logika kredit yang rumit ke `POST /sales`, buat **endpoint checkout kredit terpisah** `POST /api/invoices` yang **menggunakan ulang** util yang ada (`resolveItemsEffectivePricing`, `allocateFefo`, `applyStockMovement`, `nextDocNumber`, `extractTax`, `pointsEarned`). Ini menjaga alur POS tunai tetap stabil dan memberi struktur data piutang yang bersih.
- **Satu transaksi (sale) bisa kredit**: tambahkan penanda di `sales` (`is_credit`, `customer_id`, `due_date`) ATAU simpan invoice grosir di tabel sendiri. **Rekomendasi: tabel `invoices` + `invoice_items` terpisah** yang menyalin pola `sales`, agar laporan penjualan tunai tidak tercampur dan piutang punya siklus hidup sendiri. Namun stok tetap keluar via `stock_movements` dengan `ref_type='invoice'`.
  - **Konsekuensi**: penjualan grosir kredit **tidak** muncul di laporan penjualan POS `sales` kecuali kita ikut menghitungnya. **Alternatif lebih terpadu**: simpan sebagai `sales` dengan `status` baru `'credit'` + tabel `invoice_payments`. **Rekomendasi final: perluas `sales`** (kolom `customer_id`, `due_date`, `payment_status`, `is_credit`) + tabel `invoice_payments` + halaman Invoice Grosir membaca `sales WHERE is_credit = TRUE`. Ini membuat laporan penjualan & laba **otomatis mencakup grosir**, tanpa duplikasi logika stok.
  - Ringkas: **perluas `sales`** (bukan tabel baru) untuk penjualan grosir kredit; tambah tabel `customers` + `invoice_payments`.

> Catatan: keputusan ini dipilih agar stok, HPP, laba, dan batch FEFO **konsisten** (semua lewat jalur `sales` yang sudah teruji), sementara piutang dikelola lewat kolom status + tabel pembayaran.

## Skema (`backend/init.sql`, idempotent)

```sql
-- Pelanggan grosir/B2B
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,        -- CUST-0001
    name VARCHAR(150) NOT NULL,              -- nama perusahaan/toko pelanggan
    contact_name VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(120),
    address TEXT,
    npwp VARCHAR(50),
    payment_term_days INTEGER NOT NULL DEFAULT 0,  -- 0 = tunai; 30 = Net 30
    credit_limit BIGINT NOT NULL DEFAULT 0,        -- 0 = tanpa batas
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Perluasan sales untuk penjualan kredit/grosir
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_credit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(10) NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
-- status 'completed'/'void' tetap; kredit memakai status='completed' + is_credit=TRUE.

-- Pembayaran cicilan invoice (terpisah dari sale_payments yang untuk kas shift)
CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    method VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'qris', 'debit', 'transfer')),
    reference VARCHAR(100),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id INTEGER REFERENCES users(id),
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_due_date ON sales (is_credit, due_date);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_sale ON invoice_payments (sale_id);
```

Migrasi data lama: `sales` lama otomatis `is_credit=FALSE`, `payment_status='paid'` (default) — aman.

## Backend

### 1. `backend/utils/customers.js` (opsional) atau di route
- `nextCustomerCode(client)`: `CUST-0001` (pola `nextMemberCode`, `members.js:12-18`).

### 2. `backend/routes/customers.js` (baru)
- CRUD pelanggan grosir (`requirePermission('customer.manage')` untuk tulis; GET `customer.view`).
- `GET /customers`, `GET /customers/:id`, `POST/PUT`, `PUT /:id/deactivate`.
- `GET /customers/:id/statement` (opsional): daftar invoice + total piutang.

### 3. Checkout kredit: `POST /api/sales` diperluas (`sales.js`)
- Terima field opsional: `customer_id`, `is_credit`, `payment_term_days`/`due_date`.
- Bila `is_credit = true`:
  - Wajib `customer_id` valid & aktif.
  - `payments` boleh kosong (kredit penuh) — skrip validasi pembayaran saat ini (`sales.js:51-58`) harus dilonggarkan **hanya bila is_credit** (mis. `payments` opsional; bila ada, dianggap uang muka).
  - `due_date` = `payment_term_days` dari pelanggan (atau override dari body) → `CURRENT_DATE + N hari`.
  - Simpan `is_credit=TRUE, customer_id, due_date`, `paid_amount` = jumlah DP (biasanya 0), `payment_status` = `unpaid`/`partial`.
  - **Tidak** menambah baris `sale_payments` bila tidak ada pembayaran (sehingga kas shift tidak terpengaruh, `shifts.js:25-31`).
  - Cek **limit kredit** (opsional): total piutang berjalan pelanggan + grand_total ≤ `credit_limit` (bila limit > 0), jika tidak → 400 dengan pesan jelas.
- Bila `is_credit = false`: perilaku persis seperti sekarang (cash).
- **Gunakan permission**: checkout POS tetap `pos.use`; untuk kredit grosir tambahkan `invoice.manage` (lihat daftar izin baru) agar tidak semua kasir bisa memberi kredit.

### 4. `backend/routes/invoices.js` (baru) — modul piutang
- `GET /invoices`: daftar invoice kredit (`sales WHERE is_credit=TRUE`), filter: periode, `customer_id`, `payment_status`, `overdue_only` (due_date < hari ini & belum lunas), search kode/invoice.
- `GET /invoices/:id`: detail + item + riwayat `invoice_payments` + sisa tagihan.
- `POST /invoices/:id/payments` (`invoice.manage`): catat pembayaran cicilan.
  - Validasi: `amount > 0`, tidak melebihi sisa; update `sales.paid_amount` & `payment_status` (unpaid→partial→paid).
  - Metode: `cash`/`qris`/`debit`/`transfer`. **Atur apakah pembayaran tunai piutang masuk shift**: sesuai keputusan, **terpisah**; simpan `paid_at` + `user_id`, tidak di `sale_payments`.
- `PUT /invoices/:id/void` (opsional, `invoice.manage`): batalkan invoice kredit & kembalikan stok (mengikuti pola void sale yang ada). Bila tidak perlu, cukup lewati.
- `GET /invoices/summary`: ringkasan piutang (total belum lunas, jumlah invoice, total lewat jatuh tempo) untuk dashboard.

### 5. `backend/routes/reports.js` — piutang & penjualan grosir
- Tambah KPI dashboard: `receivable_total` (piutang belum lunas), `receivable_overdue` (lewat jatuh tempo), `receivable_count`.
- (Opsional) `GET /reports/receivables`: laporan piutang per pelanggan + aging (belum jatuh tempo, 1–30, 31–60, >60 hari).
- Penjualan kredit **sudah** ikut di laporan penjualan/laba karena tersimpan di `sales`. Pastikan query laporan penjualan **memasukkan** `is_credit=TRUE` (default: ya, karena status `completed`) — verifikasi agar tidak terlewat.

### 6. `server.js`
- Mount `/api/customers` dan `/api/invoices`.
- `assertFeatureSchema`: cek tabel `customers`, `invoice_payments`, kolom `sales.{customer_id,is_credit,due_date,paid_amount,payment_status}`.

### 7. `backend/utils/permissions.js`
- Tambah permission baru: `customer.manage` (kelola pelanggan grosir), `invoice.manage` (terbitkan invoice kredit & catat pembayaran), `invoice.view` (lihat piutang).
- Preset: `admin` semua; `kasir` → `invoice.view` (lihat) bila perlu, tapi `invoice.manage` **tidak** (memberi kredit = keputusan pemilik) — **keputusan**: beri `invoice.manage` ke admin & gudang? Rekomendasi: hanya admin & user yang diberi khusus. `gudang` tidak.

## Frontend

### 1. POS (`src/pages/POS.jsx`)
- Di modal pembayaran (`payOpen`), tambah opsi **"Jual Kredit (Grosir)"** (toggle) yang muncul bila user punya `invoice.manage`.
  - Saat aktif: pilih **Pelanggan Grosir** (dropdown dari `/api/customers`), pilih **Termin** (Tunai/Net 7/14/30/60 atau tanggal bebas), dan pembayaran menjadi opsional (DP).
  - Validasi klien ringan; server tetap penentu.
- Tampilkan badge "KREDIT" pada keranjang/konfirmasi.

### 2. Halaman baru `src/pages/Customers.jsx` (`customer.manage`)
- CRUD pelanggan grosir (nama, kontak, alamat, NPWP, termin default, limit kredit).

### 3. Halaman baru `src/pages/Invoices.jsx` (`invoice.view`)
- Daftar invoice grosir: filter status (belum lunas/sebagian/lunas/lewat jatuh tempo), periode, pelanggan, cari kode.
- Aksi: **Detail**, **Catat Pembayaran** (modal cicilan), **Cetak Invoice**, (opsional Void).
- Kartu ringkasan: Total Piutang, Lewat Jatuh Tempo, Jumlah Invoice.
- Ekspor CSV.

### 4. Cetak invoice A4
- Komponen `src/components/invoice/InvoicePrint.jsx` (kop toko dari `settings`, data pelanggan, tabel item, subtotal/diskon/PPN/total, DP, sisa tagihan, jatuh tempo, catatan, tanda tangan).
- CSS cetak baru di `src/index.css`: `#invoice-print-area` (pola `#receipt-print-area`, `index.css:74-115`), ukuran A4.

### 5. Dashboard (`src/pages/Dashboard.jsx`)
- KPI baru **"Piutang Grosir"** (total belum lunas) + sub "Lewat jatuh tempo: Rp…", dapat diklik ke `/invoices`.

### 6. Routing & menu
- `src/App.jsx`: tambah `/customers` (`permission="customer.manage"`), `/invoices` (`permission="invoice.view"`).
- `src/components/layout/Sidebar.jsx`: tambah menu **Pelanggan Grosir** & **Invoice Grosir** (kelompok Penjualan/Admin) dengan izin terkait.

## Yang TIDAK berubah
- Alur checkout tunai POS tetap sama (kredit hanya jalur tambahan saat `is_credit=true`).
- `shifts.js` tidak diubah kecuali perlu memastikan kredit tidak masuk `expected_cash` (sudah aman karena berbasis `sale_payments`).
- Batch FEFO, HPP, poin, tier/promo tetap dipakai untuk item grosir.

## Urutan Eksekusi
1. `init.sql`: tabel `customers`, `invoice_payments`, ALTER `sales`.
2. `utils/permissions.js`: permission baru + preset.
3. `routes/customers.js` (baru) + `routes/invoices.js` (baru).
4. `sales.js`: dukung checkout kredit (validasi, due_date, DP, limit kredit).
5. `reports.js`: KPI piutang (+ opsional laporan aging).
6. `server.js`: mount + `assertFeatureSchema`.
7. Frontend: POS (kredit), `Customers.jsx`, `Invoices.jsx`, cetak invoice, Dashboard KPI, routing & sidebar.
8. Verifikasi.

## Validasi
- `npm run lint` (0 warning), `npm run build`, `cd backend && npm run check`; rebuild **frontend + backend** + migrasi `init.sql` + hard-refresh.
- Uji manual:
  1. Buat pelanggan grosir (termin Net 30) → muncul di dropdown POS.
  2. POS: aktifkan "Jual Kredit", pilih pelanggan, checkout → penjualan tersimpan **kredit**, stok berkurang, **kas shift tidak bertambah**.
  3. Invoice muncul di halaman **Invoice Grosir** dengan status **Belum Bayar** & jatuh tempo = hari ini + 30.
  4. Catat pembayaran sebagian → status **Sebagian**, sisa berkurang.
  5. Catat pelunasan → status **Lunas**; tidak bisa bayar melebihi sisa.
  6. Invoice lewat jatuh tempo → muncul di filter **Lewat Jatuh Tempo** & KPI dashboard.
  7. Cetak invoice A4 → tampil rapi (kop, pelanggan, item, total, DP, sisa, jatuh tempo).
  8. Uji limit kredit (bila diisi) → checkout kredit melebihi limit ditolak.
  9. Laporan penjualan/laba **mencakup** penjualan grosir; rekap shift tetap benar (kas hanya dari penjualan tunai).
  10. Uji izin: user tanpa `invoice.manage` tidak bisa menerbitkan kredit (403 & opsi tersembunyi).

## Risiko
- **Ekspansi `sales`**: menambah kolom + status kredit berisiko menyentuh laporan/void/retur yang mengasumsikan `payment_status='paid'`. Mitigasi: default `payment_status='paid'`, `is_credit=FALSE` untuk data lama; audit semua pembaca `sales` (`reports.js`, `shifts.js`, `returns.js`, `sales.js` void).
- **Void/retur invoice kredit**: perlu perlakuan khusus (stok kembali, piutang dibatalkan). Bila tidak masuk cakupan awal, batasi void hanya untuk admin dan dokumentasikan.
- **Pembayaran piutang & kas**: harus konsisten — pembayaran piutang **tidak** masuk `sale_payments` agar tidak menggandakan kas shift; catat di `invoice_payments`.
- **Poin & member**: kredit biasanya untuk pelanggan B2B (tanpa member/poin). Putuskan: grosir **tidak** memberi poin (rekomendasi), agar tidak tercampur.
- **Migrasi DB berjalan**: jalankan `init.sql` idempotent pada volume existing.

## Pertanyaan terbuka
1. **Poin/DP**: apakah invoice kredit boleh memberi poin member (rekomendasi: **tidak**), dan apakah uang muka (DP) diperbolehkan saat terbit (rekomendasi: **ya**, opsional)?
2. **Void/retur invoice kredit**: masuk cakupan awal (batasi admin) atau ditunda?
3. **Limit kredit**: ditegakkan (blokir bila melebihi) atau sekadar peringatan?
4. **Pembayaran tunai piutang**: apakah harus masuk kas shift kasir yang sedang bertugas (bila ya, perlu penyesuaian `shifts.js`), atau selalu dicatat terpisah (rekomendasi: **terpisah** sesuai keputusan)?

## Catatan implementasi
Mengubah skema DB (`sales`, tabel baru), menambah 2 route baru, memperluas `sales.js`/`reports.js`/permissions, dan menambah beberapa halaman frontend + cetak invoice. Butuh rebuild **frontend + backend** dan migrasi `init.sql`. Eksekusi oleh agent mode code.

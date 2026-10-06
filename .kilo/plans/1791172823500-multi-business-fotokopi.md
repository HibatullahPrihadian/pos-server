# Rencana: Multi-Usaha (Minimarket + Fotokopi) dalam Satu Aplikasi & Satu Database

## Tujuan
Menjadikan aplikasi POS ini menangani **dua jenis usaha** — **minimarket** dan **fotokopi** — dalam **satu aplikasi, satu database, satu web**. Setelah login, muncul **pilihan mode usaha**; **owner** bisa memantau keduanya, **staf** terikat satu usaha. Modul fotokopi mencakup **jasa cetak**, **pesanan/antrian**, **kalkulator harga otomatis**, dan pembayaran.

## Keputusan terkunci
- **Satu app, satu DB, dua modul usaha**, dipisah lewat **kolom `business`** pada tabel yang dipakai bersama.
- **Setelah login muncul pilihan mode** (Minimarket / Fotokopi). Owner bisa berpindah mode (tombol "Ganti Usaha"); staf langsung ke usaha yang ditetapkan padanya.
- **Jasa & pesanan punya tabel sendiri** (`print_services`, `print_orders`, `print_order_items`), terpisah dari `products` minimarket.
- **UI disamakan** dengan POS minimarket sekarang (design system yang ada: Card, Table, Modal, Button, dsb.).
- **Fase 1 = fondasi multi-usaha + inti fotokopi** (master jasa, buat pesanan + kalkulator, antrian/status, bayar, cetak nota, laporan dasar fotokopi).
- Data lama otomatis dianggap **minimarket** (default `business='minimarket'`).

## Prinsip: minimarket tidak boleh rusak
Aplikasi minimarket sudah dipakai. Maka:
- Semua kolom baru bersifat **`ADD COLUMN IF NOT EXISTS ... DEFAULT 'minimarket'`** (idempoten, data lama aman).
- Filter `business` ditambahkan **hanya pada query yang relevan**, dengan **default 'minimarket'** saat mode belum diset (agar perilaku lama identik).
- Modul fotokopi memakai **tabel terpisah**, bukan mengubah struktur `products`/`sales` untuk jasa.
- Verifikasi regresi minimarket wajib sebelum selesai.

## Model data

### A. Fondasi `business`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS business VARCHAR(20)` (NULL = lintas usaha, dipakai owner/admin).
- Kolom `business` pada tabel bersama yang perlu dipisah:
  - `products`, `categories`, `suppliers`, `customers`, `members`, `promotions`, `bundles`, `expenses`, `expense_categories`, `stock_movements`, `stock_opnames`, `purchases`, `shifts`, `sales`, `expenses`.
  - Semua `DEFAULT 'minimarket'`.
- `store_settings`: karena berbasis satu baris (`id=1`), **pisahkan per usaha** → tambah tabel `store_settings_business(business, ...)` ATAU ubah PK menjadi `(id, business)`. Rekomendasi: tabel baru `business_settings (business PK, store_name, address, phone, npwp, tax_rate, ..., invoice_prefix, receipt_footer)` dan pertahankan `store_settings` lama sebagai default minimarket (kompatibel).
- Helper backend `req.business`: dari header/klaim mode aktif (lihat Auth).

### B. Modul fotokopi (tabel baru)
```sql
CREATE TABLE IF NOT EXISTS print_services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,            -- mis. "Fotokopi A4 Hitam Putih"
    category VARCHAR(50),                  -- fotokopi/print/scan/laminating/jilid
    paper_size VARCHAR(20),                -- A4/F4/Legal/... (opsional)
    color_mode VARCHAR(10),                -- bw/color
    price_per_page BIGINT NOT NULL DEFAULT 0,   -- harga per halaman (lembar/sisi)
    price_per_sheet BIGINT NOT NULL DEFAULT 0,  -- alternatif harga per lembar
    min_qty INTEGER NOT NULL DEFAULT 1,
    bundle_price BIGINT,                   -- mis. harga paket N lembar
    bundle_qty INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_orders (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,      -- PRN-YYYYMMDD-NNNN
    queue_no INTEGER,                      -- nomor antrian harian
    customer_id INTEGER REFERENCES customers(id),
    customer_name VARCHAR(150),            -- bila tanpa master pelanggan
    status VARCHAR(15) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','processing','ready','picked_up','cancelled')),
    notes TEXT,
    -- Hasil kalkulasi harga (disimpan agar nota & laporan stabil)
    subtotal BIGINT NOT NULL DEFAULT 0,
    discount BIGINT NOT NULL DEFAULT 0,
    tax_total BIGINT NOT NULL DEFAULT 0,
    grand_total BIGINT NOT NULL DEFAULT 0,
    paid_amount BIGINT NOT NULL DEFAULT 0,
    payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid','partial','paid')),
    sale_id INTEGER REFERENCES sales(id),  -- terisi saat dibayar (menyatu ke kas/laporan)
    shift_id INTEGER REFERENCES shifts(id),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
    service_id INTEGER REFERENCES print_services(id),
    description VARCHAR(200),
    pages INTEGER NOT NULL DEFAULT 1,      -- jumlah halaman
    copies INTEGER NOT NULL DEFAULT 1,     -- jumlah rangkap
    sides VARCHAR(10) NOT NULL DEFAULT 'single' CHECK (sides IN ('single','double')),
    paper_size VARCHAR(20),
    color_mode VARCHAR(10),
    unit_price BIGINT NOT NULL DEFAULT 0,
    qty INTEGER NOT NULL DEFAULT 1,        -- total lembar dihitung
    line_total BIGINT NOT NULL DEFAULT 0
);
```

- **Kalkulator harga**: `lembar = CEIL(pages / (sides==='double'?2:1)) * copies`; `line_total = lembar * price_per_sheet` (atau `pages*copies*price_per_page`). Bila `bundle_price` ada dan qty mencapai `bundle_qty`, pakai harga paket. Semua dihitung **di server**.
- Pembayaran pesanan membuat **`sales`** (mode fotokopi) dengan item merujuk jasa (via `print_order_items`), sehingga otomatis masuk laporan penjualan/laba/kas shift. Simpan `print_orders.sale_id`.

## Backend

### 1. Auth & sesi multi-usaha
- `users.business` (NULL = semua). Login mengembalikan `available_businesses` (mis. `['minimarket','fotokopi']` untuk owner; satu untuk staf).
- Mode aktif dikirim klien lewat **header `X-Business`** (atau klaim di token saat pilih mode). Middleware `resolveBusiness` menetapkan `req.business` (default `'minimarket'` bila tak dikirim → kompatibel).
- Staff yang mencoba akses usaha di luar `users.business` → 403.

### 2. `routes/print_services.js` (baru) — master jasa
- CRUD (`permission` baru: `print.manage`), GET untuk kasir (`print.use`).

### 3. `routes/print_orders.js` (baru) — pesanan & antrian
- `POST /print-orders`: buat pesanan (pilih pelanggan/nama, item jasa + pages/copies/sides/size/color). Server menghitung harga & mengembalikan total. Nomor antrian harian via `nextDocNumber(client,'PRN')` + `queue_no` (counter harian).
- `GET /print-orders`: filter status/tanggal/pelanggan; dukung `?status=queued,processing`.
- `GET /print-orders/:id`: detail + item + status bayar.
- `PUT /print-orders/:id`: ubah (hanya bila belum dibayar).
- `PUT /print-orders/:id/status`: ubah status (`queued→processing→ready→picked_up`, atau `cancelled`).
- `POST /print-orders/:id/pay`: catat pembayaran → **buat `sales` mode fotokopi** (satu baris per item jasa) + `sale_payments`, set `sale_id`, `payment_status='paid'`. Masuk shift & kas seperti penjualan biasa.
- `GET /print-orders/queue`: daftar antrian aktif (untuk layar operator).

### 4. Filter `business` pada modul minimarket yang dipakai bersama
- Tambah `AND business = $n` (default `'minimarket'`) pada query: `products`, `categories`, `sales`, `shifts`, `purchases`, `stock*`, `expenses`, `customers`, `members`, `promotions`, `bundles`, `reports`.
- **Hati-hati**: tambahkan dengan cara yang menjaga perilaku lama saat `business` tak dikirim (default minimarket). Uji regresi menyeluruh.

### 5. `reports.js`
- Laporan/dashboard **difilter per mode aktif**.
- (Fase 1) Tambah laporan fotokopi dasar: penjualan jasa harian/periode, layanan terpopuler, status antrian.
- (Opsional fase lanjut) Dashboard **gabungan lintas usaha** untuk owner.

### 6. `server.js`
- Mount `print_services`, `print_orders`. `assertFeatureSchema`: cek tabel `print_services/print_orders/print_order_items`, kolom `business`, `business_settings`.

## Frontend

### 1. Pemilihan mode usaha
- **Setelah login** (owner & multi-usaha): halaman/modal **pemilih mode** (Minimarket / Fotokopi), ikon + warna berbeda. Simpan mode aktif di `localStorage` + state; kirim via header `X-Business` di `api/client.js`.
- Staf dengan satu usaha: langsung masuk, tanpa pemilih.
- **Tombol "Ganti Usaha"** di Topbar/Sidebar untuk owner → kembali ke pemilih.

### 2. Routing & menu per mode
- `BusinessContext` baru (mode aktif + daftar mode tersedia + `setBusiness`).
- Sidebar menampilkan menu sesuai mode:
  - **Minimarket**: seperti sekarang.
  - **Fotokopi**: Dashboard, **Pesanan/antrian** (`/print-orders`), **Buat Pesanan** (`/print-orders/new`), **Master Jasa** (`/print-services`), Kasir/POS fotokopi (opsional, atau pesanan-lah yang jadi "kasir"), Laporan fotokopi, Pengaturan usaha.

### 3. Halaman inti fotokopi (UI = design system yang ada)
- `PrintServices.jsx` (master jasa, admin).
- `PrintOrders.jsx` (daftar/antrian; filter status; badge warna status; tombol ubah status & bayar).
- `PrintOrderForm.jsx` (buat pesanan: pilih pelanggan/nama, tambah item jasa, **kalkulator otomatis** menampilkan lembar & harga, total; simpan → tampil nomor antrian).
- `PrintReceipt`/nota (bisa pakai pola struk; menampilkan nomor antrian + rincian + status).
- Laporan fotokopi.

### 4. Izin baru (`utils/permissions.js`)
- `print.use`, `print.manage`, `print.report` (opsional). Preset: `admin` semua; tambah role/usulan `operator` (fotokopi) bila perlu.

## Urutan Eksekusi (Fase 1)
1. `init.sql`: kolom `business` (+ `users.business`), tabel `business_settings`, `print_services`, `print_orders`, `print_order_items`.
2. `utils/permissions.js`: izin `print.*`.
3. Middleware `resolveBusiness` + `req.business`; `auth.js` kembalikan `available_businesses`.
4. `routes/print_services.js`, `routes/print_orders.js` (kalkulator + antrian + pay→sale).
5. Tambah filter `business` pada modul bersama (default minimarket; uji regresi).
6. `reports.js`: laporan fotokopi dasar.
7. `server.js`: mount + `assertFeatureSchema`.
8. Frontend: `BusinessContext`, pemilih mode setelah login, header `X-Business`, Sidebar per mode, `PrintServices`, `PrintOrders`, `PrintOrderForm`, nota, laporan.
9. Verifikasi.

## Validasi
- `npm run lint`, `npm run build`, `cd backend && npm run check`; rebuild frontend+backend; migrasi `init.sql`; hard-refresh.
- Uji:
  1. Login owner → muncul pilihan **Minimarket/Fotokopi**; pilih Fotokopi → hanya menu fotokopi.
  2. Buat master jasa (Fotokopi A4 BW Rp300/lembar; Print warna Rp1.000/lembar).
  3. Buat pesanan: 10 halaman, 2 rangkap, bolak-balik → lembar = 10/2*2 = **10 lembar**; harga otomatis benar; nomor antrian muncul.
  4. Ubah status `queued→processing→ready→picked_up`.
  5. Bayar pesanan → membuat `sales`, kas shift bertambah, status `paid`.
  6. Laporan fotokopi menampilkan penjualan jasa & layanan terpopuler.
  7. **Regresi minimarket**: login mode minimarket → semua fitur lama (POS, stok, pembelian, laporan, invoice grosir) berjalan identik; data lama tetap ada.
  8. Staf fotokopi tidak bisa akses mode minimarket (403) dan sebaliknya.
  9. Ganti usaha (owner) berpindah mode tanpa logout.

## Risiko
- **Blast radius filter `business`** menyentuh banyak query inti → risiko regresi minimarket. Mitigasi: default `'minimarket'`, kolom idempoten, uji regresi menyeluruh, kerjakan bertahap.
- **Store settings per usaha**: perlu keputusan struktur (tabel baru vs PK berubah).
- **Pembayaran pesanan → `sales`**: `sale_items.product_id` NOT NULL → item jasa tak punya produk. Mitigasi: relaksasi `sale_items` (product_id nullable, + `service_id`) **atau** buat produk "virtual" per jasa. Rekomendasi: **tambah kolom `service_id`** + `product_id` nullable (pola sama seperti `bundle_id` yang sudah nullable).
- **Shift lintas usaha**: `shifts` perlu kolom `business`; pastikan kas shift terpisah per usaha (tidak tercampur).
- **Migrasi DB berjalan** (volume existing): jalankan `init.sql` idempotent.

## Pertanyaan terbuka
1. **Store settings**: tabel `business_settings` baru (rekomendasi) atau ubah PK `store_settings`?
2. **Pembayaran Fotokopi**: lewat `sales` (rekomendasi, agar laporan/kas menyatu) atau tabel pembayaran `print_orders` sendiri (lebih terisolasi)?
3. **Kasir fotokopi**: cukup dari halaman **Pesanan** (buat → bayar) atau perlu layar POS khusus fotokopi?
4. **Owner dashboard gabungan** lintas usaha: Fase 1 atau Fase 2? (Rekomendasi: Fase 2.)
5. **Role operator fotokopi** baru (mis. `operator` dengan preset izin `print.*`) atau cukup pakai `kasir` + izin `print.*`?

## Catatan implementasi
Ini perubahan besar (skema DB, auth, banyak query inti, 2 route baru, beberapa halaman frontend). Eksekusi bertahap oleh agent mode code, wajib rebuild frontend+backend + migrasi `init.sql`, dan uji regresi minimarket.

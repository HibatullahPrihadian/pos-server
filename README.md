# POS Minimarket

Aplikasi web Point of Sale (POS) untuk 1 toko retail minimarket. Diakses lewat browser di LAN (komputer kasir + perangkat admin).

Referensi pola arsitektur: `/Users/ibet/Documents/Antigravity/Tracker` (React + Vite + Tailwind / Express / PostgreSQL / Docker Compose).

---

## 1. Fitur

**Kasir & Penjualan**
- Login role **admin**, **kasir**, & **gudang** (bcrypt + JWT) dengan **izin granular per user** (lihat §6a)
- Scan barcode via **scanner USB** (input keyboard) atau **kamera HP** (butuh HTTPS, lihat §4) — di POS, Produk, Pembelian, dan Stok
- Pencarian produk (tata letak POS 1 kolom: bar scan/pencarian di atas, keranjang penuh, ringkasan TOTAL + Bayar *sticky* di bawah)
- Multi-satuan per produk (pcs/dus/karton) dengan faktor konversi
- **Multibarcode**: satu produk/satuan boleh punya beberapa barcode
- **Harga partai bertingkat** (harga grosir per qty) dan **promo periode** otomatis (produk/kategori, jam/hari/tanggal, tipe persen/nominal/harga batch). Server memilih **harga efektif termurah** dari tier/promo/member
- Diskon manual per item & per transaksi
- Harga khusus member + poin (earn & redeem)
- **Paket bundling**: jual satu paket harga tetap, stok tiap komponen berkurang otomatis; ada **generate barcode EAN-13** + **cetak label** barcode paket
- Pembayaran Tunai / QRIS / Debit / Transfer, termasuk **split payment**
- QRIS statis toko (gambar diunggah di Pengaturan, konfirmasi manual kasir)
- Hitung kembalian, cetak struk 58/80mm via `window.print()`
- Shift kasir: buka/tutup dengan kas awal, rekap & selisih kas
- Retur per item dari struk; void transaksi hari ini (shift belum ditutup)

**Master & Inventori**
- Produk (+ foto, satuan, barcode tambahan, harga member, tier harga, impor/ekspor CSV), Kategori, Supplier, Member
- Stok otomatis berkurang saat jual, **HPP moving average** saat penerimaan
- Pembelian: PO (draft → dikirim → diterima sebagian/penuh) + pembayaran sederhana
- **Batch & kadaluarsa (FEFO)**: tiap penerimaan punya tanggal kadaluarsa sendiri; stok dijual dari batch terdekat kadaluarsa lebih dulu, penjualan batch kadaluarsa diblokir, retur/void mengembalikan ke batch asal
- Stok opname (tanpa harus tutup toko), penyesuaian manual, kartu stok, peringatan stok minimum & akan/sudah kadaluarsa
- **Konsinyasi**: penitip (consignor), barang titipan, laporan penjualan titipan & hutang ke penitip + pencatatan pembayaran

**Kepegawaian**
- **Absensi** karyawan: absen masuk/pulang mandiri dari layar, koreksi manual oleh admin, rekap per periode

**Laporan & Administrasi**
- Dashboard KPI (termasuk **laba bersih** & **modal**; kartu KPI dapat diklik menuju menu/tab terkait), penjualan harian/periode, per kasir, per metode bayar, **laba kotor**, **laba rugi**, **modal (pembelian lunas)**, produk terlaris, stok minimum, kartu stok
- **Beban operasional** (gaji, sewa, listrik, dll.) dengan kategori & status bayar; dipakai menghitung **laba bersih**
- Semua laporan dapat diekspor **CSV**
- Pengguna (termasuk pengaturan **izin per modul**), Pengaturan toko (identitas, PPN, struk, QRIS, poin, ambang peringatan kadaluarsa)

---

## 2. Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | React 18, Vite 5, React Router 6, Tailwind CSS 3, lucide-react, papaparse, `@zxing/browser` (fallback scan kamera) |
| Backend | Node.js 20, Express 4, plain JS (CommonJS), `pg` (raw SQL), bcryptjs, jsonwebtoken, multer, `bwip-js` (render barcode) |
| Database | PostgreSQL 15 |
| Deploy | Docker Compose (postgres + backend + frontend nginx) |

Uang disimpan sebagai `BIGINT` rupiah (integer, tanpa desimal). Semua pembulatan PPN terpusat di `backend/utils/money.js`.

---

## 3. Struktur Folder

```
pos-server/
├── docker-compose.yml       # postgres + backend + frontend
├── .env.example             # POSTGRES_*, JWT_SECRET, CORS_ORIGIN, port host, APP_TIMEZONE
├── Dockerfile               # FE multi-stage: node build -> nginx
├── nginx/                   # template + entrypoint nginx (TLS, proxy /api & /uploads)
├── package.json             # FE (vite react)
├── vite.config.js           # dev server 3000, proxy /api -> localhost:5000
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── db.js                # pg Pool + helper withTransaction
│   ├── server.js            # bootstrap express, mount routers
│   ├── init.sql             # skema (idempotent)
│   ├── seed.sql             # data contoh (idempotent)
│   ├── middleware/          # auth.js (JWT + izin), error.js
│   ├── utils/               # money, invoice, csv, pagination, validate,
│   │                        # stock, batches (FEFO), item_pricing, pricing,
│   │                        # promotions, barcode (EAN-13), settings, upload, audit,
│   │                        # permissions (daftar izin + preset role)
│   ├── routes/              # auth, users, settings, categories, suppliers,
│   │                        # products, promotions, bundles, consignment,
│   │                        # attendance, members, stock, purchases, expenses,
│   │                        # sales, returns, shifts, reports
│   └── uploads/             # foto produk & QRIS (volume)
└── src/
    ├── main.jsx, App.jsx, index.css
    ├── api/client.js        # fetch wrapper + JWT header + error handling
    ├── context/             # AuthContext, CartContext, SettingsContext, ToastContext
    ├── components/
    │   ├── layout/          # Sidebar, Topbar, MainLayout
    │   ├── ui/              # Modal, Button, Table, Pagination, Toast,
    │   │                    # ConfirmDialog, Input, Badge, Card, Spinner, PageHeader
    │   ├── scanner/         # BarcodeScannerModal, CameraScanButton (scan kamera)
    │   ├── bundles/         # BundleBarcodeTab (daftar & cetak label barcode)
    │   ├── receipt/Receipt.jsx
    │   └── ProtectedRoute.jsx
    ├── pages/               # Login, Dashboard, POS, Transactions, Products,
    │                        # Promotions, Bundles, Consignment, Attendance,
    │                        # Categories, Suppliers, Stock, StockOpname,
    │                        # Purchases, Expenses, Members, Shifts, Reports,
    │                        # Users, Settings
    ├── hooks/               # useApi, useDebounce, useHotkeys, useToast
    └── utils/               # formatters/{currency,date,index}, labels, barcode
```

---

## 4. Menjalankan dengan Docker (produksi)

```bash
cp .env.example .env
# WAJIB: isi POSTGRES_PASSWORD dan JWT_SECRET (minimal 16 karakter acak)
#   openssl rand -base64 32
docker compose up -d --build
```

> Backend akan menolak berjalan bila `JWT_SECRET` kosong atau masih memakai
> nilai contoh, dan Docker Compose akan gagal bila `POSTGRES_PASSWORD` /
> `JWT_SECRET` tidak diisi di `.env`.

Akses:
- Aplikasi (FE): http://localhost:9998
- API (BE): http://localhost:5002/api/health
- Dari perangkat lain di LAN: `http://<IP-LAN>:9998`

**Port default** (dapat diubah di `.env`; default digeser agar tidak bentrok dengan project lain):
`FRONTEND_HOST_PORT=9998`, `FRONTEND_HTTPS_HOST_PORT=9999`, `BACKEND_HOST_PORT=5002`, `POSTGRES_HOST_PORT=5433`.

`APP_TIMEZONE` (default `Asia/Jakarta`) menentukan zona waktu toko untuk batas "hari ini"/"bulan ini" pada KPI dan laporan.

**Insight AI laporan bulanan** (opsional) memakai API kenari.id. Isi di `.env` (jangan commit):
`KENARI_API_KEY` (wajib terisi agar insight terhasilkan), `KENARI_BASE_URL` (default `https://kenari.id/v1`),
`KENARI_MODEL` (default `mimo-v2-6-flash:free`). Tanpa key, laporan tetap tercetak — kotak insight
menampilkan catatan "tidak tersedia".

### HTTPS untuk kamera (wajib untuk scan via HP)

Fitur scan barcode memakai kamera perangkat (`getUserMedia`). Browser **hanya**
memberi akses kamera pada *secure context*: `https://` atau `localhost`. Karena
itu deploy menyediakan dua port:

- `http://<IP-LAN>:9998` — **dialihkan** (301) ke HTTPS.
- `https://<IP-LAN>:9999` — dipakai HP dan komputer kasir. **Selalu pakai alamat ini.**

Port tujuan redirect mengikuti `FRONTEND_HTTPS_HOST_PORT` (diteruskan ke
container sebagai `HTTPS_HOST_PORT`), jadi mengubah port tidak perlu mengedit
nginx.

Sertifikat dibuat sekali di host dengan [mkcert](https://github.com/FiloSottile/mkcert):

```bash
brew install mkcert        # macOS (Linux: lihat README mkcert)
sudo mkcert -install       # pasang CA lokal di trust store host (butuh sudo)
mkcert -cert-file certs/pos.crt -key-file certs/pos.key <IP-LAN> localhost 127.0.0.1
```

Ganti `<IP-LAN>` dengan IP host (mis. `192.168.1.9`). File disimpan sebagai
`certs/pos.crt` dan `certs/pos.key` (nama ini tetap, sesuai template nginx
`nginx/templates/default.conf.template`) dan di-mount per berkas ke container.
Folder `certs/` sudah masuk `.gitignore` — **jangan commit kunci privat**.

Atur izin berkas: worker nginx berjalan sebagai user `nginx` (non-root) di
dalam container, sehingga kunci privat harus bisa dibaca olehnya, tetapi
**jangan** dibuat world-readable. Batasi ke grup `nginx` (GID `101` pada image
`nginx:stable-alpine`):

```bash
chmod 600 certs/pos.key
chmod 644 certs/pos.crt
# opsional (Linux): samakan grup agar worker nginx bisa membaca kunci.
sudo chgrp 101 certs/pos.key && chmod 640 certs/pos.key
```

> Menjalankan container sebagai root menghindari masalah izin, tetapi
> memperbesar dampak bila nginx disusupi. Jangan `chmod 644` kunci privat —
> itu membuat kunci terbaca oleh semua proses di host.

> `mkcert -install` butuh `sudo` karena menambah CA ke trust store sistem, dan
> hanya memengaruhi peringatan di host. **Membuat sertifikat tidak butuh sudo**,
> jadi bila `sudo` tidak tersedia cukup jalankan `mkcert -cert-file ...` — HP
> tetap bisa memercayai sertifikat setelah CA dipasang di perangkat (langkah
> berikut).

> Tanpa sertifikat, container frontend gagal start karena nginx tidak bisa
> membaca berkas TLS. Buat sertifikat sebelum `docker compose up -d --build`.
> Perubahan `nginx/templates/default.conf.template` / `docker-compose.yml`
> butuh rebuild: `docker compose up -d --build frontend`.

**Pasang CA mkcert di tiap HP** (sekali per perangkat). Tanpa ini HP menampilkan
peringatan sertifikat dan kamera tetap bisa diblokir. Cari lokasi CA:

```bash
mkcert -CAROOT                              # lokasi CA, mis. ~/Library/Application Support/mkcert
cp "$(mkcert -CAROOT)/rootCA.pem" .          # salin ke folder project agar mudah dikirim ke HP
```

> `rootCA.pem` sudah masuk `.gitignore` (sertifikat CA tidak boleh di-commit).
> Cara mendistribusikannya ke HP: kirim lewat email/AirDrop/WhatsApp ke diri
> sendiri, atau sajikan sementara lewat server statis, lalu buka di HP.

- **Android**: salin `rootCA.pem` ke perangkat → Settings → Security → Encryption
  & credentials → Install a certificate → CA certificate → pilih file itu.
  (Sebagian HP perlu mengunduhnya lewat browser/aplikasi file.)
- **iOS (Safari)**: buka `rootCA.pem` → Install Profile → Settings → General →
  VPN & Device Management → instal → lalu **Settings → General → About →
  Certificate Trust Settings** → aktifkan *full trust* untuk CA tersebut.

Setelah CA terpasang, buka `https://<IP-LAN>:9999` tanpa peringatan. Untuk
pengembangan di desktop, `http://localhost:3000` sudah dianggap secure context
sehingga kamera berfungsi tanpa sertifikat.

### Inisialisasi database

`init.sql` dan `seed.sql` **otomatis dijalankan** oleh image postgres saat volume pertama kali dibuat
(mount ke `docker-entrypoint-initdb.d`). Untuk database yang sudah ada, jalankan manual:

```bash
docker compose exec -T postgres psql -U postgres -d pos_minimarket -f /docker-entrypoint-initdb.d/01-init.sql
docker compose exec -T postgres psql -U postgres -d pos_minimarket -f /docker-entrypoint-initdb.d/02-seed.sql
```

Kedua file bersifat idempotent (aman dijalankan berulang).

### Login awal

Akun awal dibuat otomatis oleh backend saat pertama dijalankan (bukan dari `seed.sql`),
sehingga tidak ada password default yang tersimpan di repo:

- Isi `ADMIN_PASSWORD` dan `KASIR_PASSWORD` di `.env` untuk menentukan password sendiri, **atau**
- biarkan kosong: backend membuat password acak dan mencetaknya **satu kali** ke log:
  ```bash
  docker compose logs backend | grep "Password acak"
  ```

Akun **gudang** bersifat opsional: dibuat hanya bila `GUDANG_USERNAME` diisi di `.env`
(`GUDANG_PASSWORD`, `GUDANG_FULL_NAME`).

> Segera ubah password melalui menu **Pengguna** setelah login pertama. Backend tidak
> akan pernah menjalankan dengan `JWT_SECRET` kosong atau bernilai contoh.

---

## 5. Menjalankan mode development

Terminal 1 — database:
```bash
docker compose up -d postgres
```

Terminal 2 — backend (port 5000):
```bash
cd backend
npm install
DB_HOST=localhost DB_PORT=5433 DB_NAME=pos_minimarket DB_USER=postgres DB_PASSWORD=<password-db> \
  JWT_SECRET=<string-acak-min-16-karakter> ADMIN_PASSWORD=<password-admin> \
  KASIR_PASSWORD=<password-kasir> PORT=5000 node server.js
```

Terminal 3 — frontend (port 3000, proxy `/api` ke `localhost:5000`):
```bash
npm install
npm run dev
```

Buka http://localhost:3000.

---

## 6. Aturan bisnis kunci

1. **Harga jual sudah termasuk PPN.** `tax_total = round(grand_total - grand_total/(1 + tax_rate/100))`; `dpp = grand_total - tax_total`. Pembulatan dilakukan sekali di level transaksi.
2. **Multi-satuan**: stok selalu disimpan dalam satuan dasar; jual 1 dus = kurangi `conversion_factor` satuan dasar.
3. **Harga efektif (otomatis termurah)**: untuk tiap item, server memilih harga terendah yang berlaku dari kombinasi **tier qty**, **promo aktif**, **harga member**, dan **harga normal**. Diskon manual kasir ditambahkan di atas harga efektif (di-*clamp* agar total tidak negatif). Harga promo/tier/member hanya menurunkan, tidak menaikkan.
4. **Harga member**: bila transaksi memakai member dan `member_price` terisi, harga itu berlaku (fallback ke `sell_price`), termasuk di level satuan.
5. **Promo periode**: berlaku bila tanggal, hari, dan jam cocok; promo bertumpuk diambil yang memberi harga efektif termurah. Asal harga dicatat di `sale_items.promo_id`/`tier_id`.
6. **HPP moving average**: `new_cost = round((stock_qty*old_cost + received_qty*unit_cost) / (stock_qty+received_qty))` saat penerimaan. `sale_items.cost_price` menyalin HPP saat transaksi agar laba historis tidak berubah.
7. **Batch & kadaluarsa (FEFO)**: stok tersimpan per batch (`stock_batches`) dengan `expiry_date` opsional. Penjualan mengalokasikan batch **paling dekat kadaluarsa** lebih dulu (`expiry_date NULLS LAST`); batch yang sudah lewat kadaluarsa **tidak dijual**; alokasi dicatat di `sale_item_batches` agar retur/void mengembalikan ke batch asal.
8. **Paket bundling**: dijual dengan harga tetap (tanpa tier/promo item); stok tiap komponen berkurang saat terjual, dan retur/void mengembalikan stok tiap komponen.
9. **Konsinyasi**: barang titipan masuk stok lewat penerimaan; penjualan titipan & hutang ke penitip dihitung dari `cost_price` (harga setor); pembayaran ke penitip dicatat di `consignment_payouts`.
10. **Laba kotor** = `sum(line_total) - sum(qty * cost_price)`.
11. **Laba bersih** = laba kotor − koreksi retur − **beban operasional**. Pembelian stok & pembayaran penitip **bukan** beban (mengubah kas menjadi persediaan); HPP sudah dikurangkan saat barang terjual sehingga tidak dihitung ulang (mencegah *double counting*).
12. **Poin**: `earn = floor((total setelah diskon) / point_earn_per_amount)`; redeem 1 poin = `point_value_rupiah`, minimal `point_min_redeem`.
13. **Stok tidak boleh negatif** (kecuali `allow_negative_stock` diaktifkan di Pengaturan).
14. **Atomicitas**: semua operasi pengubah stok memakai `BEGIN/COMMIT` + `SELECT ... FOR UPDATE` pada baris produk.
15. **Void**: hanya transaksi hari ini dengan shift belum ditutup; stok dikembalikan (termasuk komponen paket & batch), poin disesuaikan, tercatat di `audit_logs`.
16. **Retur**: qty ≤ `qty - returned_qty`; stok bertambah dengan HPP asli.
17. **Barcode paket internal**: format **EAN-13** berprefix `200` dengan check digit benar (`backend/utils/barcode.js`), dirender ke SVG memakai `bwip-js` untuk cetak label.
18. **Nomor dokumen** (`INV-YYYYMMDD-NNNN`, `RET-`, `PO-`, `OPN-`, `EXP-`) dibuat di server di dalam transaksi via counter harian, sehingga tidak duplikat.
19. Checkout **menghitung ulang semua harga/total di server**; total dari klien tidak dipercaya.

---

## 6a. Role & izin granular

Otorisasi memakai **izin per modul** yang disimpan di `users.permissions` (JSONB), bukan
lagi hanya biner admin/kasir. Nilai `NULL` berarti "pakai preset role"; array eksplisit
berarti izin custom per user. **Admin selalu punya semua izin** (bypass) dan tidak dapat
mengunci dirinya sendiri.

Izin dimuat dari DB **per request**, jadi cabut/beri izin langsung berlaku tanpa login ulang.

| Preset | Izin |
|---|---|
| **admin** | semua |
| **kasir** | `pos.use`, `shift.use`, `attendance.self`, `product.view`, `stock.view`, `member.manage`, `invoice.view`, `print.use` |
| **gudang** | `pos.use`, `shift.use`, `attendance.self`, `product.view`, `product.manage`, `stock.view`, `stock.manage`, `purchase.view`, `purchase.manage` |
| **operator** (fotokopi) | `print.use`, `print.report`, `report.view`, `attendance.self`, `shift.use` |

Gudang **boleh jualan di POS** dan terima PO, tetapi **tidak** boleh bayar ke supplier
(`purchase.pay`), kelola supplier/konsinyasi/paket/promo/beban, atau mengakses laporan,
pengguna, dan pengaturan.

Daftar kunci izin (`backend/utils/permissions.js`, diekspos lewat `GET /api/users/permissions`):

`pos.use`, `shift.use`, `attendance.self`, `product.view`, `product.manage`, `stock.view`,
`stock.manage`, `purchase.view`, `purchase.manage`, `purchase.pay`, `supplier.manage`,
`consignment.manage`, `bundle.manage`, `promotion.manage`, `member.manage`,
`customer.manage`, `invoice.view`, `invoice.manage`, `expense.manage`,
`print.use`, `print.manage`, `print.report`,
`report.view`, `user.manage`, `settings.manage`.

Izin akhir dapat diatur per user via checkbox di halaman **Pengguna**.

> Catatan baca-vs-tulis: endpoint `GET` daftar/detail dilindungi izin lihat
> (`product.view`, `stock.view`, `purchase.view`, `pos.use`, `shift.use`,
> `member.manage`/`pos.use` untuk member, `settings` baca publik untuk POS);
> mutasi (`POST/PUT/DELETE`, terima PO, bayar, opname post) butuh izin kelola
> (`product.manage`, `stock.manage`, `purchase.manage`/`purchase.pay`, dst).
> Checkout mendukung header idempotensi `X-Idempotency-Key` agar retry aman.

---

## 7. API

Semua endpoint berprefiks `/api`. Hanya `POST /api/auth/login` yang publik; sisanya wajib `Authorization: Bearer <token>`. Endpoint dibatasi izin granular via `requirePermission('...')` (default: cukup salah satu kunci; `requirePermission.all(...)` untuk menuntut semua).

- **Auth**: `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- **Users** (`user.manage`): `GET/POST /users`, `GET /users/permissions`, `PUT /users/:id`, `PUT /users/:id/deactivate`
- **Categories / Suppliers**: CRUD
- **Products**: `GET /products`, `GET /products/barcode/:barcode`, `GET /products/:id`, `POST/PUT/DELETE`, `POST /products/import`, `GET /products/export`, `POST /products/:id/image`, `GET/POST/DELETE /products/:id/units`, `GET/POST/DELETE /products/:id/barcodes`, `GET/POST/DELETE /products/:id/tiers`, `POST /products/quote`
- **Promotions** (`promotion.manage`): `GET/POST /promotions`, `GET/PUT/DELETE /promotions/:id`
- **Bundles**: `GET /bundles`, `GET/POST/PUT/DELETE /bundles/:id`, `GET/PUT /bundles/:id/items`, `GET /bundles/barcode/:barcode`, `GET /bundles/barcode/generate` (`bundle.manage`), `GET /bundles/:id/barcode.svg` (`bundle.manage`), `POST /bundles/barcodes/render` (`bundle.manage`)
- **Consignment** (`consignment.manage`): CRUD `/consignment/consignors`, `GET /consignment/products`, `GET /consignment/sales`, `GET /consignment/payables`, `GET/POST /consignment/payouts`
- **Attendance**: `POST /attendance/check-in`, `POST /attendance/check-out`, `GET /attendance/me` (`attendance.self`), `GET /attendance` (`user.manage`), `GET /attendance/summary` (`user.manage`), `POST /attendance/manual` (`user.manage`)
- **Members**: CRUD, `GET /members/:id/points`, `POST /members/:id/points/adjust`
- **Stock**: `GET /stock/movements`, `GET /stock/low`, `GET /stock/batches`, `GET /stock/expiring`, `PUT /stock/batches/:id`, `POST /stock/adjustments`, `GET/POST /stock/opnames`, `GET /stock/opnames/:id`, `PUT /stock/opnames/:id/items`, `POST /stock/opnames/:id/post`
- **Purchases**: `GET/POST /purchases`, `GET/PUT /purchases/:id`, `POST /purchases/:id/receive`, `POST /purchases/:id/payment`, `POST /purchases/:id/cancel`
- **Expenses**: `GET/POST/PUT/DELETE /expenses`, `GET /expenses/:id`, `POST /expenses/:id/payment`, `GET/POST/PUT/DELETE /expenses/categories`
- **Sales**: `POST /sales`, `GET /sales`, `GET /sales/:id`, `GET /sales/by-invoice/:invoiceNo`, `POST /sales/:id/void`
- **Holds**: `POST /holds`, `GET /holds`, `GET /holds/:id`, `DELETE /holds/:id?reason=resume|cancel` (parkir keranjang POS tanpa mengunci stok)
- **Returns**: `POST /returns`, `GET /returns`, `GET /returns/:id`
- **Shifts**: `GET /shifts/current`, `POST /shifts/open`, `POST /shifts/close`, `GET /shifts`, `GET /shifts/:id/summary`
- **Reports** (semua mendukung `?format=csv`): `/reports/sales-summary`, `/reports/by-cashier`, `/reports/by-payment`, `/reports/gross-profit`, `/reports/profit-loss`, `/reports/purchase-paid`, `/reports/top-products`, `/reports/low-stock`, `/reports/stock-card/:productId`, `/reports/dashboard`
- **Settings**: `GET/PUT /settings`, `POST /settings/qris-image`
- **Health**: `GET /api/health`

---

## 8. Shortcut layar kasir

### Global

| Tombol | Fungsi |
|---|---|
| `Enter` di kolom barcode | Tambah produk hasil scan (scanner USB) |
| `F2` | Fokus ke kolom pencarian |
| `F4` | Buka dialog pembayaran |
| `F6` / `Alt+H` | Tahan/hold keranjang saat ini |
| `F7` / `Alt+A` | Buka daftar hold aktif (ambil/lanjutkan) |
| `F8` | Pembayaran tunai (isi otomatis total) |
| `Alt+M` | Buka pilih member |
| `Alt+C` | Kosongkan keranjang (dengan konfirmasi) |
| `Alt+K` | Buka pemindai kamera (butuh HTTPS) |
| `H` / `A` / `M` / `C` / `K` | Alias huruf tunggal — hanya saat fokus **bukan** di kolom teks |
| `Esc` | Tutup dialog yang aktif |

**Fokus kolom barcode:** state default layar kasir selalu fokus di barcode (untuk scanner USB). Dari sana pakai **F2/F4/F6/F7/F8** atau kombinasi **Alt+huruf** — scanner USB tidak pernah mengirim tombol Alt, jadi kombinasi aman dari tabrakan scan. `Ctrl`/`Cmd` tidak pernah dicegat (copy/paste/select-all tetap milik browser).

### Navigasi list (tanpa mouse)

| Konteks | Tombol | Fungsi |
|---|---|---|
| Dropdown pencarian | `↑` / `↓` | Pindah highlight produk/paket |
| | `Enter` | Pilih item highlight |
| Pilih satuan | `↑` / `↓` + `Enter`, atau `1`–`9` | Pilih satuan |
| Pilih member | `↑` / `↓` + `Enter` | Pilih member |
| Daftar hold | `Ambil` | Muat hold ke keranjang (konfirmasi bila cart terisi) |
| Dialog pembayaran | `1`–`4` | Pilih metode: Tunai / QRIS / Debit / Transfer |
| | `Enter` | Konfirmasi bayar (saat fokus bukan di input nominal) |
| Modal struk | `Alt+P` / `P` | Cetak struk |
| | `Enter` / `Esc` | Tutup modal struk |
| Layar buka shift | `Enter` | Submit kas awal |

### Fitur hold (tahan/ambil belanja)

- **Tahan (H)**: simpan keranjang sementara (nama/note opsional). Tidak mengunci stok.
- **Hold (A)**: daftar hold aktif → **Ambil** memuat isi hold ke keranjang; harga dihitung ulang via quote + checkout server.
- Hold yang produknya dihapus/tidak aktif otomatis dilewati saat resume (dengan toast).
- Kode hold berformat `HOLD-YYYYMMDD-NNNN`.

Layar kasir memakai tata letak **1 kolom**: bar scan + kamera + pencarian di atas, daftar item keranjang (satu baris per item) di tengah, dan ringkasan **TOTAL + Bayar** yang menempel di bawah. Mengetik di pencarian memunculkan dropdown hasil (produk & paket); diskon item tersembunyi di balik ikon pada tiap baris.

---

## 9. Cetak struk & label barcode

**Struk** memakai `window.print()` dengan CSS khusus (`.receipt-paper`, 58mm/80mm) di `src/index.css`.
Hanya area `#receipt-print-area` yang tercetak.

- Atur lebar kertas printer (58mm/80mm) dan margin ke 0 di driver printer OS.
- Matikan header/footer browser saat mencetak.
- Integrasi ESC/POS langsung dan cash drawer tidak termasuk cakupan MVP.

**Label barcode paket** (menu Paket → tab **Barcode**): pilih paket lalu cetak label.
Gambar barcode dirender server-side sebagai SVG (`GET /api/bundles/:id/barcode.svg` atau
`POST /api/bundles/barcodes/render` untuk massal) dan dicetak lewat `window.print()` dengan
CSS label (`.barcode-label`, default 40×30mm). Hanya area `#barcode-print-area` yang tercetak.
Isi label: barcode + nama paket + harga + kode. Cek kalibrasi ukuran label dengan printer Anda.

---

## 10. Backup

Database (dump ke file):
```bash
docker exec pos-minimarket-postgres pg_dump -U postgres -d pos_minimarket > backup-pos-$(date +%F).sql
```

Restore:
```bash
cat backup-pos-2026-09-28.sql | docker exec -i pos-minimarket-postgres psql -U postgres -d pos_minimarket
```

Uploads (foto produk & QRIS) tersimpan di `backend/uploads/` pada host — salin folder tersebut:
```bash
tar czf backup-uploads-$(date +%F).tar.gz backend/uploads
```

Backup terjadwal otomatis (`cron` + `pg_dump`) belum termasuk; dapat ditambahkan bila diperlukan.

---

## 11. Verifikasi

```bash
npm run lint      # ESLint FE + BE
npm run build     # build produksi FE
cd backend && npm run check   # cek sintaks backend
```

Uji alur kritis disarankan manual end-to-end: login admin → master data & impor CSV → atur tier/promo/paket → PO & penerimaan (cek HPP + batch/kadaluarsa) → buka shift → jual multi-satuan + diskon + split payment + member/poin → cetak struk → retur → void → absensi → konsinyasi (terima → jual → payout) → catat beban operasional → tutup shift (cek selisih) → cek semua laporan (termasuk Laba Rugi & Modal) & ekspor CSV → generate + cetak label barcode paket → uji role kasir (403).

Uji izin granular: login **gudang** → menu Stok/Opname/Pembelian/Produk tampil, bisa buat PO & terima barang, bisa buka shift & transaksi POS, tetapi menu Laporan/Beban/Pengguna/Pengaturan **tidak** tampil dan tombol **Bayar** supplier tidak ada (endpoint langsung pun 403). Uji izin custom: beri gudang `report.view` lewat halaman Pengguna → menu Laporan langsung muncul tanpa login ulang; cabut → hilang & API 403. Uji ketiga role (admin/kasir/gudang) untuk memastikan kasir tidak mendapat izin baru.

---

## 12. Catatan & batasan

- **Single-tenant / 1 toko**; tanpa multi-cabang.
- **Tanpa mode offline** — bila jaringan LAN putus, kasir tidak dapat bertransaksi.
- **QRIS statis**: verifikasi pembayaran dilakukan manual oleh kasir; catat referensi pembayaran di `sale_payments.reference`.
- **Scan kamera**: deteksi memakai `BarcodeDetector` native bila tersedia (Android/Chrome, Edge, desktop), dan fallback `@zxing/browser` untuk peramban tanpa dukungan (terutama iOS Safari). Pustaka fallback di-*code-split* sehingga tidak membebani bundel utama. Hanya berfungsi pada HTTPS/localhost dan setelah CA mkcert dipasang di perangkat (§4). Scanner USB tidak terpengaruh. Tombol kamera otomatis nonaktif pada konteks non-secure.
- **Kadaluarsa/FEFO**: batch tanpa tanggal (`expiry_date NULL`) dialokasikan paling akhir; stok lama saat migrasi dibuatkan satu batch `legacy`. Pembelian barang **bukan** beban laba (HPP dikurangkan saat terjual).
- **Akuntansi penuh** (jurnal umum, buku besar, hutang/piutang detail) di luar cakupan; laba bersih dihitung dari laba kotor − beban operasional, bukan jurnal.
- Integrasi ESC/POS langsung, cash drawer, dan payment gateway QRIS dinamis (webhook) **di luar cakupan**.
- HPP memakai moving average; perubahan harga beli tidak mengubah laba periode lampau karena HPP disalin ke `sale_items.cost_price`.

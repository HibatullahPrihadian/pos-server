# POS Minimarket

Aplikasi web Point of Sale (POS) untuk 1 toko retail minimarket. Diakses lewat browser di LAN (komputer kasir + perangkat admin).

Referensi pola arsitektur: `/Users/ibet/Documents/Antigravity/Tracker` (React + Vite + Tailwind / Express / PostgreSQL / Docker Compose).

---

## 1. Fitur

**Kasir & Penjualan**
- Login role **admin** & **kasir** (bcrypt + JWT)
- Scan barcode via **scanner USB** (input keyboard) atau **kamera HP** (butuh HTTPS, lihat §4)
- Pencarian produk
- Multi-satuan per produk (pcs/dus/karton) dengan faktor konversi
- Diskon manual per item & per transaksi
- Harga khusus member + poin (earn & redeem)
- Pembayaran Tunai / QRIS / Debit / Transfer, termasuk **split payment**
- QRIS statis toko (gambar diunggah di Pengaturan, konfirmasi manual kasir)
- Hitung kembalian, cetak struk 58/80mm via `window.print()`
- Shift kasir: buka/tutup dengan kas awal, rekap & selisih kas
- Retur per item dari struk; void transaksi hari ini (shift belum ditutup)

**Master & Inventori**
- Produk (+ foto, satuan, impor/ekspor CSV), Kategori, Supplier, Member
- Stok otomatis berkurang saat jual, **HPP moving average** saat penerimaan
- Pembelian: PO (draft → dikirim → diterima sebagian/penuh) + pembayaran sederhana
- Stok opname, penyesuaian manual, kartu stok, peringatan stok minimum

**Laporan & Administrasi**
- Dashboard KPI, penjualan harian/periode, per kasir, per metode bayar, laba kotor, produk terlaris, stok minimum, kartu stok
- Semua laporan dapat diekspor **CSV**
- Pengguna, Pengaturan toko (identitas, PPN, struk, QRIS, poin)

---

## 2. Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | React 18, Vite 5, React Router 6, Tailwind CSS 3, lucide-react, papaparse |
| Backend | Node.js 20, Express 4, plain JS (CommonJS), `pg` (raw SQL), bcryptjs, jsonwebtoken, multer |
| Database | PostgreSQL 15 |
| Deploy | Docker Compose (postgres + backend + frontend nginx) |

Uang disimpan sebagai `BIGINT` rupiah (integer, tanpa desimal). Semua pembulatan PPN terpusat di `backend/utils/money.js`.

---

## 3. Struktur Folder

```
pos-server/
├── docker-compose.yml       # postgres + backend + frontend
├── .env.example             # POSTGRES_*, JWT_SECRET, CORS_ORIGIN, port host
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
│   ├── middleware/          # auth.js (JWT + role), error.js
│   ├── utils/               # money, invoice, csv, pagination, validate,
│   │                        # stock, pricing, settings, upload, audit
│   ├── routes/              # auth, users, settings, categories, suppliers,
│   │                        # products, members, stock, purchases, sales,
│   │                        # returns, shifts, reports
│   └── uploads/             # foto produk & QRIS (volume)
└── src/
    ├── main.jsx, App.jsx, index.css
    ├── api/client.js        # fetch wrapper + JWT header + error handling
    ├── context/             # AuthContext, CartContext, SettingsContext, ToastContext
    ├── components/
    │   ├── layout/          # Sidebar, Topbar, MainLayout
    │   ├── ui/              # Modal, Button, Table, Pagination, Toast,
    │   │                    # ConfirmDialog, Input, Badge, Card, Spinner, PageHeader
    │   ├── receipt/Receipt.jsx
    │   └── ProtectedRoute.jsx
    ├── pages/               # Login, Dashboard, POS, Transactions, Products,
    │                        # Categories, Suppliers, Stock, StockOpname,
    │                        # Purchases, Members, Shifts, Reports, Users, Settings
    ├── hooks/               # useApi, useDebounce, useHotkeys, useToast
    └── utils/               # formatters/{currency,date,index}, labels
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
3. **Harga member**: bila transaksi memakai member dan `member_price` terisi, harga itu yang dipakai (fallback ke `sell_price`), termasuk di level satuan.
4. **HPP moving average**: `new_cost = round((stock_qty*old_cost + received_qty*unit_cost) / (stock_qty+received_qty))` saat penerimaan. `sale_items.cost_price` menyalin HPP saat transaksi agar laba historis tidak berubah.
5. **Laba kotor** = `sum(line_total) - sum(qty * cost_price)`.
6. **Poin**: `earn = floor((total setelah diskon) / point_earn_per_amount)`; redeem 1 poin = `point_value_rupiah`, minimal `point_min_redeem`.
7. **Stok tidak boleh negatif** (kecuali `allow_negative_stock` diaktifkan di Pengaturan).
8. **Atomicitas**: semua operasi pengubah stok memakai `BEGIN/COMMIT` + `SELECT ... FOR UPDATE` pada baris produk.
9. **Void**: hanya transaksi hari ini dengan shift belum ditutup; stok dikembalikan, poin disesuaikan, tercatat di `audit_logs`.
10. **Retur**: qty ≤ `qty - returned_qty`; stok bertambah dengan HPP asli.
11. **Nomor dokumen** (`INV-YYYYMMDD-NNNN`, `RET-`, `PO-`, `OPN-`) dibuat di server di dalam transaksi via counter harian, sehingga tidak duplikat.
12. Checkout **menghitung ulang semua harga/total di server**; total dari klien tidak dipercaya.

---

## 7. API

Semua endpoint berprefiks `/api`. Hanya `POST /api/auth/login` yang publik; sisanya wajib `Authorization: Bearer <token>`. Endpoint admin dibatasi `requireRole('admin')`.

- **Auth**: `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- **Users** (admin): `GET/POST /users`, `PUT /users/:id`, `PUT /users/:id/deactivate`
- **Categories / Suppliers**: CRUD
- **Products**: `GET /products`, `GET /products/barcode/:barcode`, `GET /products/:id`, `POST/PUT/DELETE`, `POST /products/import`, `GET /products/export`, `POST /products/:id/image`, `GET/POST/DELETE /products/:id/units`
- **Members**: CRUD, `GET /members/:id/points`, `POST /members/:id/points/adjust`
- **Stock**: `GET /stock/movements`, `GET /stock/low`, `POST /stock/adjustments`, `GET/POST /stock/opnames`, `GET /stock/opnames/:id`, `PUT /stock/opnames/:id/items`, `POST /stock/opnames/:id/post`
- **Purchases**: `GET/POST /purchases`, `GET/PUT /purchases/:id`, `POST /purchases/:id/receive`, `POST /purchases/:id/payment`, `POST /purchases/:id/cancel`
- **Sales**: `POST /sales`, `GET /sales`, `GET /sales/:id`, `GET /sales/by-invoice/:invoiceNo`, `POST /sales/:id/void`
- **Returns**: `POST /returns`, `GET /returns`, `GET /returns/:id`
- **Shifts**: `GET /shifts/current`, `POST /shifts/open`, `POST /shifts/close`, `GET /shifts`, `GET /shifts/:id/summary`
- **Reports** (semua mendukung `?format=csv`): `/reports/sales-summary`, `/reports/by-cashier`, `/reports/by-payment`, `/reports/gross-profit`, `/reports/top-products`, `/reports/low-stock`, `/reports/stock-card/:productId`, `/reports/dashboard`
- **Settings**: `GET/PUT /settings`, `POST /settings/qris-image`
- **Health**: `GET /api/health`

---

## 8. Shortcut layar kasir

| Tombol | Fungsi |
|---|---|
| `Enter` di kolom barcode | Tambah produk hasil scan (scanner USB) |
| Tombol **Kamera** | Buka pemindai kamera (butuh HTTPS) |
| `F2` | Fokus ke kolom pencarian |
| `F4` | Buka dialog pembayaran |
| `F8` | Pembayaran tunai (isi otomatis total) |
| `Esc` | Tutup dialog yang aktif |

---

## 9. Cetak struk

Struk memakai `window.print()` dengan CSS khusus (`.receipt-paper`, 58mm/80mm) di `src/index.css`.
Hanya area `#receipt-print-area` yang tercetak.

- Atur lebar kertas printer (58mm/80mm) dan margin ke 0 di driver printer OS.
- Matikan header/footer browser saat mencetak.
- Integrasi ESC/POS langsung dan cash drawer tidak termasuk cakupan MVP.

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

Uji alur kritis disarankan manual end-to-end: login admin → master data & impor CSV → PO & penerimaan (cek HPP) → buka shift → jual multi-satuan + diskon + split payment + member/poin → cetak struk → retur → void → tutup shift (cek selisih) → cek semua laporan & ekspor CSV → uji role kasir (403).

---

## 12. Catatan & batasan

- **Single-tenant / 1 toko**; tanpa multi-cabang.
- **Tanpa mode offline** — bila jaringan LAN putus, kasir tidak dapat bertransaksi.
- **QRIS statis**: verifikasi pembayaran dilakukan manual oleh kasir; catat referensi pembayaran di `sale_payments.reference`.
- **Scan kamera**: deteksi memakai `BarcodeDetector` native bila tersedia (Android/Chrome, Edge, desktop), dan fallback `@zxing/browser` untuk peramban tanpa dukungan (terutama iOS Safari). Pustaka fallback di-*code-split* sehingga tidak membebani bundel utama. Hanya berfungsi pada HTTPS/localhost dan setelah CA mkcert dipasang di perangkat (§4). Scanner USB tidak terpengaruh.
- Integrasi ESC/POS langsung, cash drawer, payment gateway QRIS dinamis (webhook), cetak label barcode, e-commerce, dan akuntansi penuh (jurnal umum, hutang/piutang detail) **di luar cakupan**.
- HPP memakai moving average; perubahan harga beli tidak mengubah laba periode lampau karena HPP disalin ke `sale_items.cost_price`.

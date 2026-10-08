# QA Menyeluruh POS Minimarket — Full-Stack Live Plan

## 1. Tujuan & Scope
- Tujuan: uji QA menyeluruh aplikasi POS, temukan bug fungsional, otorisasi, data, dan UI.
- Scope disetujui: full-stack menyeluruh (BE + FE + DB + API + E2E manual).
- Env: live Docker + DB seed, boleh reset DB dev.
- Non-goal: tidak perbaiki bug di plan ini; hanya temukan, reproduksi, catat bukti. Tidak sentuh prod, tidak commit secret.

## 2. Pintu Masuk & Env
- File acuan: `README.md` §4-5, `docker-compose.yml`, `.env.example`, `backend/server.js`, `Feature.md`.
- Setup:
  1. `cp .env.example .env`, isi `POSTGRES_PASSWORD`, `JWT_SECRET` (≥16 acak), `ADMIN_PASSWORD`, `KASIR_PASSWORD`, `GUDANG_USERNAME/PASSWORD`.
  2. `docker compose up -d --build`, tunggu postgres healthy.
  3. Verifikasi `GET /api/health`, login admin/kasir/gudang via FE `http://localhost:9998` dan API.
  4. Catat kredensial uji hanya di lokal, jangan commit.
- Baseline: `npm run lint`, `npm run build`, `cd backend && npm run check`. Catat gagal sebagai bug env/kode.
- Reset DB dev bila perlu: re-init `backend/init.sql` + `backend/seed.sql` manual via `docker compose exec -T postgres psql`. Transaksi uji boleh void/hapus.

## 3. Batas Modul & Alur Kritis
- Auth/izin granular: `backend/utils/permissions.js`, `backend/middleware/auth.js`, `src/context/AuthContext.jsx`, `src/App.jsx`, `src/components/ProtectedRoute.jsx`.
- POS checkout: `src/pages/POS.jsx`, `src/context/CartContext.jsx`, `backend/routes/sales.js`, `backend/utils/item_pricing.js`, `pricing.js`, `promotions.js`, `money.js`.
- Stok/HPP/FEFO: `backend/utils/stock.js`, `batches.js`, `backend/routes/stock.js`, `purchases.js`, `src/pages/Stock*.jsx`, `Purchases.jsx`.
- Retur/void: `backend/routes/returns.js`, `sales.js#void`, `src/pages/Transactions.jsx`.
- Shift/hold: `backend/routes/shifts.js`, `holds.js`, `src/pages/Shifts.jsx`, POS hold flow.
- Member/poin, tier/promo, multi-satuan/multibarcode, paket bundling + EAN-13, konsinyasi, invoice kredit/piutang, beban/laba rugi/modal, absensi, laporan/CSV, pengaturan/PPN/poin, upload foto/QRIS, scan USB/kamera, cetak struk/label.
- Multi-usaha fotokopi (`X-Business`, `print_services`, `print_orders`) — uji regresi minimarket tidak rusak.

## 4. Kandidat Bug Awal (wajib verifikasi, bukan vonis)
1. `src/context/AuthContext.jsx:55-58` — bila `user.permissions` NULL (preset role), FE set `permissions=[]` sehingga `can()` false semua; BE artikan NULL = preset role. Dampak: kasir/gudang preset bisa diblokir UI padahal API 200. Uji: login kasir/gudang preset NULL, cek menu vs API langsung.
2. `src/pages/POS.jsx:361` — `selectProduct` tolak `stock_qty<=0` di klien; server otoritatif + `allow_negative_stock` + alokasi FEFO per-batch. Uji: produk stok 0 tapi allow_negative ON, dan produk multi-batch expired vs tersedia.
3. `POS.jsx:235` `quoteKey` hanya `[product_id,unit_id,qty]` — harga quote tidak ikut `txn_discount/redeem` (benar untuk unit price), tapi pastikan total estimasi vs checkout server identik.
4. `POS.jsx:761-769` `cancelHold` tanpa `?reason=` sedang `resumeHold` pakai `?reason=resume` dan `DELETE /holds/:id?reason=resume|cancel` terdokumentasi. Uji: cancel tanpa reason 400/500 atau silent.
5. `backend/utils/item_pricing.js:34-38` batch units pakai `id=ANY + product_id=ANY` lalu map `product_id:id`. Uji silang multi-produk multi-satuan: pastikan unit tidak tertukar bila ID berdekatan.
6. Shift `sales.js:88-91` — `shift.business !== req.business` dan non-admin hanya shift milik sendiri. Uji lintas business + kasir pakai shift orang lain.
7. PPN inclusive/exclusive (`POS.jsx:852-861` vs `money.js#extractTax`): uji total, kembalian, struk, laporan konsisten.

## 5. Rencana Eksekusi Berurutan
### A. Static + skema (cepat, tanpa runtime berat)
- [ ] Petakan 23 route BE vs `README §7` vs `App.jsx` routes vs Sidebar: catat endpoint tanpa guard, route tanpa permission, menu bocor.
- [ ] Cek `requirePermission` tiap router; fokus `purchase.pay`, `invoice.manage`, `report.view`, `user.manage`, `settings.manage`.
- [ ] Cek `init.sql` constraint: stok negatif, qty, harga, nomor dokumen harian, FK retur/void/batch.
- [ ] Cek `money.js` pembulatan PPN, `invoice.js` counter, `barcode.js` EAN-13 prefix 200 + check digit.

### B. Auth & izin (semua role)
- [ ] Login salah/expired JWT, `GET /auth/me`, ganti password, `pos:unauthorized` logout.
- [ ] Matriks: admin penuh; kasir boleh POS/shift/absen/member/invoice.view tapi 403 `purchase.pay`, laporan, users, settings; gudang boleh POS/produk/stok/PO tapi 403 bayar supplier/laporan; operator fotokopi terisolasi.
- [ ] Izin custom per-user via halaman Pengguna: beri/cabut `report.view` ke gudang, verifikasi menu muncul/hilang tanpa relogin + API 403/200.
- [ ] Header `X-Business` salah/kosong, akses lintas usaha.

### C. POS & uang (inti)
- [ ] Buka shift → jual tunai pas/kurang/lebih → cek kembalian, struk, `sale_payments`.
- [ ] Split payment 2-3 metode + reference QRIS/transfer; total kurang tolak, lebih kembalian benar.
- [ ] Diskon item + transaksi + clamp tidak negatif; PPN incl vs excl; `tax_total/dpp` satu pembulatan level transaksi.
- [ ] Multi-satuan (pcs/dus): konversi stok, harga satuan benar, tier per `unit_id`.
- [ ] Tier qty + promo periode (tanggal/hari/jam, persen/nominal) + member: server pilih termurah; `promo_id/tier_id` tercatat; diskon manual di atas harga efektif.
- [ ] Member earn `floor(total/earn_per)` + redeem `min_redeem`, `maxRedeemable` FE vs BE; poin kembali saat void/retur.
- [ ] Paket bundling harga tetap (tanpa tier/promo), stok komponen kurang semua, retur/void kembalikan komponen.
- [ ] Scan barcode USB (Enter), multibarcode, barcode paket, kode tak dikenal; kamera hanya smoke bila HTTPS tersedia.
- [ ] Produk dihapus/nonaktif di hold/resume dilewati + toast; hold tanpa kunci stok (jual bersamaan tidak deadlock).
- [ ] Kredit grosir: wajib customer+`invoice.manage`, termin/due_date, uang muka parsial, kasir tanpa izin 403, `paid_amount/payment_status` update.

### D. Inventori, pembelian, FEFO
- [ ] PO draft→kirim→terima sebagian/penuh→bayar→batal; HPP moving average `round((stok*lama+terima*cost)/(stok+terima))`; `cost_price` historis tidak berubah.
- [ ] Batch expiry: terima 2 batch beda expiry → jual alokasi terdekat dulu (`NULLS LAST`); batch expired diblokir; retur/void ke batch asal (`sale_item_batches`).
- [ ] Opname tanpa tutup toko + adjustment + kartu stok; `allow_negative_stock` ON/OFF; concurrency 2 kasir jual stok terakhir (satu harus gagal rapi, stok tidak negatif).
- [ ] CSV impor/ekspor produk: duplikat barcode, kolom hilang, angka besar; `MAX_LINE_QTY=100000` dan qty raksasa.
- [ ] Konsinyasi: terima → jual → hutang dari `cost_price` → payout parsial/lunas; pastikan bukan beban laba (no double count).

### E. Shift, retur, void, absensi, beban, laporan
- [ ] Shift: buka 2x, tutup + selisih kas, jual shift tutup ditolak, void hanya hari ini + shift terbuka + audit log.
- [ ] Retur: qty ≤ `qty-returned`, HPP asli, laba terkoreksi, stok batch asal.
- [ ] Absensi masuk/pulang, koreksi admin, rekap; user non-admin 403 `GET /attendance`.
- [ ] Beban operasional bayar/belum; laba bersih = kotor − retur − beban; pembelian/payout penitip bukan beban.
- [ ] Dashboard KPI klik→detail; penjualan/kasir/metode/laba kotor/laba rugi/modal/top/low/stock-card; `APP_TIMEZONE` batas hari/bulan; semua `?format=csv`.
- [ ] Pengaturan PPN/struk/QRIS/poin/ambang expiry; upload >`MAX_UPLOAD_MB`, tipe file jahat; foto/QRIS tampil di struk/FE.

### F. FE/UX, cetak, ketahanan
- [ ] Navigasi semua 27 halaman, guard route + Sidebar konsisten, 404 → `/`.
- [ ] Shortcut F2/F4/F6/F7/F8/Alt+M/C/K/H/A, `1-4`, Enter/Esc di modal bertumpuk; fokus barcode default; scanner USB tidak picu Alt-shortcut.
- [ ] Cetak struk 58/80mm hanya `#receipt-print-area`; label paket 40×30mm hanya `#barcode-print-area`; SVG `bwip-js` valid.
- [ ] Validasi: input negatif/nol/kosong, tanggal invalid, `parseMoney/parseQty`, network putus saat checkout (no double charge — uji double-click/Enter, `submittingRef`).
- [ ] Keamanan: JWT tanpa token 401, token palsu, IDOR (`/sales/:id`, `/users/:id`), XSS di nama produk/member, SQL injection di `search`, path traversal upload.

## 6. Failure Modes & Edge Wajib
- DB down → `/health` 503; BE tanpa `JWT_SECRET`/contoh → refuse start; migrasi belum jalan → error skema jelas.
- Nomor dokumen bersamaan (`INV/RET/PO/OPN/EXP/HOLD-YYYYMMDD-NNNN`) tidak duplikat di transaksi konkuren.
- Jam promo batas (00:00/23:59), DST/timezone, produk tanpa kategori, member nonaktif, customer nonaktif, shift beda usaha.
- Jumlah uang besar (BIGINT) + qty maks: pastikan `Number` tidak presisi hilang sebelum simpan.

## 7. Bukti & Format Temuan
- Tiap bug: `judul | severity (Blocker/Major/Minor) | langkah reproduksi (klik/API + payload) | expected vs actual | bukti (screenshot/log/DB query/response) | modul/file:line bila tahu`.
- Pisahkan: bug terkonfirmasi live vs kandidat static belum reproduksi.
- Sertakan versi git (`git rev-parse --short HEAD`), `.env` tanpa secret, dan data seed yang dipakai.
- Jangan simpan password/token di laporan.

## 8. Kriteria Selesai
- Semua checklist A–F dijalankan atau ditandai skip beralasan; alur kritis README §11 lolos E2E minimal sekali.
- Daftar bug terurut severity + regresi multi-usaha (fotokopi tidak merusak minimarket).
- Tidak ada perubahan source di tahap QA; perbaikan/usulan di dokumen terpisah.

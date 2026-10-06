# Rencana: Jual ATK di Mode Fotokopi (Produk + Jasa dalam Satu Pesanan)

## Masalah
Di mode fotokopi **tidak ada cara menjual ATK** (produk retail). Menu fotokopi (`MENU_PRINT`, `Sidebar.jsx:73-93`) hanya berisi Pesanan/jasa; `print_order_items` hanya mendukung `service_id` (`init.sql:766-779`), tanpa dukungan produk. Jadi walau tabel `products` ada dan difilter per `business`, tidak ada pintu masuk untuk menjualnya.

## Keputusan terkunci
- **Gabung ATK ke dalam Pesanan**: satu pesanan `print_orders` bisa memuat **baris jasa** dan **baris produk ATK**, dihitung dalam satu nota/total.
- **Menu inti saja dulu**: cukup dari halaman **Pesanan** & **Buat Pesanan** yang sudah ada; tidak memunculkan menu Kasir/Produk terpisah dulu (boleh menyusul).
- Data produk ATK difilter `business = 'fotokopi'` (konsisten dengan pemisahan data multi-usaha).

## Kondisi saat ini (terverifikasi)
- `print_order_items` (`init.sql:766-779`) hanya punya `service_id`; `computeLine` & `buildLines` di `print_orders.js:45-122` hanya menangani jasa.
- Saat bayar (`print_orders.js:426-530`), item jasa ditulis ke `sale_items` dengan `product_id=NULL, service_id=...` — sudah ada pola untuk baris non-produk.
- `sale_items` sudah punya `product_id` nullable + `service_id` (`init.sql:781-783`), dan alur stok FEFO ada di `utils/batches.js` + `utils/stock.js`.
- Frontend form pesanan: `PrintOrderForm.jsx` (item jasa saja, `emptyItem` di `:44-52`).
- `products` sudah punya kolom `business` dan difilter per usaha di route produk.

## Perubahan yang diperlukan

### Bagian A — Skema (`backend/init.sql`, idempotent)
Perluas `print_order_items` agar bisa memuat produk:
```sql
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES product_units(id);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(20);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS cost_price BIGINT NOT NULL DEFAULT 0;
-- Baris bisa jasa (service_id) atau produk (product_id).
ALTER TABLE print_order_items ADD CONSTRAINT print_order_items_kind_check
  CHECK (service_id IS NOT NULL OR product_id IS NOT NULL);
```
- Tambahkan constraint secara aman: bungkus dengan `DO $$ ... $$` yang mengecek `pg_constraint` agar tidak error bila dijalankan ulang (pola migrasi idempotent yang sudah dipakai di repo).
- `qty` untuk produk = jumlah dalam satuan jual; tambahan `base_qty` bila ingin mencatat satuan dasar untuk stok:
```sql
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS base_qty INTEGER NOT NULL DEFAULT 0;
```

### Bagian B — Backend (`backend/routes/print_orders.js`)
1. **`buildLines`**: pisahkan item menjadi jasa (`service_id`) dan produk (`product_id`), lalu:
   - **Jasa**: seperti sekarang (`computeLine`).
   - **Produk**: kunci produk (`SELECT ... FOR UPDATE`), validasi `business='fotokopi'` & `is_active`, ambil harga jual (pakai `resolveItemsEffectivePricing` yang sudah ada agar member/tier/promo konsisten, atau minimal `sell_price`/`member_price`), hitung `line_total = qty * unit_price - discount`.
   - Kembalikan `lines` berisi `kind: 'service' | 'product'`.
2. **Kalkulasi stok**: validasi ketersediaan batch FEFO **saat bayar** (bukan saat draft), karena pesanan draft tidak boleh mengunci stok. Tampilkan peringatan bila stok kurang saat dibuat (opsional).
3. **`POST /:id/pay`** (`print_orders.js:489-499`): untuk baris produk:
   - Tulis `sale_items` dengan `product_id`, `unit_id`, `qty`, `base_qty`, `unit_price`, `cost_price` (HPP produk), `line_total`.
   - Kurangi stok via `allocateFefo` + `applyStockMovement` (pola sama `sales.js`), termasuk batch & `allow_negative_stock`.
   - Untuk baris jasa: tetap `product_id=NULL, service_id=...` seperti sekarang.
   - Total pesanan (`subtotal/grand_total`) sudah mencakup produk karena dihitung di `buildLines`.
4. **Detail & item JSON** (`loadDetail`, `print_orders.js:156-171`): join juga `products`/`product_units` agar item produk menampilkan nama/satuan dengan benar (`display_name`).
5. **`PUT /:id`**: `buildLines` versi baru otomatis menangani campuran jasa+produk saat edit (hanya sebelum dibayar).

### Bagian C — Frontend (`src/pages/PrintOrderForm.jsx`)
- Tambah **pemilih jenis item**: tombol **"+ Jasa"** dan **"+ Produk (ATK)"**.
- Baris produk: pilih produk (dropdown produk `business='fotokopi'`, pakai endpoint produk yang ada), pilih satuan (bila multi-satuan), qty, diskon; tampilkan harga & subtotal.
- Baris jasa: seperti sekarang.
- Nota & ringkasan total menampilkan kedua jenis baris (label "Jasa" vs "Produk").
- Cerminan kalkulator klien diperbarui agar total pratinjau mencakup produk.
- `PrintOrders.jsx` (daftar/detail): tampilkan item produk dengan label. `PrintReceipt`/nota: tampilkan baris produk.

### Bagian D — Menu & izin
- Cukup andalkan halaman **Pesanan** yang sudah ada (sesuai keputusan "menu inti dulu").
- Pastikan pengguna fotokopi punya izin untuk memilih produk: `print.use` sudah cukup; **tidak** perlu membuka menu Produk. (Bila nanti mau kelola stok ATK, buka menu Stok/Produk untuk mode fotokopi di fase berikut.)

## Yang TIDAK berubah
- Alur jasa murni tetap sama.
- Menu minimarket tidak berubah.
- Tidak menampilkan menu Kasir/POS terpisah di mode fotokopi (sesuai keputusan).

## Urutan Eksekusi
1. `init.sql`: perluas `print_order_items` (+ constraint kind, idempotent).
2. `print_orders.js`: `buildLines` dukung produk; `pay` kurangi stok produk; `loadDetail` join produk.
3. `PrintOrderForm.jsx`: tambah baris produk & kalkulasi.
4. `PrintOrders.jsx` + nota: tampilkan baris produk.
5. Verifikasi.

## Validasi
- `npm run lint`, `npm run build`, `cd backend && npm run check`; rebuild frontend+backend; migrasi `init.sql`; hard-refresh.
- Uji manual (mode fotokopi):
  1. Buat pesanan berisi **jasa** (fotokopi A4) + **produk ATK** (mis. pulpen) → total mencakup keduanya.
  2. Bayar → `sale_items` memuat baris jasa (`service_id`) dan produk (`product_id`); **stok ATK berkurang**; batch FEFO benar.
  3. Struk/nota menampilkan jasa & produk.
  4. Stok ATK kurang → ditolak saat bayar dengan pesan jelas.
  5. Edit pesanan (sebelum bayar) dengan menambah/menghapus produk → total diperbarui.
  6. Regresi: pesanan jasa murni tetap berjalan; minimarket tidak terpengaruh.

## Risiko
- **Stok saat draft vs bayar**: pesanan draft tidak mengunci stok; uji kasus stok habis antara draft dan bayar.
- **Harga produk** harus konsisten dengan resolver harga minimarket (member/tier/promo) — gunakan util yang ada agar tidak ada dua sumber kebenaran.
- **Constraint baru** pada `print_order_items` harus idempotent agar migrasi DB berjalan tidak gagal.
- **Kartu stok**: mutasi produk dari pesanan fotokopi tetap tercatat sebagai penjualan (`ref_type='sale'`), jadi laporan/kartu stok konsisten.

## Pertanyaan terbuka
1. **Harga produk ATK**: pakai harga normal saja, atau ikut resolver (member/tier/promo) seperti minimarket? (Rekomendasi: ikut resolver agar konsisten.)
2. **Satuan produk**: dukung multi-satuan (pilih satuan di baris produk)? (Rekomendasi: ya, bila produk punya satuan.)
3. **Kelola stok ATK**: cukup lewat pesanan, atau nanti perlu membuka menu Stok/Produk untuk fotokopi? (Rekomendasi: fase berikutnya.)

## Catatan implementasi
Mengubah skema DB, `print_orders.js`, dan 2–3 file frontend. Butuh rebuild frontend+backend + migrasi `init.sql`. Eksekusi oleh agent mode code.

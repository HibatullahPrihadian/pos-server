# Seed Master Jasa Fotokopi (7 Jasa Relevan)

## Tujuan
Tambahkan minimal 6 jasa fotokopi relevan sebagai data awal di mode fotokopi, agar menu Master Jasa (`/print-services`) langsung terisi di DB baru dan bisa dilengkapi di DB lama dengan rerun sekali.

## Konteks
- Tabel: `print_services` (`backend/init.sql:712-726`), kolom `business` default `'fotokopi'` (`:729`).
- API validasi (`backend/routes/print_services.js:13-63`): kategori ∈ `fotokopi, print, scan, laminating, jilid, lainnya`; `color_mode` ∈ `bw, color` atau null; wajib minimal satu harga > 0 (`price_per_page` / `price_per_sheet` / bundle).
- FE list + form: `src/pages/PrintServices.jsx`; label harga memakai `/lembar` bila `price_per_sheet > 0`, `/halaman` bila `price_per_page > 0`.
- Belum ada seed `print_services` (grep hanya menemukan INSERT di route POST). Migrasi DB baru via `docker-compose.yml:12` (`init.sql` → `01-init.sql`); DB lama update via rerun manual `init.sql` (lihat pesan error `backend/server.js:190-191`).
- Tidak ada UNIQUE pada `(business, name)` di `print_services`, jadi `ON CONFLICT DO NOTHING` tidak bisa dipakai — gunakan pola `INSERT ... SELECT ... WHERE NOT EXISTS` seperti seed supplier/produk di `backend/seed.sql:33-38`.

## Keputusan (disetujui user)
1. Daftar 7 jasa + harga default — semua `business='fotokopi'`, `is_active=TRUE`, `min_qty=1`.
2. Mekanisme: satu blok seed idempoten di `backend/init.sql` (bukan `seed.sql`, bukan bootstrap tiap start).
3. Perilaku hapus: baris seed = data biasa. Hapus via UI Master Jasa; belum dipakai pesanan → DELETE permanen; sudah dipakai → API 409, nonaktifkan saja (`print_services.js:119-144`). Rerun manual `init.sql` akan menanam ulang yang dihapus; start server biasa tidak rerun jadi aman.

## Data Seed (7 baris)

| # | name | category | paper_size | color_mode | price_per_sheet | price_per_page |
|---|------|----------|------------|------------|-----------------|----------------|
| 1 | Fotokopi A4 Hitam Putih | fotokopi | A4 | bw | 500 | 0 |
| 2 | Fotokopi F4 Hitam Putih | fotokopi | F4 | bw | 600 | 0 |
| 3 | Print A4 Hitam Putih | print | A4 | bw | 1000 | 0 |
| 4 | Print A4 Warna | print | A4 | color | 0 | 2500 |
| 5 | Scan Dokumen | scan | NULL | NULL | 2000 | 0 |
| 6 | Laminating A4 | laminating | A4 | NULL | 10000 | 0 |
| 7 | Jilid Spiral A4 | jilid | A4 | NULL | 15000 | 0 |

Catatan: skema hanya punya harga per lembar/halaman; Jilid dihitung per pcs tapi disimpan di `price_per_sheet` (UI tampil `/lembar`). Nama jelas ("Jilid Spiral A4") jadi tidak ambigu di nota.

## Tugas Implementasi
1. Di `backend/init.sql`, tambahkan blok seed SETELAH definisi tabel `print_services` (sekitar baris 726-730, sebelum/bersama blok expense fotokopi style), berisi 7x:
   ```sql
   INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
   SELECT '<name>', 'fotokopi', '<category>', <paper_size atau NULL>, <color atau NULL>, <ppp>, <pps>, 1, TRUE
   WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = '<name>' AND business = 'fotokopi');
   ```
   - `paper_size`/`color_mode` NULL ditulis eksplisit `NULL::VARCHAR` atau `CAST(NULL AS VARCHAR(20))` agar tipe konsisten.
   - Jangan tambah UNIQUE/CONSTRAINT baru; jangan ubah route/FE.
2. Verifikasi sintaks SQL (mis. `psql -f` pada DB test/kosong, atau minimal parse).
3. Verifikasi idempoten: jalankan blok 2x → tetap 7 baris, tidak duplikat.
4. Verifikasi API: `GET /api/print-services` (header `X-Business: fotokopi`) tampilkan 7 jasa aktif; buat 1 pesanan coba dari salah satu jasa untuk pastikan lolos `readPayload`.

## Risiko / Batasan
- Jilid tampil `/lembar` di UI (keterbatasan skema harga) — diterima, tidak perlu skema baru.
- DB lama hanya dapat seed setelah rerun manual `init.sql` sekali (perilaku migrasi yang sudah ada, bukan bagian tugas ini untuk mengubahnya).
- Harga default mengikuti pasar umum; user bisa ubah manual via Master Jasa.

## Validasi
- [ ] Rerun blok 2x → `SELECT count(*) FROM print_services WHERE business='fotokopi'` tetap +7 (tidak ganda).
- [ ] DB/volume baru (docker init) langsung berisi 7 jasa.
- [ ] Master Jasa tampilkan 7 baris aktif dengan harga benar; hapus/nonaktif tetap berfungsi normal.

# Fix: Tab Penitip Konsinyasi — Nama Hilang & "Server error" saat Simpan/Hapus

> Status:
> - Bagian **A** (nama/status hilang) sudah diimplementasi.
> - Bagian **B** (Server error saat Simpan/Hapus) adalah bug lanjutan yang sama akarnya (`PAYABLE_SQL` tidak mengembalikan kolom `id`) — **belum diperbaiki**.

## Gejala
Bagian A: Tab **Konsinyasi → Penitip**: kolom "Nama" kosong untuk semua baris, meski penitip sudah dibuat. Badge "Status" juga selalu tampil "Nonaktif".

Bagian B (baru): Menekan **Simpan** (edit penitip) atau **Hapus** memunculkan toast **"Server error"** dan aksi gagal.

## Akar Masalah
Query `PAYABLE_SQL` (backend/routes/consignment.js:29-51) mengembalikan kolom `consignor_name`, `consignor_id`, `phone`, `qty_sold`, `sold_value`, `paid_total`, `payable` — **tidak ada `name`** dan **tidak ada `is_active`**.

Frontend `src/pages/Consignment.jsx`:
- line 211 render `{c.name}` → `undefined` → sel kosong.
- line 215 render `c.is_active` → `undefined` → selalu Badge "Nonaktif".
- line 116 `openEdit` baca `c.name` → form Nama kosong saat edit.

Field lain (`c.phone`, `c.payable`) kebetulan cocok dengan alias SQL sehingga tampil normal.

## Akar Masalah Bagian B (Server error)
`PAYABLE_SQL` (backend/routes/consignment.js:30) hanya mengembalikan `c.id AS consignor_id` — **tidak ada kolom `id`**. Baris tabel penitip berasal dari query ini, jadi tiap `row.id` bernilai `undefined`.

Frontend `src/pages/Consignment.jsx` memakai `.id` di 3 tempat:
- line 124 `editing.id` → PUT `/api/consignment/consignors/undefined`
- line 141 `confirm.id` → DELETE `/api/consignment/consignors/undefined`
- line 210 `key={c.id}` → React key `undefined` (hanya warning)

Di backend, `req.params.id = 'undefined'` dibandingkan ke kolom integer `consignors.id` → Postgres error **22P02** (`invalid input syntax for type integer`). Tidak ada handler untuk kode 22P02 di `backend/middleware/error.js:19`, jadi jatuh ke fallback `500 { error: 'Server error' }` — persis pesan yang muncul. Bukan 404 "Penitip tidak ditemukan" karena error dilempar DB sebelum pengecekan baris.

## Perubahan

### A. Nama/Status (sudah dikerjakan)

#### 1. `backend/routes/consignment.js` — tambah kolom ke `PAYABLE_SQL`
Di SELECT utama `PAYABLE_SQL` (line 30):
```sql
SELECT c.id AS consignor_id, c.name AS consignor_name, c.phone, c.address, c.note, c.is_active,
```
Endpoint `/consignors`, `/consignors/:id`, `/payables` otomatis ikut.

#### 2. `src/pages/Consignment.jsx` — pakai alias yang benar
- line 211: `{c.name}` → `{c.consignor_name}`
- line 116 (`openEdit`): `name: c.name` → `name: c.consignor_name`

### B. Server error saat Simpan/Hapus (perlu dikerjakan)

Pilih **satu** pendekatan — rekomendasi: **B1** (frontend), karena `id` memang seharusnya dibaca dari alias `consignor_id` dan konsisten dengan `openPayout` yang sudah pakai `row.consignor_id` (line 152/160).

#### B1 (rekomendasi) — `src/pages/Consignment.jsx`, ganti `.id` → `.consignor_id`
- line 124: `editing.id` → `editing.consignor_id`
- line 141: `confirm.id` → `confirm.consignor_id`
- line 210: `<tr key={c.id}>` → `<tr key={c.consignor_id}>`

#### B2 (alternatif) — `backend/routes/consignment.js`, tambahkan `c.id AS id`
Menambah `c.id AS id` ke `PAYABLE_SQL` sehingga `row.id` terisi. Kurang dipilih karena menduplikasi `consignor_id` dan menyembunyikan ketidakcocokan nama kolom yang jadi akar bug.

### C. Pengerasan error handling (opsional, di luar scope inti)
`backend/middleware/error.js` dapat menangani `err.code === '22P02'` → 400 (mis. `'ID tidak valid'`), agar id non-numerik tidak lagi tampil sebagai 500 generik. Tidak wajib untuk bug ini; catat sebagai follow-up.

## Verifikasi
1. Buka **Konsinyasi → Penitip**: kolom Nama terisi, Badge Status sesuai (Aktif/Nonaktif).
2. Klik edit salah satu penitip → ubah nama → **Simpan**: sukses, toast "Penitip diperbarui", data ter-refresh (tidak ada "Server error").
3. Klik **Hapus** pada penitip yang tidak terikat produk → terhapus; pada penitip terikat produk → dinonaktifkan (pesan "dinonaktifkan (masih terkait produk)").
4. Cek tab **Hutang & Pembayaran** tetap normal.
5. Cek console browser: tidak ada warning React `key` duplikat/`undefined` pada baris tabel penitip.

## Catatan
- `consignor_name` dipertahankan sebagai alias SQL; dipakai juga di `/sales` dan `/payables` (konsisten).
- Tidak ada perubahan skema DB / migrasi.
- Setelah ubah file frontend/backend, container Docker harus di-`build` ulang: `docker compose up -d --build backend frontend` (restart saja tidak memuat kode baru karena kode dibundel ke image).

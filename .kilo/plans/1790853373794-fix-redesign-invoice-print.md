# Rencana: Perbaiki Bug Cetak + Redesain Invoice Grosir (mengikuti struktur Web-Invoice)

## Tujuan
1. **Perbaiki bug**: hasil cetak invoice **kosong/putih**.
2. **Redesain tampilan invoice** mengikuti struktur/desain proyek `Web-Invoice`, dengan **warna disesuaikan tema POS** (biru/glass) — bukan tema 3D-printing.
3. **Tambah pratinjau A4 di layar** sebelum mencetak.

## Akar masalah bug cetak (terverifikasi)
- Area cetak dirender di dalam `.invoice-print-hidden` (`src/index.css:145-151`): `position: fixed; left: -10000px; top: 0`.
- Saat print (`src/index.css:74-142`): `body * { visibility: hidden }`, lalu `#invoice-print-area { position: absolute; left:0; top:0 }` untuk memunculkan area cetak.
- **Penyebab**: `#invoice-print-area` berada **di dalam** ancestor `.invoice-print-hidden` yang `position: fixed; left:-10000px`. Karena `absolute` memposisikan relatif terhadap ancestor `fixed` tersebut, area cetak ikut terdorong keluar layar/kertas → **halaman cetak kosong**. Selain itu, tidak ada pratinjau di layar sehingga masalah tak terlihat sampai mencetak.

## Keputusan terkunci
- Gaya: **struktur mirip Web-Invoice**, **warna disesuaikan tema POS** (biru/glass, bukan cyan/3D-print).
- **Pratinjau A4 di layar** sebelum cetak (lembar A4 putih, tombol Cetak), sehingga bug cetak juga terlihat/diuji dengan mudah.
- Bank info: **tidak ada field bank di `store_settings`** → gunakan data yang ada (nama toko, alamat, telp, NPWP, catatan/footer). Info transfer bank **opsional**: hanya tampil bila ditambahkan field baru (lihat pertanyaan terbuka) — default: **tidak ditampilkan** kecuali diminta.

## Referensi desain (dari `Web-Invoice`)
File kunci yang jadi acuan struktur (bukan disalin warnanya):
- `Web-Invoice/src/components/InvoicePreview.jsx` — struktur: tricolor bar, kop+logo/tagline, badge status, blok "Ditujukan Kepada" + alamat, tabel item, panel "Total Tagihan" gelap, terbilang, info bank, tanda tangan, footer.
- `Web-Invoice/src/index.css` — `.invoice-sheet` (A4 210×297mm, padding 16mm, `@page A4 portrait`, `@media print` menyembunyikan `.no-print`).
- `Web-Invoice/src/utils/currency.js` — `formatRupiah`, `angkaTerbilang` (terbilang bahasa Indonesia).

## Perubahan yang diperlukan

### 0. Util terbilang (baru)
- Tambah `angkaTerbilang(n)` di `src/utils/formatters/currency.js` (atau util baru `src/utils/terbilang.js`), mengikuti algoritma `Web-Invoice/src/utils/currency.js:31-55`. Dipakai untuk baris "Terbilang".

### 1. Perbaiki mekanisme cetak (`src/index.css` + halaman)
- **Hapus pendekatan off-screen `.invoice-print-hidden`** untuk invoice. Ganti dengan **pratinjau modal A4** (lihat bagian 3) dan CSS cetak yang benar:
  - Saat print: `@page { size: A4 portrait; margin: 12mm; }`.
  - Sembunyikan seluruh aplikasi kecuali area cetak: `body * { visibility: hidden }` + `#invoice-print-area, #invoice-print-area * { visibility: visible }`.
  - **`#invoice-print-area` tidak boleh punya ancestor ber-`position: fixed`/ter-`transform`/ter-`filter`** (semua itu membuat containing block/stacking context yang merusak). Karena pratinjau ada di dalam `Modal`, pastikan:
    - Modal saat cetak di-render **inline di alur dokumen** (bukan fixed), atau
    - Area cetak di-render **di luar Modal** (mis. di root halaman) dan ditampilkan lewat state, dengan wrapper **tanpa** `position: fixed`.
  - Rekomendasi paling aman: **render `#invoice-print-area` di root halaman `Invoices.jsx`** (di luar modal), pada wrapper `display:none` di layar dan `display:block` saat `@media print` (bukan `position:fixed`), dan **juga** tampilkan pratinjau di dalam modal untuk layar. Dua render dari komponen yang sama (`InvoicePrint`) — satu untuk pratinjau layar, satu untuk cetak — atau satu render dengan CSS yang mengatur tampilan.
  - Hapus/hentikan pemakaian `.invoice-print-hidden` bila tidak lagi dipakai (atau ubah jadi `display:none` biasa, bukan `position:fixed`).
- Tambah util cetak kecil bila perlu (`printArea(id)`): fokus/tunggu render lalu `window.print()`.

### 2. Redesain komponen `src/components/invoice/InvoicePrint.jsx`
Struktur baru (mengikuti Web-Invoice, warna tema POS):
- **Bar atas** (aksen tema POS: biru/gradien `ios-blue`).
- **Kop**: nama toko (dari `settings.store_name`), alamat, telepon, NPWP. (Tanpa logo default; boleh ikon `Store`/`ShoppingBag` kecil bergaya tema.)
- **Judul + metadata** (kanan): label "INVOICE", `invoice_no`, tanggal terbit (`created_at`), **jatuh tempo** (`due_date`), **badge status**: `LUNAS` / `BAYAR SEBAGIAN` / `BELUM BAYAR` (dari `payment_status`), tanda `LEWAT JATUH TEMPO` bila `is_overdue`.
- **Blok "Ditujukan Kepada"**: `customer_name`, `customer_code`, alamat, telepon, NPWP pelanggan.
- **Tabel item**: #, Deskripsi (nama produk/paket + SKU), Qty + satuan, Harga, Diskon, Jumlah. (Data dari `invoice.items`.)
- **Rekap kanan**: Subtotal, Diskon Item, Diskon Transaksi, Tukar Poin, PPN (incl.), **TOTAL** (panel gelap/tema), **Dibayar**, **Sisa Tagihan**.
- **Kiri**: **Terbilang** (`angkaTerbilang(grand_total)`), catatan/footer dari `settings.receipt_footer`.
- **Riwayat Pembayaran** (bila ada `invoice.payments`).
- **Tanda tangan**: "Penerima" dan "Hormat kami (nama toko)".
- Semua teks tetap gaya POS (bukan 3D printing); hapus referensi bank/QRIS/signature image bila tidak ada datanya.

### 3. Pratinjau A4 di layar (`src/pages/Invoices.jsx`)
- Ganti `printInvoice` menjadi `openPreview(invoice)`:
  - Muat detail (`GET /api/invoices/:id` bila belum ada `items`), set `previewData`.
  - Buka **Modal** berisi pratinjau A4 (lembar putih, scroll) + tombol **Cetak** & **Tutup**.
- Tombol **Cetak** di modal memanggil `window.print()`; area cetak yang aktif adalah `#invoice-print-area`.
- Simpan pendekatan lama (langsung cetak) sebagai aksi sekunder bila diinginkan; default: **pratinjau dulu**.
- Pastikan modal pratinjau tidak merusak cetak: gunakan CSS `@media print` untuk menyembunyikan UI modal (header/tombol) dan hanya menampilkan `#invoice-print-area`.

### 4. CSS (`src/index.css`)
- Tambah kelas gaya invoice bertema POS: `invoice-sheet` (A4 210×297mm, padding 14–16mm, `box-shadow` layar, `box-sizing:border-box`), header, badge status (hijau/kuning/merah), tabel, panel TOTAL, tanda tangan, footer.
- Rapikan blok `@media print`: hanya `#invoice-print-area` terlihat; `@page { size: A4 portrait; margin: 12mm }`; pastikan tidak ada `position: fixed` pada ancestor area cetak.
- Pertahankan gaya struk (`.receipt-paper`) & label barcode (`.barcode-label`) yang sudah ada — jangan diubah.

## Yang TIDAK berubah
- Backend & API invoice (`/api/invoices`) tidak berubah (kecuali menambah field bank/settings bila dipilih — lihat pertanyaan terbuka). Data yang ditampilkan sudah tersedia di `GET /api/invoices/:id`.
- Logika pembayaran, void, stok — tidak berubah.
- Struk & label barcode tidak diubah.

## Urutan Eksekusi
1. Tambah `angkaTerbilang` (util).
2. Redesain `InvoicePrint.jsx` (struktur Web-Invoice, warna POS).
3. Tambah kelas CSS invoice + perbaiki `@media print` (hilangkan ketergantungan pada `.invoice-print-hidden` yang `position:fixed`).
4. `Invoices.jsx`: ganti alur cetak jadi **pratinjau modal A4** + tombol Cetak.
5. Verifikasi.

## Validasi
- `npm run lint` (0 warning), `npm run build`; rebuild frontend (`docker compose up -d --build frontend`) + hard-refresh.
- Uji manual (admin, `invoice.view`/`invoice.manage`):
  1. Buka Invoice Grosir → klik **Cetak/Preview** → **pratinjau A4 tampil** di layar dengan kop, pelanggan, item, total, jatuh tempo, badge status.
  2. Klik **Cetak** → dialog print browser; **hasil print berisi invoice** (bukan kosong).
  3. Ekspor PDF dari dialog print → 1 halaman A4 rapi; tidak ada sidebar/menu aplikasi yang ikut.
  4. Invoice dengan pembayaran sebagian → badge "BAYAR SEBAGIAN", baris "Dibayar" & "Sisa Tagihan" benar.
  5. Invoice lewat jatuh tempo → ada indikator telat.
  6. Terbilang sesuai total (mis. Rp206.500 → "Dua Ratus Enam Ribu Lima Ratus Rupiah").
  7. Item paket tampil benar (nama paket + label PAKET).
  8. Invoice tanpa item/edge case tidak membuat blank.
  9. Regresi: struk POS & label barcode tetap tercetak normal.

## Risiko
- **Ancestor `fixed`/`transform`/`filter`** adalah biang kerok bug blank; pastikan area cetak benar-benar bebas dari itu. Modal (yang biasanya `fixed`) harus dinetralkan saat print atau area cetak dirender di luar modal.
- **Duplikasi render** (pratinjau + cetak): pastikan hanya **satu** `#invoice-print-area` aktif saat print (id unik), agar tidak tercetak dobel. Saran: beri id berbeda untuk pratinjau (`invoice-preview-sheet`) dan area cetak (`invoice-print-area`), lalu saat print sembunyikan pratinjau dan tampilkan area cetak.
- **Data bank**: tidak ada di settings; jangan tampilkan blok bank kosong.
- Ukuran kertas: uji dengan printer/PDF A4; margin `@page` bisa berbeda per browser.

## Pertanyaan terbuka
1. **Info rekening bank** pada invoice: perlu ditambahkan field baru di Pengaturan (nama bank, no rekening, atas nama) agar tercetak? Rekomendasi: **tambah opsional** (kolom `bank_name`, `bank_account`, `bank_holder` di `store_settings`) — bila setuju, ini menambah migrasi kecil + field di halaman Pengaturan.
2. **Logo toko**: pakai inisial/nama saja (rekomendasi) atau perlu upload logo toko?
3. **Aksi default tombol di daftar invoice**: selalu buka **pratinjau** dulu (rekomendasi) atau tetap ada tombol cetak langsung?

## Catatan implementasi
Mengubah `src/components/invoice/InvoicePrint.jsx`, `src/pages/Invoices.jsx`, `src/index.css`, dan menambah util terbilang. Bila pertanyaan #1 disetujui, juga menambah kolom `store_settings` (migrasi `init.sql`), route settings, dan field di halaman Pengaturan. Butuh rebuild frontend (+ backend bila ada perubahan settings). Eksekusi oleh agent mode code.

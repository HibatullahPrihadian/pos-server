# Rencana: Perbaiki Halaman Pertama Kosong saat Export/Cetak Invoice

## Gejala
Saat mencetak/export PDF invoice, **halaman 1 kosong** dan **halaman 2 berisi invoice**. (Isu warna `print-color-adjust` sudah diperbaiki sebelumnya dan tidak terkait.)

## Akar Masalah (terverifikasi di kode)
- Aplikasi disembunyikan saat print memakai `visibility: hidden`, BUKAN `display: none` (`src/index.css:85-88`):
  ```css
  body * { visibility: hidden; }
  ```
  Elemen ber-`visibility: hidden` **tetap memakan ruang layout**, hanya tidak terlihat.
- Node invoice di-portal ke `document.body` (`src/pages/Invoices.jsx:438-441`), sehingga berada **setelah** seluruh layout aplikasi (`#root`) di dalam alur dokumen.
- `#invoice-print-area` sengaja **tidak** memakai `position: absolute` (agar tidak kena bug containing-block dari ancestor `fixed`). Akibatnya ia mengalir normal setelah layout aplikasi yang tinggi/overflow (`MainLayout` memakai `h-screen overflow-hidden`, `main` `overflow-y-auto`).
- Saat printer memaginasi dokumen, konten aplikasi yang tidak terlihat (tetap berukuran ~tinggi viewport penuh) menghabiskan halaman 1; invoice baru muncul di halaman 2.
- Pembanding: `#receipt-print-area` (`:95-102`) dan `#barcode-print-area` (`:114-121`) memakai `position: absolute; left:0; top:0` sehingga keluar dari alur dan tercetak di halaman 1 — itu sebabnya struk tidak mengalami masalah ini.

## Keputusan yang Diusulkan
Keluarkan seluruh konten aplikasi dari alur saat mencetak **invoice**, tanpa merusak struk/barcode (yang dirender di dalam `#root`, bukan portal).

**Pendekatan terpilih: scoping via class di `<body>` saat pratinjau invoice dibuka.**
- Saat `previewOpen` bernilai true, tambahkan class ke `document.body`, mis. `invoice-printing`.
- Di `@media print`, sembunyikan `#root` sepenuhnya (bukan sekadar `visibility`) hanya ketika class ini aktif:
  ```css
  @media print {
    body.invoice-printing #root {
      display: none !important;
    }
  }
  ```
- Karena node invoice adalah portal yang merupakan **saudara** `#root` di bawah `body`, men-`display:none`-kan `#root` menghilangkan semua konten aplikasi dari alur, sehingga `#invoice-print-area` menjadi konten pertama dan tercetak di halaman 1.
- Struk & barcode tidak terpengaruh karena class `invoice-printing` hanya aktif saat pratinjau invoice terbuka; saat mencetak struk/barcode, `#root` tetap tampil dan aturan `position:absolute` lama tetap bekerja.

### Alasan tidak memilih alternatif lain
- `position: absolute` pada invoice: berisiko untuk konten multi-halaman dan mengembalikan kerapuhan containing-block.
- `display:none` pada `#root` tanpa scoping: akan **merusak** struk/barcode yang dirender di dalam `#root`.

## Perubahan yang Diperlukan
1. `src/pages/Invoices.jsx`
   - Tambah `useEffect` untuk menambah/melepas class `invoice-printing` pada `document.body` berdasarkan `previewOpen`:
     ```jsx
     useEffect(() => {
       document.body.classList.toggle('invoice-printing', previewOpen);
       return () => document.body.classList.remove('invoice-printing');
     }, [previewOpen]);
     ```
     (Bersihkan saat unmount juga.)
2. `src/index.css`
   - Di dalam blok `@media print` yang sudah ada, tambahkan:
     ```css
     body.invoice-printing #root {
       display: none !important;
     }
     ```
   - Biarkan aturan invoice yang ada (`visibility: visible` pada `#invoice-print-area`) tetap.

## Yang TIDAK Berubah
- Struktur `InvoicePrint.jsx`, warna/desain invoice.
- CSS struk (`.receipt-paper`, `#receipt-print-area`) dan label barcode (`#barcode-print-area`) beserta aturan `position:absolute`-nya.
- Data, API, backend.
- Alur pratinjau/cetak yang sudah ada.

## Validasi
1. `npm run lint` (0 warning), `npm run build`.
2. Rebuild frontend: `docker compose up -d --build frontend`, hard-refresh browser.
3. Buka pratinjau invoice → **Cetak**:
   - Halaman 1 langsung berisi invoice (tidak ada halaman kosong).
   - Ekspor PDF hanya 1 halaman berisi invoice.
4. Regresi wajib:
   - Cetak struk POS (`POS.jsx` / `Transactions.jsx`) → tetap 1 halaman struk, tidak kosong, tidak terpengaruh.
   - Cetak label barcode paket → tetap normal.
5. Tutup pratinjau, lalu `Ctrl+P` dari halaman invoice tanpa pratinjau terbuka → tidak mencetak invoice lama (karena class dilepas), dan tidak ada regresi tak terduga.

## Risiko
- Bila class `invoice-printing` lupa dilepas (mis. error saat unmount), `#root` akan ikut hilang saat print berikutnya. Mitigasi: `return` cleanup pada `useEffect` + toggle berdasarkan `previewOpen`.
- Men-`display:none` `#root` juga menyembunyikan modal pratinjau saat print — memang diinginkan; area cetak ada di luar `#root` (portal), jadi tetap tercetak.

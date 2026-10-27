# Changelog

Semua perubahan penting pada aplikasi POS Minimarket dicatat di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), dan
project ini memakai [Semantic Versioning](https://semver.org/lang/id/).

## Cara kerja versioning

- **Sumber kebenaran versi** adalah file `VERSION` di root repository. Nilai
  `version` pada `package.json` (root dan `backend/`) selalu disinkronkan ke
  file tersebut, jadi versi hanya ditulis di satu tempat.
- **Perintah release**:
  - `npm run release` — bump versi otomatis dari conventional commit, perbarui
    `VERSION` + `package.json` (root & `backend/`) + `CHANGELOG.md`, buat commit
    `chore(release): vX.Y.Z`, tag `vX.Y.Z`, lalu push commit dan tag.
  - `npm run release:dry` — simulasi (dry-run): menampilkan versi baru dan daftar
    commit tanpa mengubah file, commit, tag, atau push.
- **Format commit**: `feat|fix|perf|refactor|chore(scope): deskripsi`.
- **Aturan naik versi** (otomatis, berdasarkan tipe commit):
  - `feat` → **minor** (1.0.0 → 1.1.0)
  - `fix`, `perf` → **patch** (1.0.0 → 1.0.1)
  - `!` setelah tipe atau `BREAKING CHANGE:` di body commit → **major** (1.0.0 → 2.0.0)
- **Release GitHub** dibuat otomatis oleh GitHub Actions saat tag `v*` di-push;
  catatan rilis diambil dari bagian CHANGELOG versi tersebut.

## [1.0.0] - 2026-10-27

Rilis baseline: seluruh fitur yang ada sebelum sistem versioning.

### Ditambahkan

- **Sistem versioning otomatis** — file `VERSION` sebagai sumber kebenaran
  versi; `npm run release` menaikkan versi otomatis dari conventional commit
  (`feat` → minor, `fix`/`perf` → patch), membuat tag `vX.Y.Z` dan GitHub
  Release setiap kali fitur di-merge ke `main`. Versi dibaca lewat endpoint
  publik `GET /api/version` (tanpa autentikasi) dan ditampilkan di Settings,
  sidebar, serta manifest PWA.
- **POS minimarket (kasir)** — layar kasir satu kolom (bar scan/pencarian di
  atas, keranjang, ringkasan TOTAL + Bayar menempel di bawah), scan barcode via
  scanner USB maupun kamera HP, multi-satuan (pcs/dus/karton) dengan faktor
  konversi, multibarcode, diskon per item & per transaksi, pembayaran tunai/QRIS/
  debit/transfer dengan split payment, QRIS statis toko, hitung kembalian, dan
  cetak struk thermal 58 mm (serta 80 mm).
- **Shortcut kasir** — F2 (fokus pencarian), F4 (dialog pembayaran), F6/Alt+H
  (tahan keranjang), F7/Alt+A (daftar hold), F8 (bayar tunai), Alt+M/C/K,
  alias huruf tunggal, navigasi list & dialog pembayaran tanpa mouse.
- **Hold & resume order** — simpan keranjang sementara (tahan), lanjutkan
  belanja yang tertahan, tidak mengunci stok, kode `HOLD-YYYYMMDD-NNNN`.
- **Mode usaha fotokopi** — mode multi-business (minimarket & fotokopi), master
  jasa cetak, pesanan cetak yang dapat dicampur dengan pembelian barang ATK,
  inventaris ATK, dan pencahuan kasir mode fotokopi.
- **Produk & stok** — master produk (foto, kategori, satuan, barcode tambahan,
  harga member), impor/ekspor CSV, stok berkurang otomatis saat penjualan,
  HPP moving average saat penerimaan, stok opname tanpa tutup toko, penyesuaian
  stok, kartu stok, peringatan stok minimum.
- **Batch & kedaluwarsa (FEFO)** — stok disimpan per batch dengan tanggal
  kedaluwarsa sendiri, penjualan memakai batch terdekat kedaluwarsa, penjualan
  batch kedaluwarsa diblokir, retur/void mengembalikan stok ke batch asal, dan
  peringatan kedaluwarsa di dashboard.
- **Pembelian & supplier** — purchase order (draft → dikirim → diterima
  sebagian/penuh), pembayaran pembelian, pencatatan supplier, nomor dokumen
  `PO-YYYYMMDD-NNNN`.
- **Retur** — retur per item dari struk, pengembalian stok memakai HPP asli,
  penyesuaian poin, nomor dokumen `RET-YYYYMMDD-NNNN`.
- **Konsinyasi** — penitip (consignor), barang titipan, laporan penjualan
  titipan, rekap hutang ke penitip, serta pencatatan pembayaran hutang titipan.
- **Invoice grosir kredit & piutang** — data pelanggan B2B dengan limit kredit,
  faktur kredit grosir dengan jatuh tempo, pelunasan sebagian/penuh, status
  pembayaran & keterlambatan, rekap piutang per pelanggan, dan cetak faktur A4.
- **Member & poin** — master member, harga khusus member, kumpulan poin
  (earn) dan penukaran poin (redeem) sesuai pengaturan.
- **Bundle, promo & tier harga** — paket bundling (harga tetap, stok tiap
  komponen berkurang otomatis, generate barcode EAN-13 & cetak label barcode),
  promo periode (produk/kategori, jam/hari/tanggal, persen/nominal/harga batch),
  dan harga bertingkat (tier harga) per jumlah pembelian; server memilih harga
  efektif termurah.
- **Absensi & shift** — absen masuk/pulang mandiri dari layar, koreksi dan rekap
  absensi oleh admin, shift kasir dengan kas awal, rekap penjualan, dan
  selisih kas saat tutup shift.
- **Laporan** — penjualan harian/periode, per kasir, per metode bayar, laba
  kotor, laba rugi, modal (pembelian lunas), produk terlaris, stok minimum,
  kartu stok, beban operasional (gaji/sewa/listrik) dengan kategori & status
  bayar, serta ekspor CSV untuk seluruh laporan.
- **Dashboard KPI & laba rugi** — kartu KPI interaktif (penjualan, laba kotor,
  laba bersih, modal) yang dapat diklik menuju detail, grafik tren penjualan,
  serta laporan bulanan PDF dengan insight AI.
- **PWA installable & responsif** — manifest PWA + service worker
  (`vite-plugin-pwa`), tampilan responsif untuk HP, tablet, dan desktop, serta
  aksesibilitas pada modal.
- **Hak akses per role** — preset peran admin/kasir/gudang/operator fotokopi
  dengan izin granular per pengguna per modul, dimuat dari database per request
  sehingga perubahan izin langsung berlaku tanpa login ulang.

### Diperbaiki

- **Kualitas full-stack** — 40 temuan QA (blokir, mayor, minor) diperbaiki
  pada modul kasir, produk, pembelian, retur, dan laporan.
- **Konsinyasi** — perbaikan tab penitip dan rekap hutang konsinyasi.

### Performa

- **Backend** — menghapus N+1 query pada modul purchases, reports, returns,
  dan stock.

### Diubah

- **Layout POS** — layar kasir dirapikan menjadi satu kolom, item keranjang
  dibuat ringkas, dan pencarian memakai portal dropdown.
- **Dashboard** — grafik tren line chart penjualan bulanan dari branch fitur
  digabung ke `main`.
- **Dokumentasi** — README dan `.env.example` diperbarui untuk fitur baru.

## Format entri

- Setiap entri memakai heading `## [X.Y.Z] - YYYY-MM-DD` (versi tanpa prefix
  `v`), ditulis dari versi terbaru ke versi lama.
- Isi entri memakai sub-heading Keep a Changelog, ditulis dalam Bahasa Indonesia:
  - `### Ditambahkan` — fitur baru, biasanya dari commit `feat`.
  - `### Diperbaiki` — perbaikan cacat, biasanya dari commit `fix`.
  - `### Performa` — perbaikan performa, biasanya dari commit `perf`.
  - `### Diubah` — perubahan perilaku, biasanya dari commit `refactor`.
  - `### Catatan` — catatan rilis tambahan dari flag `--notes`.
- Tulis perubahan secara ringkas dan menyebut modul yang terdampak, contoh:
  `feat(pos): tambah shortcut F7` → `### Ditambahkan` — "Shortcut F7 untuk membuka
  daftar hold pada layar kasir."
- Entri versi baru dibuat otomatis oleh `npm run release` dari daftar commit
  sejak tag sebelumnya, disisipkan di atas entri versi paling lama, dan
  diakhiri tautan perbandingan ke versi sebelumnya. Entri `1.0.0` di atas
  ditulis manual sebagai baseline (tanpa tautan perbandingan).

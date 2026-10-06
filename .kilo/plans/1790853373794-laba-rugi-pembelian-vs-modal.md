# Rencana: Perjelas Baris "Pembelian Stok" vs "Modal" di Laporan Laba Rugi

## Tujuan
Menghilangkan kebingungan klien antara **Pembelian Stok (total PO)** dan **Modal (PO yang sudah lunas)** dengan menampilkan **dua baris terpisah** di bagian "Informasi (tidak mengurangi laba)" pada tab **Laba Rugi**.

## Latar (temuan terverifikasi)
Saat ini tab Laba Rugi hanya menampilkan satu baris **"Pembelian Stok"** = `info.purchase_total` = `SUM(purchases.total)` untuk semua PO periode itu kecuali `cancelled` (`reports.js:292-298`). Sementara tab **Modal** memakai `purchase-paid` yang hanya menghitung PO `payment_status='paid'` (`reports.js:385-393`). Akibatnya dua angka berbeda dan terlihat tidak konsisten.

## Keputusan
- Pertahankan definisi masing-masing (jangan ubah rumus).
- Di blok Informasi Laba Rugi, tampilkan **dua baris**:
  1. **Pembelian Stok (total PO)** — semua PO periode (kecuali cancelled).
  2. **Sudah Dibayar (Modal)** — hanya PO lunas penuh (`payment_status='paid'`).
- Tambah penjelasan singkat bahwa selisihnya = PO yang belum lunas penuh.

## Perubahan yang diperlukan

### 1. Backend — `backend/routes/reports.js` (endpoint `/profit-loss`)
- Tambah satu query ringkas (pola sama dengan `purchaseResult`, `reports.js:293-298`) untuk modal lunas dalam rentang yang sama:
  ```sql
  SELECT COALESCE(SUM(total), 0)::bigint AS purchase_paid
  FROM purchases
  WHERE payment_status = 'paid' AND status <> 'cancelled'
    AND date >= $1::date AND date <= $2::date
  ```
- Tambahkan hasilnya ke blok `info` pada respons (`reports.js:373-376`):
  ```js
  info: {
    purchase_total: Number(purchaseResult.rows[0].purchase_total),
    purchase_paid: Number(purchasePaidResult.rows[0].purchase_paid),
    consignment_payout: Number(payoutResult.rows[0].consignment_payout),
  }
  ```
- Tambahkan juga ke **ekspor CSV** tab `profit-loss` bila baris info ikut diekspor (cek `sendCsv`/`wantsCsv` di endpoint ini; tambahkan baris "Sudah Dibayar (Modal)" agar konsisten dengan tampilan).

### 2. Frontend — `src/pages/Reports.jsx` (cabang `profit-loss`)
- Di blok "Informasi (tidak mengurangi laba)" (`Reports.jsx:298-314`), ubah baris "Pembelian Stok" dan tambahkan baris baru **"Sudah Dibayar (Modal)"**:
  ```jsx
  <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
    <span className="text-sm text-slate-300">Pembelian Stok (total PO)</span>
    <span className="text-white">{formatCurrency(data.info?.purchase_total ?? 0)}</span>
  </div>
  <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
    <span className="text-sm text-slate-300">Sudah Dibayar (Modal)</span>
    <span className="text-white">{formatCurrency(data.info?.purchase_paid ?? 0)}</span>
  </div>
  ```
- Perbarui teks penjelas (`Reports.jsx:309-312`) agar menyebut: "Pembelian Stok = total PO periode ini; Sudah Dibayar (Modal) = PO yang sudah lunas penuh. Selisihnya adalah PO yang belum lunas penuh. Keduanya mengubah kas menjadi persediaan (aset), bukan beban; HPP sudah otomatis dikurangkan saat barang terjual."
- Akses aman `data.info?.purchase_paid ?? 0` (hindari error bila backend lama; konsisten dengan guard `dataTab` yang sudah ada).

## Yang TIDAK berubah
- Rumus `purchase-paid` (tab Modal) dan `purchase_total` tetap sama.
- Perhitungan laba kotor/bersih tidak berubah — keduanya tetap baris **informasi**.
- KPI Dashboard "Modal" tidak berubah.
- Tidak ada migrasi DB.

## Urutan Eksekusi
1. `reports.js`: tambah query `purchase_paid` di `/profit-loss` + masukkan ke `info` (+ CSV).
2. `Reports.jsx`: tambah baris kedua + perbarui teks penjelas.
3. Verifikasi.

## Validasi
- `npm run lint` (0 warning), `npm run build`, `cd backend && npm run check`; rebuild **backend + frontend** + hard-refresh.
- Uji manual (admin) di tab **Laba Rugi**:
  1. Periode dengan PO lunas & belum lunas → dua baris tampil dengan nilai berbeda; **"Sudah Dibayar (Modal)"** = ringkasan Total di tab **Modal** untuk rentang sama.
  2. **"Pembelian Stok (total PO)"** ≥ **"Sudah Dibayar (Modal)"**; selisihnya = PO belum lunas.
  3. Semua PO lunas → kedua angka sama.
  4. Tidak ada PO → keduanya Rp0 (bukan blank/error).
  5. Ekspor CSV Laba Rugi memuat kedua baris konsisten dengan tampilan.
  6. Tab lain (Modal, Laba Kotor, dsb.) tidak berubah.

## Risiko
- Rendah. Hanya menambah satu query + satu baris UI. Pastikan label tidak tertukar dan akses aman (`?? 0`).
- Konsistensi CSV: pastikan baris baru ikut diekspor agar laporan tercetak sama dengan layar.

## Catatan implementasi
Mengubah `backend/routes/reports.js` dan `src/pages/Reports.jsx`. Butuh rebuild frontend + backend. Eksekusi oleh agent mode code.

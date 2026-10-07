# Plan: Chart Tren Dashboard → Isi Penuh Tinggi Card

## Gejala
Screenshot: card "Tren Penjualan Bulan Ini" (kolom kiri `lg:col-span-2`) membentuk sangat tinggi karena grid menariknya setinggi kolom kanan (Produk Terlaris + Batch + Pintasan), tetapi line chart-nya hanya `h-48` (192px) di atas — sisa badan card kosong.

## Penyebab (terverifikasi di worktree)
- `src/components/charts/TrendLineChart.jsx:50` — wrapper chart fixed `h-48 w-full`.
- Ketiga card chart hanya pakai `className="lg:col-span-2"` tanpa flex; `Card` (`src/components/ui/Card.jsx`) sudah mendukung `className`, `bodyClassName`, `padded` — grid item stretch default membuat card setinggi kolom, tapi isi chart tidak ikut memanjang.

## Keputusan desain
1. **Chart tumbuh mengisi card** (bukan mengecilkan card / membatasi kolom kanan). Line chart ~31 titik justru lebih terbaca bila memakai tinggi penuh.
2. **Tinggi minimum 192px** (`min-h-48`) dipertahankan — untuk layout mobile (grid 1 kolom) dan empty state.
3. **Tanpa perubahan `Card.jsx`** — pakai props yang sudah ada: `className` + `bodyClassName`.
4. Scope: hanya frontend (`TrendLineChart.jsx` + 3 pemakaian card). Backend tidak berubah.

## Perubahan

### 1. `src/components/charts/TrendLineChart.jsx`
- Wrapper root chart (baris 50): `className="h-48 w-full"` → `className="flex-1 min-h-48"`.
- Empty state: teks tetap sama; opsional rapikan agar rata tengah vertikal (`py-8` → `h-full flex items-center justify-center` pada `<p>` / pembungkus) supaya tidak menempel di atas saat card tinggi.
- `ResponsiveContainer` tetap `width="100%" height="100%"` — tinggi mengikuti parent `flex-1`.

### 2. `src/pages/Dashboard.jsx` (2 card)
Untuk **kedua** card chart (PrintDashboard ~131, MinimarketDashboard ~291):
```jsx
<Card
  title="..."
  className="lg:col-span-2 flex flex-col"
  bodyClassName="flex-1 min-h-48 flex flex-col"
>
  <TrendLineChart ... />
</Card>
```
- `flex flex-col` di root: body (`flex-1`) merebut sisa tinggi card hasil stretch grid.
- `flex flex-col` di body: `TrendLineChart` (`flex-1`) merebut tinggi konten badan; `min-h-48` menjamin ≥192px.
- Props `padded` default (`p-5`) tetap berlaku — komposisi kelas aman.

### 3. `src/pages/OwnerDashboard.jsx` (1 card, ~85)
Perlakukan sama seperti di atas untuk card "Tren Gabungan Bulan Ini".

## Yang TIDAK berubah
- `Card.jsx`, query/backend, data shape trend, judul card, warna/tooltip chart.
- Konfigurasi grid (tetap `lg:grid-cols-3`, chart `lg:col-span-2`).

## Validasi
1. `npm run lint` (0 warning) + `npm run build`.
2. Rebuild **frontend saja** (backend tidak berubah): `docker compose up -d --build frontend`; hard-refresh.
3. Uji visual:
   - Layar lebar (dashboard minimarket): chart memenuhi tinggi card, tidak ada ruang kosong besar di bawah garis.
   - Owner `/overview`: "Tren Gabungan Bulan Ini" sama penuhnya.
   - Fotokopi: "Pendapatan Bulan Ini" sama.
   - Mobile / 1 kolom: chart tetap minimal setinggi `h-48`, tidak terpotong.
   - Empty state (semua total 0): teks empty tetap tampil, layout tidak rusak.

## Risiko
- Rendah: perubahan CSS/layout murni. Satu-satunya jebakan adalah lupa `flex flex-col` di root card → body `flex-1` tidak bekerja dan chart kembali pendek (kondisi seperti sekarang).
- Pastikan ketiga card dapat perlakuan identik agar konsisten kosmetik.

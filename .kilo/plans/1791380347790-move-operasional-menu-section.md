# Fix chart tren kosong #2: flex-1 mengalahkan h-[400px]

## Context
Perubahan sebelumnya (`min-h-[400px]` → `h-[400px]`) tidak memperbaiki: chart masih kosong (`src/pages/Dashboard.jsx:297`, `bodyClassName="flex-1 h-[400px] flex flex-col"`).

**Root cause baru:** `flex-1` = `flex: 1 1 0%` → `flex-basis: 0%` meng-**override** properti `height` di sumbu utama (Card root + body = flex column). Jadi `h-[400px]` tidak pernah berlaku; tinggi body jatuh ke konten (wrapper `min-h-48` = 192px + padding ≈ screenshot 2). Sebab kedua tetap sama: tanpa `height` **eksplisit** di rantai DOM, `<ResponsiveContainer height="100%">` (`node_modules/recharts/lib/component/ResponsiveContainer.js:155-166`, diukur via `getBoundingClientRect`) resolve ke `auto` → tinggi 0 → chart tak tergambar.

Layout lama bekerja karena Card = grid item yang di-stretch → tinggi definite dari baris grid.

## Task — 1 baris

`src/pages/Dashboard.jsx:297`:

```diff
- bodyClassName="flex-1 h-[400px] flex flex-col"
+ bodyClassName="h-[400px] flex flex-col"
```

Mengapa cukup (rantai setelah fix):
1. Card root `flex flex-col`, height auto; body flex item dengan `flex-basis: auto` → `height: 400px` berlaku (flex-grow 0) → body **definite 400px** (border-box, `p-5` termasuk).
2. Wrapper chart (`flex-1 min-h-48`, `TrendLineChart.jsx:54`) tumbuh di kontainer definite → used height = 360px, **definite**.
3. `ResponsiveContainer` `height:100%` resolve ke 360px → chart render (sumbu + garis).

Tidak ada file lain diubah: `TrendLineChart` (dipakai juga PrintDashboard), `PrintDashboard` (grid-definite, tetap jalan), kartu bawah, KPI — tidak disentuh.

### Risks
- Tinggi terkunci 400px (bukan min) — diinginkan.
- Mobile ikut 400px — wajar.

### Fallback bila masih kosong (urut prioritas)
- a. Body tanpa flex sama sekali: `bodyClassName="h-[400px]"` + wrapper chart diberi tinggi eksplisit via style inline di `TrendLineChart` **hanya bila** prop baru `height` disetel dari Dashboard (hindari ubah PrintDashboard).
- b. Angka eksplisit ke recharts: ganti `height="100%"` → `height={360}` sementara untuk buktikan teori, lalu kembali ke persen + perbaiki DOM.

## Validation
1. `npm run lint` lalu `npm run build`.
2. `docker compose up -d --build frontend` (workdir root repo).
3. Buka https://localhost:9999 → chart tampil: garis biru, sumbu X tanggal `DD/MM`, sumbu Y `rb/jt`; plot ±360px; lebar penuh.
4. Tren tanpa penjualan → teks "Belum ada penjualan" tetap muncul.
5. Resize window → chart ikut lebar; kartu bawah tetap 3 kolom ≥1024px; mode fotokopi (dashboard "Pendapatan Bulan Ini") tidak berubah.
6. Catat di console browser tak ada warning recharts "height of chart should be greater than 0".

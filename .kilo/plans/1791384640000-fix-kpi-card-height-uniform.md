# Fix Tinggi Kartu KPI Tidak Seragam — "Laba Kotor Bulan Ini"

## Masalah
Kartu **Laba Kotor Bulan Ini** (`Dashboard.jsx:259-266`) tampak beda tinggi sendiri
dibanding kartu lain di barisnya. Penyebab: `sub={null}` (`:263`).

`KPI` (`Dashboard.jsx:33`) hanya merender baris sub bila `sub` truthy:
```jsx
{sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
```
Kartu lain punya sub-line (3 baris teks: label + nilai + sub). Kartu tanpa sub cuma
2 baris → tinggi konten beda. Grid `align-items: stretch` melar-kan wrapper, tapi
konten di dalam jadi tidak sejajar / renggang.

## Fix (1 baris)
Ubah `src/pages/Dashboard.jsx:33`:
```jsx
// dari:
{sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
// jadi:
<p className="text-xs text-slate-500 mt-1">{sub || '\u00A0'}</p>
```
`\u00A0` (non-breaking space) → baris sub selalu dirender, tinggi seragam, tanpa
menampilkan angka menyesatkan.

## Aman?
- Hanya ada satu `sub={null}` di seluruh `src/` (terverifikasi via grep).
- Semua kartu lain `sub` truthy → `sub || '\u00A0'` mengembalikan nilai sama.

## Verifikasi
- `npx eslint src/pages/Dashboard.jsx`
- `npm run build`
- Manual: seksi Penjualan & Laba → semua kartu sama tinggi, sejajar.

## Alternative (bila user ganti pikiran)
Isi `sub` Laba Kotor Bulan Ini dengan data asli (mis. PPN bulanan) — butuh backend
mengekspor `month.tax_total` (kini tidak ada, `reports.js:1044-1056`). Di luar scope.

# KPI Card Dashboard Minimarket — Seksi Penjualan & Laba jadi Grid 3 Kolom × 2 Baris

## Goal
Ubah seksi **Penjualan & Laba** dari grid 2 kolom (3 baris) jadi **grid 3 kolom × 2 baris**
agar tidak memanjang ke bawah:
- **Baris 1**: Penjualan Hari Ini · Laba Kotor Hari Ini · Laba Bersih Hari Ini
- **Baris 2**: Penjualan Bulan Ini · Laba Kotor Bulan Ini · Laba Bersih Bulan Ini

Bentuk kartu tetap (label atas, nilai besar, sub-line, ikon kanan). Murni tampilan.

## Scope / non-goals
- Tidak ubah backend, endpoint, atau shape data.
- Tidak ubah `PrintDashboard` (mode fotokopi).
- Tidak ubah `Card.jsx`, tidak ubah isi/label/value card.
- Tidak refactor jadi array config.

## File yang disentuh
- `src/pages/Dashboard.jsx` (hanya `MinimarketDashboard`).

## Rencana task (urut)

1. **Tambah cabang `cols === 3`** pada `KPISection` (`Dashboard.jsx:56-66`):
   ```jsx
   const KPISection = ({ title, cols = 4, children }) => (
     <section className="mb-6">
       <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h2>
       <div
         className={`grid grid-cols-1 gap-4 ${
           cols === 3 ? 'md:grid-cols-2 xl:grid-cols-3'
             : cols === 2 ? 'md:grid-cols-2'
               : 'md:grid-cols-2 xl:grid-cols-4'
         }`}
       >
         {children}
       </div>
     </section>
   );
   ```

2. **Ganti `cols={2}` → `cols={3}`** pada seksi Penjualan & Laba (`Dashboard.jsx:224`).

3. **Susun ulang 6 card jadi urutan row-major 3 kolom** (baris 1 = Hari, baris 2 = Bulan):
   - `Dashboard.jsx:225-232` Penjualan Hari Ini (tetap)
   - `245-256` Laba Kotor Hari Ini (naik ke atas — sekarang di posisi ke-3)
   - `257-272` Laba Bersih Hari Ini (naik)
   - `233-240` Penjualan Bulan Ini (turun ke baris 2)
   - `249-256` Laba Kotor Bulan Ini (turun ke baris 2)
   - `265-272` Laba Bersih Bulan Ini (turun ke baris 2)

   Urutan final JSX dalam `<KPISection title="Penjualan & Laba" cols={3}>`:
   1. Penjualan Hari Ini
   2. Laba Kotor Hari Ini
   3. Laba Bersih Hari Ini
   4. Penjualan Bulan Ini
   5. Laba Kotor Bulan Ini
   6. Laba Bersih Bulan Ini

   Props/value/sub/tone/to **tidak berubah**, hanya urutan.

4. **Seksi "Kas & Modal" dan "Stok"** tetap `cols` default 4. Tidak berubah.

5. **Verifikasi** setelah edit:
   - `npx eslint src/pages/Dashboard.jsx`.
   - `npm run build` sukses.
   - Manual: seksi Penjualan & Laba tampil 3 kolom × 2 baris pada layar besar;
     baris 1 = 3 metrik Hari Ini, baris 2 = 3 metrik Bulan Ini; Kas & Modal + Stok tetap
     4 kolom; link KPI (`linkTo`) tetap jalan; `PrintDashboard` tak tersentuh.

## Risks
- Pada layar `md` (tablet) grid jadi 2 kolom → 6 card = 3 baris; dapat diterima.
- Pada layar `< md` tetap 1 kolom (stack).

## Open question
- Tidak ada blocker.

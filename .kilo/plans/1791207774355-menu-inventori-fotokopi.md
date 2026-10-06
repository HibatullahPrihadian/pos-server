# Rencana: Menu Inti ATK di Mode Fotokopi (Produk, Stok, Pembelian)

## Tujuan
Membuka akses pengelolaan stok ATK di mode fotokopi: tampilkan **menu minimal Produk, Stok, Pembelian** di `MENU_PRINT`, dengan izin yang **bisa dilepas-pasang per pengguna**.

## Temuan (terverifikasi — backend sudah siap)
- Route **products, stock, purchases, categories, suppliers** sudah *business-aware* (`WHERE ... business = req.business`), termasuk INSERT produk & PO ber-`req.business`. **Tidak ada perubahan backend.**
- Izin sudah ada dengan label: `product.view/manage`, `stock.view/manage`, `purchase.view/manage/pay` (`utils/permissions.js:14-20,43-49`).
- **Panel izin per pengguna** di halaman Pengguna sudah ada (checkbox) → admin bisa menambah/mencabut izin stok/produk/pembelian per user **tanpa ubah kode** (inilah "lepas pasang").
- Preset `operator` saat ini hanya `print.* + report.view + attendance.self + shift.use` (`permissions.js:98-104`) — tetap ramping; izin ATK ditambahkan admin per kebutuhan lewat UI.
- `MENU_PRINT` (`Sidebar.jsx:73-93`) tidak memuat ketiga menu; icon `Package`, `Boxes`, `ShoppingBag` **sudah di-import** (`Sidebar.jsx:4-9`).

## Perubahan (1 file: `src/components/layout/Sidebar.jsx`)
Tambah section baru ke `MENU_PRINT` (setelah section Operasional, sebelum Fotokopi) dengan **menu minimal** sesuai keputusan:

```js
{
  section: 'Inventori',
  items: [
    { path: '/products', name: 'Produk', icon: Package, permission: 'product.view' },
    { path: '/stock', name: 'Stok', icon: Boxes, permission: 'stock.view' },
    { path: '/purchases', name: 'Pembelian', icon: ShoppingBag, permission: 'purchase.view' },
  ],
},
```

- Route `/products`, `/stock`, `/purchases` **sudah ada** di `App.jsx` dengan guard izin yang sama — tidak perlu diubah.
- Tidak menambah Kategori/Supplier/Opname menu (sesuai "menu minimal"; halaman Kategori/Supplier tetap bisa lewat URL bila perlu, Opname menu terpisah ditunda).

## Izin ("lepas pasang") — tanpa perubahan kode
- Admin memberi izin `product.view`/`product.manage`/`stock.*`/`purchase.*` ke user tertentu (mis. operator fotokopi) via **Pengguna → panel izin** (sudah ada).
- Menu otomatis muncul/sembunyi di Sidebar karena filter `can(permission)` (`Sidebar.jsx:176`).
- Backend tetap menegakkan izin (`requirePermission`) — menu tersembunyi bukan satu-satunya pengaman.
- (Opsional, kecil) menambah izin stok/produk/pembelian ke preset `operator` sebagai default — **dilewati** agar tetap ramping; admin cukup toggel per user.

## Yang TIDAK berubah
- Backend/route/skema — nol perubahan.
- Menu mode minimarket & fotokopi lainnya.
- Preset role (operator tetap minimal).

## Urutan Eksekusi
1. Edit `Sidebar.jsx`: tambah section Inventori (3 item) ke `MENU_PRINT`.
2. Verifikasi + rebuild **frontend saja** (tidak ada perubahan backend).

## Validasi
- `npm run lint` (0 warning), `npm run build`; `docker compose up -d --build frontend` (atau `--no-cache` bila perlu); hard-refresh.
- Uji manual:
  1. Mode **fotokopi** sebagai admin → menu Inventori muncul: Produk, Stok, Pembelian.
  2. Buat produk ATK ber-`business=fotokopi` dengan stok awal → muncul di daftar Produk mode fotokopi (dan **tidak** muncul di mode minimarket, sebaliknya).
  3. Stok page: kartu stok/penyesuaian/batch produk fotokopi berfungsi.
  4. Pembelian: buat PO + terima barang → stok ATK bertambah, HPP terupdate.
  5. Jual ATK lewat **Buat Pesanan** → stok berkurang (regresi fitur sebelumnya).
  6. **Izin lepas pasang**: buat user operator tanpa `product.view` → menu Produk tersembunyi + buka `/products` langsung → ditolak (403/guard); beri izin via Pengguna → muncul & bisa dipakai.
  7. Mode **minimarket**: menu & data tidak berubah (regresi).

## Risiko
- Rendah (frontend-only). Risiko terbesar: pastikan **tidak** menampilkan menu ini di mode minimarket ganda-ganda (pakai `MENU_PRINT` saja, jangan `MENU_MINIMARKET`).
- Data ATK & minimarket terpisah oleh `business` — uji kedua arah filter agar produk tidak "bocor" antar usaha.

## Catatan implementasi
Mengubah 1 file frontend (`src/components/layout/Sidebar.jsx`). Tanpa perubahan backend/skema. Rebuild frontend saja. Eksekusi oleh agent mode code.

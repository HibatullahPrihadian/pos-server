# Laporan QA Menyeluruh — POS Minimarket (git `9bd0d1d`)

Env: Docker live (postgres healthy, BE 5002 ok, FE 9998/9999 up), DB dev boleh reset.
Baseline: `npm run lint` OK, `vite build` OK, `node --check server.js` OK.
Transaksi uji: INV-20261008-0006…0015, RET-20261008-0001, PO-20261008-0001…0004, HOLD-20261008-0002.
Artefak QA dibersihkan (bundle QA-DUPBAR-1, produk QA-DUP-*, XSS dinonaktifkan). User uji qaop/qagudang tersisa.
Kandidat gugur: AuthContext NULL→preset (server resolve di `auth.js:35,56`, terverifikasi live), unit-map tertukar (key `product:unit` aman), cancel hold tanpa reason (default `cancelled` aman di `holds.js:257`), overpay kredit (desain tolak benar `sales.js:304-306`).

## Blocker
1. Void invoice kredit hapus piutang walau sudah dibayar, kas tak dikoreksi — `backend/routes/invoices.js:240-302`. Live perlu, kode jelas: `paidBefore` hanya log, `invoice_payments` tetap, status void keluarkan dari piutang. Repro: kredit → bayar parsial → void → piutang hilang. Perbaiki: tolak void bila `paid_amount>0` atau jurnalkan reversalnya.
2. Shortfall batch tak pernah dipulihkan — `sales.js:414-421,479-486`, `print_orders.js:647-654` vs `restoreSaleItemBatches`/`restoreSaleStock`. Saat `allow_negative`, retur/void tambah agregat tapi `source='shortfall'` tetap negatif; invariant `SUM(batch)==stock` pecah permanen. Perbaiki: pulihkan shortfall dulu saat restore.
3. Mutasi void lintas-usaha salah label — `batches.js:247-299` tak teruskan `business`, `stock.js:52-54` default `minimarket`. Void fotokopi tulis mutasi minimarket; kartu stok fotokopi lompat. Perbaiki: teruskan `sale.business`.

## Major
4. Guard baca hilang, peran bocor lintas modul — `sales.js:575,666,676` (`GET /`, by-invoice, :id), `returns.js:24,64`, `stock.js:19,72,93,143,298,329`, `purchases.js:67,109`, `shifts.js:66,157,195`, `members.js:20,51,112`, `settings.js:30`, `bundles.js:185,201,223,368`, `products.js:214` quote. Live: operator (`print.use` saja) `GET /sales`, `/returns`, `/purchases`, `/stock/movements`, `/shifts`, `/members`, `POST /quote` semua 200. Perbaiki: tambah `requirePermission` baca (`pos.use`, `stock.view`, `purchase.view`, dst).
5. Receive terima batch sudah kedaluwarsa — `purchases.js:240-247` hanya cek format. Live: terima `expiry 2020-01-01` 201, batch `is_expired True`, stok agregat > stok jual, jual gagal walau `stock_qty>0`. Perbaiki: tolak/warning `expiry<CURRENT_DATE`.
6. HPP rusak saat stok minus — `money.js:27-33`, `purchases.js:276-281`. `toInt(stock)` negatif ikut rata-rata; mis. -5@10000 + terima 10@12000 → 14000. Perbaiki: `max(0,currentQty)`.
7. Void hari-ini pakai UTC bukan zona toko — `sales.js:704-710` vs `APP_TIMEZONE` (`receivables.js:7`). Transaksi 23:30 WIB vs void 00:30 WIB (hari WIB sama) ditolak; beda hari WIB tapi UTC sama lolos. Perbaiki: bandingkan tanggal zona toko.
8. Retur tanpa shift bocorkan selisih kas — `returns.js:96,153-158`, `shifts.js:33-38`. `shift_id` opsional; `cash_out` hanya hitung retur ber-shift. Live: retur tanpa shift 201. Perbaiki: wajibkan shift aktif atau hitung semua retur kasir.
9. Expected kas abaikan DP kredit/cicilan/beban tunai — `shifts.js:49-52` hanya `opening+cash_in-cash_out`. DP (`sales.js:503-504`) + cicilan (`invoices.js:183-235` tanpa shift) + beban tunai tak masuk; selisih palsu. Perbaiki: sertakan ketiganya.
10. Resume hold non-atomik timpa cart dulu — `POS.jsx:733-741`, `holds.js:251-254`. Dua terminal ambil sama: kalah 409 tapi cart sudah tertimpa. Perbaiki: DELETE resume dulu, hydrate setelah 200.
11. Checkout tanpa idempotensi, Enter bypass guard — `POS.jsx:431-434,598-601,463-469`, `sales.js:41-570`. Double POST = dua invoice + stok ganda; GET detail gagal → cart tak clear → ulangi duplikat. Perbaiki: idempotency-key + guard ref di semua jalur submit.
12. Estimasi redeem FE vs BE beda — `POS.jsx:865-868` vs `sales.js:264-278`. FE tanpa `min_redeem`, pembagi `||1`, tanpa floor kelipatan; tak re-clamp saat cart susut. Live: BE tolak `Minimal penukaran 10 poin` padahal FE tampil diskon. Perbaiki: samakan rumus + clamp live.
13. Barcode paket bisa duplikat barcode produk — `bundles.js:34,41-43` vs `products.js:602-615`. Live: bundle barcode `8991002100028` (milik Aqua) 201. Scan ambigu. Perbaiki: cek silang 3 tabel produk.
14. Impor CSV gandakan supplier — `products.js:463-469` tanpa `ON CONFLICT` (kategori pakai). Live: impor 2x → supplier tetap 1 jadi duplikat (`Supplier QA Dup` dobel di respons kedua: count naik). Perbaiki: `ON CONFLICT (business,name)`.
15. Impor CSV via multipart selalu 400 — `products.js:404` pakai `imageUpload.single('file')` tolak `.csv`. Jalur JSON `csv:` saja jalan. Perbaiki: middleware file khusus CSV atau dokumentasikan JSON-only.
16. Filter invoice `unpaid` vs `Semua` identik — `Invoices.jsx:67-80` vs `invoices.js:90-93`. Live perlu: hanya `overdue` tambah param; tab Belum Lunas tampilkan lunas juga. Perbaiki: kirim `payment_status` sesuai tab.
17. Absensi bisa simpan pulang < masuk, durasi negatif — `Attendance.jsx:128-129`, `attendance.js:228-267` tanpa cek urutan. Perbaiki: validasi `check_out>check_in` kedua sisi.
18. Shortcut bocor di balik struk — `POS.jsx:816-817,845-849,826-828`. `H/A/+/-` aktif saat modal struk terbuka; uji kode jelas dua `useHotkeys` tanpa guard overlay. Perbaiki: guard `!receiptSale`.
19. Struk label PPN selalu `(incl.)` — `Receipt.jsx:97-102` vs mode exclusive. Perbaiki: label ikut `tax_included`.
20. Konsinyasi campur antar-usaha — `consignment.js:36-51,345-357` tanpa filter `business` di payable/payout. Perbaiki: filter per usaha.
21. `allow_negative_stock` setting global bocor ke fotokopi — `sales.js:79,158` vs `print_orders.js:538`. Perbaiki: pakai `getSettingsFor(business)` di semua jalur.
22. XSS tersimpan nama produk — live: `POST /products` nama `<script>` 201, ikut `GET /export` CSV. Perbaiki: sanitasi/escape saat render + tolak tag di input.

## Minor
23. Atribusi seri promo=tier hilang satu — `item_pricing.js:90-95`. Live: tier 2700 + promo 2700 → `promo_id` isi, `tier_id null`. Uang benar. Perbaiki: catat keduanya atau aturan prioritas eksplisit.
24. Diskon negatif dongkrak estimasi FE — `POS.jsx:1120,1132`, `currency.js:20-23`, `CartContext.jsx:82,86,142`. Ketik `-5000` TOTAL naik; BE clamp 0. Perbaiki: clamp `>=0` di input.
25. `parseMoney/parseQty` rusak desimal — `currency.js:20-28`. `12.5`→`125`, kosong→`0`, negatif lolos. Perbaiki: parser sadar koma/titik id-ID + tolak negatif.
26. `GET /customers/:id` 403 untuk operator padahal list 200 — `customers.js:40` vs `:83`. Perbaiki: samakan izin.
27. ID cetak struk ganda — `Receipt.jsx:14`, `PrintReceipt.jsx:24`, `printReceipt.js:7,19`. `getElementById` ambigu; `@page 58mm` tertinggal bila print dibatalkan. Perbaiki: satu sumber + cleanup `onafterprint` andal.
28. Upload hanya cek mimetype + `MAX_UPLOAD_MB=abc` = tanpa batas — `upload.js:7,19,37-42`; FE tanpa cek dini `Settings.jsx:57-73`. Perbaiki: magic bytes + fallback batas aman + cek client.
29. File yatim saat upload gambar produk gagal — `products.js:375-383` simpan sebelum cek 404. Perbaiki: cek dulu atau hapus saat gagal.
30. CSV BOM + `errors` diabaikan — `csv.js:4-11`, `Products.jsx:275-284`. Header `\uFEFFsku` → semua baris gagal. Perbaiki: kupas BOM + tangani errors.
31. CSV SKU duplikat overwrite diam-diam — `products.js:483-499`. Baris terakhir menang tanpa lapor. Perbaiki: laporkan duplikat dalam file.
32. Bundle barcode non-200 tanpa check digit — `bundles.js:34-44` vs `App.jsx:66` guard `bundle.manage` tapi baca bebas. Perbaiki: validasi EAN-13 semua barcode.
33. Pagination/filter reset hilang — `Stock.jsx:242-253`, `Shifts.jsx:176-187`, `Users.jsx:33-45` tanpa paging, `PrintOrders.jsx:194-198` tanpa debounce. Perbaiki: `setPage(1)` + debounce + paging users.
34. Pelanggan nonaktif ikut default — `customers.js:44` vs member/produk. Perbaiki: default aktif + flag eksplisit.
35. Tanggal client campur zona — `Attendance.jsx:107-109` (`todayRow` vs `todayIso`), `date.js:24-31` tanpa label zona, filter `from/to` lokal vs `APP_TIMEZONE` server. Perbaiki: samakan zona + label.
36. Validasi member/customer longgar — `Members.jsx:57-67,140-145,183`, `Customers.jsx:190,198,210-215`, `members.js:66-67`, `customers.js:164`. Spasi lolos, email bebas, tanpa toggle aktif. Perbaiki: trim + format + toggle.
37. Pembayaran PO nol lolos tombol — `Purchases.jsx:197-202,274` (`"0"` truthy). Perbaiki: guard `<=0` seperti `Invoices.jsx:122-123`.
38. Quote/FE tanpa batas qty — `products.js:213,235`, `item_pricing.js:15`, `CartContext.jsx:30-78` vs BE `MAX_LINE_QTY`. Ketik raksasa tampil ngawur sebelum 400. Perbaiki: batas + clamp dini.
39. Error 500 tanpa korelasi + 401 modal menggantung — `error.js:19`, `AuthContext.jsx:40-42`, `client.js:67-84`. Perbaiki: request-id + tutup modal + abort signal.
40. Docs kadaluarsa — `README.md:298-348` vs `permissions.js:67-105`. Preset operator + `customer/invoice/print` hilang; baca-bebas vs tulis-guarded tak terdokumentasi. Perbaiki: sinkronkan tabel + daftar endpoint terbuka.

## Lolos / benar (repro live)
Checkout tunai pas/kurang/lebih, split + reference, clamp diskon, `MAX_LINE_QTY`, stok habis `allow_negative OFF`, multi-satuan 1 dus=24, member earn/redeem + guard min/saldo, tier/promo termurah + `promo_id/tier_id`, FEFO alokasi terdekat + blokir expired, HPP moving average (123 stok @1766 usai terima 10@2000), void+retur stok/poin + tolak ganda/over-qty, kredit + termin + cicilan parsial, kasir/gudang tulis-guarded 403, izin custom live tanpa relogin, absen ganda ditolak, `GET /settings` baca publik (sengaja POS), SQLi aman (parameterized), path traversal aman (filename acak), build 3.05s.

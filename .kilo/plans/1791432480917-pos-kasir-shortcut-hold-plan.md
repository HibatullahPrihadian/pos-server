# Plan: Perbaiki Bug Shortcut Kasir (hasil audit)

## Ringkasan audit

- Kritis (aksi salah / data ganda): C1 Enter di tombol Batal hold ikut menyimpan hold; C2 Enter di tombol Batal/metode payment memicu checkout; C3 Enter di tombol satuan menambah 2x; C4 `checkout()` bisa double-submit.
- Major: M1 huruf tunggal case-sensitive (huruf kecil mati); M2 Esc tidak menangani dialog konfirmasi; M3 F8 tidak reset mode kredit; M4 digit 1–4 menghapus split payment; M5 Enter di kolom nominal tidak konfirmasi; M6 scan/tambah produk bisa jalan di balik modal; M7 pilih baris membuat fokus scanner hilang; M8 modal bisa menumpuk (opener tanpa guard overlay).
- Minor: m1 digit >9; m2 input qty terhapus langsung; m3 panah dibajak saat dropdown kosong; m4 reset seleksi belum eksplisit; m5 Alt+C di dalam input; m6/m7 dialog konfirmasi; m8 F-key di layar buka-shift.

## Keputusan

1. Perbaiki semua kritis dulu, lalu major M1/M2/M8 (fondasi), lalu M3–M7, lalu minor seperlunya.
2. Prinsip minimal-diff: guard di handler yang ada, tanpa mengubah arsitektur hotkey.
3. `checkout` wajib idempoten via ref (bukan state).
4. Huruf tunggal jadi case-insensitive; kombo Alt tetap via `event.code`.
5. Tidak ada perubahan backend/API/skema.

## Implementation Tasks

### Fase 1 — Kritis (wajib, urut)

1. **C1 — Hold: Enter di tombol Batal ikut submit** (`POS.jsx` ~1426 wrapper hold)
   - Di handler Enter wrapper hold: abaikan bila `e.target.closest('button')` (klik native tombol yang menang).
2. **C2 — Payment: Enter di tombol Batal/metode memicu checkout** (`POS.jsx` ~555 `handlePaymentKeyDown`, ~1216 tombol)
   - Tambahkan `tag === 'BUTTON'` ke guard `isField` untuk cabang Enter-konfirmasi (digit 1–4 boleh tetap, atau samakan guardnya).
3. **C3 — Unit picker: Enter di tombol satuan double-add** (`POS.jsx` ~481 `handleUnitKeyDown`, ~1062 wrapper)
   - Di cabang Enter: `return` bila `e.target.closest('button')`.
4. **C4 — `checkout()` double-submit** (`POS.jsx` ~357 `checkout`, ~1169 tombol Bayar)
   - Tambah `submittingRef = useRef(false)`; di awal `checkout`: `if (submittingRef.current) return; submittingRef.current = true;` reset di `finally`.

### Fase 2 — Fondasi major

5. **M1 — Huruf kecil mati** (`useHotkeys.js` ~62, map `POS.jsx` ~734)
   - Lookup: cocok persis dulu, lalu `key.toUpperCase()` untuk kunci 1 karakter. Alt-kombo tidak berubah.
6. **M2 — Esc untuk dialog konfirmasi** (`POS.jsx` ~744 cascade, `ConfirmDialog` clear cart & confirmResume)
   - Tambah cabang paling atas: `confirmResume → setConfirmResume(null)`, lalu `clearCartOpen → setClearCartOpen(false)`.
   - Guard opener `C`/`Alt+C`: jangan buka clear-cart bila overlay pembayaran/konfirmasi lain terbuka.
7. **M8 — Cegah modal menumpuk** (opener `openHoldModal/openHoldsList/openPayment/setMemberModal/setScanOpen/setClearCartOpen`)
   - Guard dengan `cartOverlaysOpen` yang sudah ada; izinkan Esc mengurai. F2 (fokus search) boleh tetap.

### Fase 3 — Major perilaku

8. **M3 — F8 reset mode kredit** (`POS.jsx` ~727 F8 vs `openPayment`)
   - F8 memanggil `openPayment()` dulu lalu override `payments` ke tunai, atau duplikasi reset `creditMode/customerId/payTerm/dueDate`.
9. **M4 — Digit 1–4 di mode split** (`POS.jsx` ~544 `selectPayMethod`)
   - Bila `payments.length > 1`: hanya ubah metode baris pertama (pertahankan nominal/split), atau nonaktifkan hint 1–4 saat split. Pilih salah satu, konsisten dengan label.
10. **M5 — Enter di kolom nominal** (input Jumlah/Uang Muka ~1325)
    - Tambah `onKeyDown` Enter pada input nominal: `if (!isPayConfirmDisabled()) checkout()`.
11. **M6 — Barcode jalan di balik modal** (`handleBarcode` ~340)
    - Early-return bila overlay terbuka (kecuali `searchOpen`/seleksi baris). Gunakan `cartOverlaysOpen`-setara yang tersedia di scope itu (pindahkan/duplicate flag bila perlu karena definisi setelahnya).
12. **M7 — Pilih baris membuat scanner kehilangan fokus** (`selectCartItem` ~752, `adjustSelectedQty`)
    - Hapus `blur()` (div baris memang tidak focusable), atau `focusBarcode()` setelah adjust. Rekomendasi: hapus `blur()`.

### Fase 4 — Minor (batch cepat)

13. **m3** — pindahkan `preventDefault` panah setelah cek list kosong (search & member).
14. **m2** — input qty: jangan update saat raw `''`/`'-'` (tunda commit ke blur/Enter) — atau terima sebagai known-limitation bila scope dipangkas.
15. **m4** — `setSelectedItemKey(null)` eksplisit di `submitHold/resumeHold/checkout`.
16. **m5** — dokumentasikan Alt+C di input sebagai by-design; opsional: skip `Alt+C` destruktif bila target INPUT.
17. **m7/m6** — autofocus tombol konfirmasi di `ConfirmDialog` saat dibuka + cabang Esc (sudah di M2).
18. **m8** — guard opener F-key bila `!shift` (atau `enabled: Boolean(shift)`).
19. **m1** — terima digit 1–9 + panah/klik untuk opsi >9 (dokumentasi), tanpa perubahan kode.

## Validasi

1. `npm run lint` lolos.
2. Hold: fokus tombol Batal + Enter → modal tutup, **tidak** ada hold baru.
3. Payment: fokus Batal + Enter → batal, bukan bayar; fokus tombol metode + Enter → hanya ganti metode.
4. Unit picker: fokus tombol satuan + Enter → tepat 1 item masuk cart.
5. Bayar: double-click cepat / Enter+klik bersamaan → tepat 1 sale (cek tidak ada invoice ganda).
6. Huruf kecil `h/a/m/c/k` di luar input → fire; di dalam input → tetap mengetik.
7. Esc menutup `confirmResume` lalu `clearCartOpen` sebelum modal di bawahnya.
8. F8 setelah penjualan kredit → mode tunai bersih.
9. Split 2 baris + tekan `2` → split tidak hilang (sesuai keputusan M4).
10. Enter di kolom nominal valid → checkout; di nominal invalid → diam.
11. Modal terbuka + Enter di barcode (atau scan) → cart tidak berubah.
12. Klik baris → `+` → scan USB berikutnya tetap masuk tanpa klik barcode.
13. `docker compose up -d --build frontend` (backend tidak berubah) + hard refresh.

## Risiko

- Guard `closest('button')` bisa menelan Enter yang sah bila tombol dibungkus elemen lain — mitigasi: cek `tag === 'BUTTON'` juga.
- `submittingRef` harus direset di semua jalur keluar `checkout` (`finally`).
- Case-insensitive lookup jangan menimpa binding eksak bila kelak ada key beda makna per case.

## Out of scope

- Focus trap modal penuh / roving tabindex.
- Navigasi panah antar baris cart, entri angka langsung, tombol Delete baris.
- Halaman Transaksi/Shift; auto-focus barcode; mode offline.

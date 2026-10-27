# Rencana Cetak Bluetooth Thermal

## Konteks dan keputusan

- POS saat ini adalah React/Vite web app. Cetak struk di `src/utils/printReceipt.js` memakai `window.print()`; markup struk tersedia di `src/components/receipt/Receipt.jsx`.
- Penggunaan mencakup Windows dan Android, dan kedua platform diharapkan dapat mencetak langsung ke printer Bluetooth tanpa dialog browser.
- Printer disebut RPP02N; perlu memvalidasi unit sebenarnya mendukung Bluetooth Classic SPP dan subset ESC/POS yang diperlukan. Nama model saja bukan bukti kompatibilitas.
- POS diakses dari hosting internet. Pertahankan web POS sebagai basis UI, tetapi gunakan lapisan native per platform: Electron untuk Windows dan aplikasi Android berbasis Capacitor dengan plugin native Bluetooth ESC/POS. Jangan menganggap satu implementasi Bluetooth web dapat bekerja lintas browser.
- Tetap sediakan fallback `window.print()` untuk browser biasa dan jika printer/native bridge tidak tersedia.

## Rencana implementasi

1. **Validasi perangkat dan protokol**
   - Cocokkan varian/unit RPP02N, firmware, mode pairing, Bluetooth Classic SPP, lebar kertas, encoding karakter, pemotong (jika ada), dan dukungan QR/barcode bila dibutuhkan.
   - Buat uji cetak minimal pada Windows dan Android yang nyata sebelum mengunci library/plugin.
   - Pastikan Android yang diuji mengizinkan komunikasi ke perangkat paired, dan Windows dapat membuka koneksi printer yang sama; siapkan daftar model alternatif jika printer berbeda ditemukan.

2. **Pisahkan representasi struk dari renderer**
   - Jadikan data transaksi sebagai sumber untuk representasi struk terstruktur yang dapat dipakai oleh renderer HTML saat ini dan renderer ESC/POS.
   - Pertahankan layout HTML serta `window.print()` sebagai fallback. Hindari mengirim HTML/CSS mentah ke printer ESC/POS.
   - Pastikan teks Indonesia, pembulatan mata uang, diskon, pembayaran, kembalian, footer, dan panjang struk ditangani konsisten.

3. **Android**
   - Bungkus POS dengan Capacitor, memuat URL hosting yang dapat dikonfigurasi.
   - Tambahkan plugin/native module Android untuk daftar perangkat paired, izin Bluetooth sesuai versi Android (termasuk runtime permission Android 12+), koneksi SPP, kirim byte ESC/POS, timeout, dan pelepasan koneksi.
   - Tidak melakukan scan/pair tanpa tindakan eksplisit pengguna. Simpan pilihan printer secara lokal pada perangkat, bukan di akun/server.
   - Proyek platform Android telah dibuat dan perlu build serta uji perangkat nyata sebelum distribusi.

4. **Windows**
   - Buat wrapper Electron terpisah yang memuat URL hosting dan menyediakan API printer terbatas ke UI.
   - Uji jalur Bluetooth printer: gunakan driver/virtual COM port Windows bila printer mengekspos SPP sebagai COM port; gunakan library serial yang kompatibel hanya setelah validasi. Jangan mengasumsikan dukungan Bluetooth raw melalui Web Bluetooth.
   - Batasi IPC ke operasi yang diperlukan (daftar/ pilih printer, status, cetak struk); jangan mengekspos Node.js umum ke halaman web.

5. **Kontrak dan keamanan bridge**
   - Deteksi kemampuan native melalui API adapter yang eksplisit; jangan menggunakan user-agent sebagai satu-satunya penentu.
   - Karena UI berasal dari hosting internet, validasi origin yang diizinkan dan batasi pemanggilan bridge ke operasi cetak yang tervalidasi. Electron memakai context isolation, sandbox, dan IPC tervalidasi; Android memakai bridge Capacitor yang hanya memaparkan operasi terbatas.
   - Jangan mengizinkan halaman arbitrer mengirim byte ESC/POS, menjalankan perintah OS, atau memilih endpoint lokal sembarang.
   - Jangan mengirim data transaksi ke layanan printer pihak ketiga. Komunikasi printer berlangsung lokal dari perangkat kasir.

6. **UX dan kegagalan**
   - Sediakan pengaturan printer per perangkat: pilih printer, tes cetak, cetak langsung aktif/nonaktif, dan fallback ke dialog browser.
   - Tampilkan status yang bisa ditindaklanjuti untuk Bluetooth mati, belum paired, izin ditolak, printer tidak terjangkau, koneksi timeout, dan kegagalan kirim.
   - Jangan otomatis mencetak ulang setelah kegagalan yang statusnya ambigu; sediakan aksi cetak ulang eksplisit untuk menghindari struk ganda.
   - Setelah transaksi berhasil, kegagalan cetak tidak boleh membatalkan transaksi. Tetap sediakan cetak ulang dari detail transaksi.

## Validasi dan rollout

- Uji POS browser biasa tetap mencetak seperti sekarang tanpa wrapper.
- Uji Windows: perangkat paired, port/driver, struk pendek dan panjang, karakter Indonesia, koneksi terputus, restart aplikasi, dan cetak ulang.
- Uji Android pada versi OS yang didukung: izin baru/ditolak, pemilihan printer paired, koneksi terputus, app kembali dari background, dan cetak ulang.
- Bandingkan total, diskon, pembayaran, kembalian, dan footer output ESC/POS dengan pratinjau HTML.
- Rilis bertahap sebagai mode opt-in per perangkat; aktifkan default hanya setelah kompatibilitas RPP02N diverifikasi. Pertahankan fallback browser sepanjang rollout.

## Batasan

- Belum diasumsikan penggunaan offline; wrapper memuat POS dari hosting internet sehingga transaksi tetap memerlukan konektivitas ke server.
- Dukungan printer yang berbeda model, auto-cut/cash drawer, dan distribusi/pembaruan otomatis wrapper di luar cakupan awal kecuali uji RPP02N menunjukkan kebutuhan.

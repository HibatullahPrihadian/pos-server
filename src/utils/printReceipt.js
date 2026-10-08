// Cetak struk dengan halaman 58mm x tinggi konten (kertas termal).
// Ukuran halaman disisipkan sesaat sebelum print agar cetak A4 (invoice,
// laporan, label) tidak ikut berubah. Cleanup ganda: afterprint + timeout,
// karena cancel dialog di sebagian browser tidak memicu afterprint.
export function printReceipt() {
  document.getElementById('receipt-page-size')?.remove();

  const el = document.getElementById('receipt-print-area');
  // offsetHeight: getBoundingClientRect ikut menyusut oleh transform scale
  // (nota fotokopi) padahal pagination cetak memakai tinggi layout.
  const mm = el ? Math.ceil((el.offsetHeight * 25.4) / 96) : 0;

  const style = document.createElement('style');
  style.id = 'receipt-page-size';
  style.textContent = mm
    ? `@page { size: 58mm ${mm}mm; margin: 0 }`
    : '@page { size: 58mm auto; margin: 0 }';
  document.head.appendChild(style);

  window.addEventListener('afterprint', () => {
    clearTimeout(fallback);
    style.remove();
  }, { once: true });
  // Cancel dialog (tanpa afterprint): kembalikan @page agar cetak A4 berikut
  // tidak terpotong ukuran struk.
  const fallback = setTimeout(() => style.remove(), 5000);
  window.print();
}

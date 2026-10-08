export const formatCurrency = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numericAmount);
};

// Angka polos untuk input (tanpa simbol mata uang).
export const formatNumber = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return '0';
  return new Intl.NumberFormat('id-ID').format(numericAmount);
};

// Parse input pengguna menjadi integer rupiah. Format id-ID: titik = pemisah
// ribuan, koma = desimal. "12.500" -> 12500, "12,5" -> 13 (round), "12.5" (titik
// tunggal di ujung) -> 13. Tanda minus hanya di depan; kosong/invalid -> 0.
export const parseMoney = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const neg = raw.startsWith('-');
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return 0;
  let normalized = digits;
  if (digits.includes(',')) {
    normalized = digits.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) {
    normalized = digits.replace(/\./g, '');
  }
  const n = Math.round(Number(normalized));
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};

export const parseQty = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const neg = raw.startsWith('-');
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return 0;
  let normalized = digits;
  if (digits.includes(',')) {
    normalized = digits.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) {
    normalized = digits.replace(/\./g, '');
  }
  const n = Math.round(Number(normalized));
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};

// Ubah angka menjadi terbilang bahasa Indonesia (maks. miliar).
export const angkaTerbilang = (value) => {
  const bil = Math.floor(Math.abs(Number(value) || 0));
  if (bil === 0) return 'Nol Rupiah';

  const satuan = [
    '', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan',
    'Sepuluh', 'Sebelas',
  ];

  const convert = (x) => {
    if (x < 12) return satuan[x];
    if (x < 20) return `${convert(x - 10)} Belas`;
    if (x < 100) return `${convert(Math.floor(x / 10))} Puluh ${convert(x % 10)}`;
    if (x < 200) return `Seratus ${convert(x - 100)}`;
    if (x < 1000) return `${convert(Math.floor(x / 100))} Ratus ${convert(x % 100)}`;
    if (x < 2000) return `Seribu ${convert(x - 1000)}`;
    if (x < 1000000) return `${convert(Math.floor(x / 1000))} Ribu ${convert(x % 1000)}`;
    if (x < 1000000000) return `${convert(Math.floor(x / 1000000))} Juta ${convert(x % 1000000)}`;
    if (x < 1000000000000) return `${convert(Math.floor(x / 1000000000))} Miliar ${convert(x % 1000000000)}`;
    return '';
  };

  const hasil = convert(bil).replace(/\s+/g, ' ').trim();
  return `${hasil} Rupiah`;
};

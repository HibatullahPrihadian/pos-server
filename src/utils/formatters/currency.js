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

// Parse input pengguna menjadi integer rupiah.
export const parseMoney = (value) => {
  const n = Math.round(Number(String(value ?? '').replace(/[^\d-]/g, '')));
  return Number.isFinite(n) ? n : 0;
};

export const parseQty = (value) => {
  const n = Math.round(Number(String(value ?? '').replace(/[^\d-]/g, '')));
  return Number.isFinite(n) ? n : 0;
};

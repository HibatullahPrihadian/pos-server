const pool = require('../db');

const NUMERIC_FIELDS = new Set(['tax_rate']);

const normalize = (row) => (row ? { ...row, tax_rate: Number(row.tax_rate) } : null);

// Ambil pengaturan toko (single row). Dipakai luas oleh route lain.
const getSettings = async (runner = pool) => {
  const result = await runner.query('SELECT * FROM store_settings WHERE id = 1');
  return normalize(result.rows[0]);
};

// Pengaturan usaha aktif: minimarket tetap memakai store_settings (kompatibel
// penuh dengan kode lama); usaha lain diambil dari business_settings dengan
// fallback default minimarket agar field yang belum diisi tetap terbaca.
const getSettingsFor = async (business = 'minimarket', runner = pool) => {
  const base = await getSettings(runner);
  if (!base || business === 'minimarket') return base;
  const result = await runner.query('SELECT * FROM business_settings WHERE business = $1', [business]);
  const row = result.rows[0];
  if (!row) return base ? { ...base, business } : null;
  return { ...base, ...row, business, tax_rate: Number(row.tax_rate) };
};

module.exports = { getSettings, getSettingsFor, NUMERIC_FIELDS };

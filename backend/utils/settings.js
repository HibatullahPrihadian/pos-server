const pool = require('../db');

const NUMERIC_FIELDS = new Set(['tax_rate']);

// Ambil pengaturan toko (single row). Dipakai luas oleh route lain.
const getSettings = async (runner = pool) => {
  const result = await runner.query('SELECT * FROM store_settings WHERE id = 1');
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    tax_rate: Number(row.tax_rate),
  };
};

module.exports = { getSettings, NUMERIC_FIELDS };

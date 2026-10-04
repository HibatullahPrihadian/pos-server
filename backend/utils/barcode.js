// Utilitas barcode internal paket berbasis EAN-13.
// Prefix 200 dipakai untuk kode internal (aman, tidak bentrok dengan barcode pabrik).
const INTERNAL_PREFIX = '200';

// Hitung check digit EAN-13 dari 12 digit pertama.
const ean13CheckDigit = (twelve) => {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(twelve[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
};

// Susun EAN-13 lengkap (13 digit) dari 12 digit pertama.
const withCheckDigit = (twelve) => {
  const base = String(twelve).slice(0, 12).padStart(12, '0');
  return `${base}${ean13CheckDigit(base)}`;
};

// Validasi EAN-13: 13 digit angka & check digit benar.
const isValidEan13 = (code) => {
  if (typeof code !== 'string' || !/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
};

// Generate kode acak berprefiks internal (12 digit pertama + check digit).
const generateEan13 = (prefix = INTERNAL_PREFIX) => {
  const p = String(prefix).replace(/\D/g, '').slice(0, 3).padStart(3, '0');
  const random = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  return withCheckDigit(`${p}${random}`);
};

// Cari kode internal '200%' terbesar di bundles.barcode lalu increment (mirip nextMemberCode).
// Bila tidak ada, mulai dari kode acak. Bentuk 12 digit pertama + check digit.
const nextInternalBarcode = async (client, prefix = INTERNAL_PREFIX) => {
  const p = String(prefix).replace(/\D/g, '').slice(0, 3).padStart(3, '0');
  const result = await client.query(
    `SELECT barcode FROM bundles
     WHERE barcode ~ $1
     ORDER BY SUBSTRING(barcode FROM 1 FOR 12) DESC
     LIMIT 1`,
    [`^${p}\\d{10}$`]
  );

  if (result.rows[0]?.barcode) {
    const base = Number(result.rows[0].barcode.slice(0, 12)) + 1;
    return withCheckDigit(String(base).padStart(12, '0'));
  }
  return generateEan13(p);
};

// Cek apakah kode sudah dipakai paket lain (opsional exclude id saat update).
const isBarcodeTaken = async (client, barcode, excludeId = null) => {
  const params = [barcode];
  let sql = 'SELECT 1 FROM bundles WHERE barcode = $1';
  if (excludeId !== null && excludeId !== undefined) {
    params.push(excludeId);
    sql += ' AND id <> $2';
  }
  const result = await client.query(`${sql} LIMIT 1`, params);
  return result.rowCount > 0;
};

module.exports = {
  INTERNAL_PREFIX,
  ean13CheckDigit,
  isValidEan13,
  generateEan13,
  nextInternalBarcode,
  isBarcodeTaken,
};

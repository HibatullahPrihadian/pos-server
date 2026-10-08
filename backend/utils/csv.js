const Papa = require('papaparse');

// Parse CSV text menjadi array objek (baris kosong diabaikan). BOM dikupas agar
// header dari Excel UTF-8 tidak terbaca sebagai "\uFEFFkolom".
const parseCsv = (text) => {
  const cleaned = String(text || '').replace(/^\uFEFF/, '');
  const result = Papa.parse(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
  });
  return result.data || [];
};

// Serialisasi array objek menjadi CSV.
const toCsv = (rows, columns) => Papa.unparse(rows, { columns, newline: '\r\n' });

// Kirim CSV sebagai unduhan dengan BOM agar Excel membaca UTF-8 dengan benar.
const sendCsv = (res, filename, rows, columns) => {
  const csv = toCsv(rows, columns);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
};

module.exports = { parseCsv, toCsv, sendCsv };

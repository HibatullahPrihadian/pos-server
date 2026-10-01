// Nomor dokumen harian: PREFIX-YYYYMMDD-NNNN, dibuat di dalam transaksi DB
// memakai UPSERT atomik pada invoice_counters sehingga tidak ada duplikasi.

const pad = (n) => String(n).padStart(4, '0');

const todayString = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Wajib dipanggil dengan client transaksi. Mengembalikan nomor dokumen lengkap.
const nextDocNumber = async (client, prefix, day) => {
  const docDay = day || todayString();
  const result = await client.query(
    `INSERT INTO invoice_counters (prefix, day, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (prefix, day)
     DO UPDATE SET last_number = invoice_counters.last_number + 1
     RETURNING last_number`,
    [prefix, docDay]
  );
  const number = result.rows[0].last_number;
  return `${prefix}-${docDay.replace(/-/g, '')}-${pad(number)}`;
};

module.exports = { nextDocNumber, todayString };

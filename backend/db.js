const { Pool, types } = require('pg');
require('dotenv').config();

// Kolom DATE (OID 1082) dikembalikan sebagai string 'YYYY-MM-DD', bukan Date lokal
// tengah malam. Tanpa ini, JSON serialization menggeser tanggal satu hari
// (mis. 2026-09-28 menjadi 2026-09-27T17:00:00Z di zona Asia/Jakarta).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'pos_minimarket',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

// Runs fn(client) inside a single BEGIN/COMMIT block and rolls back on error.
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = pool;
module.exports.withTransaction = withTransaction;

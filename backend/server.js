const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const pool = require('./db');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { verifyJwt } = require('./middleware/auth');
const { ensureDir, uploadRoot } = require('./utils/upload');

const app = express();
const PORT = process.env.PORT || 5000;

// Gagal cepat bila JWT_SECRET belum diatur dengan benar, agar server tidak
// pernah berjalan dengan secret default yang dapat dipalsukan.
require('./middleware/auth').assertJwtSecret();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

// Foto produk & QRIS disajikan dari volume uploads.
ensureDir(uploadRoot);
app.use('/uploads', express.static(uploadRoot, { maxAge: '7d' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'error', error: err.message });
  }
});

// Login satu-satunya endpoint publik; seluruh /api lainnya wajib JWT.
const PUBLIC_API_PATHS = new Set(['/api/auth/login']);
app.use('/api', (req, res, next) => {
  const path = req.originalUrl.split('?')[0];
  if (PUBLIC_API_PATHS.has(path)) return next();
  return verifyJwt(req, res, next);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/products', require('./routes/products'));
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/members', require('./routes/members'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/reports', require('./routes/reports'));

app.use('/api', notFoundHandler);
app.use(errorHandler);

// Pastikan migrasi fitur (multibarcode/tier/promo) sudah diterapkan. Checkout
// bergantung pada kolom/tabel ini; gagal cepat dengan pesan jelas lebih baik
// daripada error runtime per-transaksi.
const assertFeatureSchema = async () => {
  const required = [
    { name: 'tabel product_barcodes', sql: "SELECT to_regclass('public.product_barcodes') AS ok" },
    { name: 'tabel price_tiers', sql: "SELECT to_regclass('public.price_tiers') AS ok" },
    { name: 'tabel promotions', sql: "SELECT to_regclass('public.promotions') AS ok" },
    {
      name: 'kolom sale_items.promo_id/tier_id',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'sale_items' AND column_name IN ('promo_id', 'tier_id')`,
    },
  ];

  for (const check of required) {
    const result = await pool.query(check.sql);
    const row = result.rows[0];
    const ok = check.name.startsWith('kolom') ? row.ok === 2 : Boolean(row.ok);
    if (!ok) {
      throw new Error(
        `Skema fitur belum diterapkan (${check.name}). Jalankan migrasi: backend/init.sql ` +
          `(mis. docker compose exec -T postgres psql -U postgres -d pos_minimarket -f /docker-entrypoint-initdb.d/01-init.sql)`
      );
    }
  }
};

// Akun awal disiapkan sebelum server menerima request, agar login deterministik
// pada start pertama.
const start = async () => {
  try {
    await assertFeatureSchema();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    await require('./utils/bootstrap').ensureInitialUsers();
  } catch (err) {
    console.error('Gagal menyiapkan akun awal:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`POS backend berjalan di port ${PORT}`);
    console.log(`Upload dir: ${path.resolve(uploadRoot)}`);
  });
};

start();

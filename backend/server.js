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
app.use('/api/bundles', require('./routes/bundles'));
app.use('/api/consignment', require('./routes/consignment'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/members', require('./routes/members'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/expenses', require('./routes/expenses'));
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
    // P2: bundling, konsinyasi, absensi.
    { name: 'tabel bundles', sql: "SELECT to_regclass('public.bundles') AS ok" },
    { name: 'tabel bundle_items', sql: "SELECT to_regclass('public.bundle_items') AS ok" },
    {
      name: 'kolom sale_items.bundle_id',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'sale_items' AND column_name = 'bundle_id'`,
    },
    { name: 'tabel consignors', sql: "SELECT to_regclass('public.consignors') AS ok" },
    { name: 'tabel consignment_payouts', sql: "SELECT to_regclass('public.consignment_payouts') AS ok" },
    {
      name: 'kolom products.is_consignment/consignor_id',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'products' AND column_name IN ('is_consignment', 'consignor_id')`,
    },
    { name: 'tabel attendance', sql: "SELECT to_regclass('public.attendance') AS ok" },
    {
      name: 'kolom attendance.shift_id',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'attendance' AND column_name = 'shift_id'`,
    },
    // P3: pelacakan kadaluarsa per-batch (FEFO).
    { name: 'tabel stock_batches', sql: "SELECT to_regclass('public.stock_batches') AS ok" },
    { name: 'tabel sale_item_batches', sql: "SELECT to_regclass('public.sale_item_batches') AS ok" },
    {
      name: 'kolom store_settings.expiry_warning_days',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'store_settings' AND column_name = 'expiry_warning_days'`,
    },
    // P4: beban operasional (laba rugi).
    { name: 'tabel expense_categories', sql: "SELECT to_regclass('public.expense_categories') AS ok" },
    { name: 'tabel expenses', sql: "SELECT to_regclass('public.expenses') AS ok" },
    // P5: role gudang + izin granular per user.
    {
      name: 'kolom users.permissions',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'permissions'`,
    },
    {
      name: "CHECK role users (admin/kasir/gudang)",
      sql: `SELECT COUNT(*)::int AS ok FROM pg_constraint
            WHERE conname = 'users_role_check'
              AND pg_get_constraintdef(oid) LIKE '%gudang%'`,
    },
    // P6: invoice grosir kredit & piutang.
    { name: 'tabel customers', sql: "SELECT to_regclass('public.customers') AS ok" },
    { name: 'tabel invoice_payments', sql: "SELECT to_regclass('public.invoice_payments') AS ok" },
    {
      name: 'kolom sales.customer_id/is_credit/due_date/paid_amount/payment_status',
      sql: `SELECT COUNT(*)::int AS ok FROM information_schema.columns
            WHERE table_name = 'sales'
              AND column_name IN ('customer_id', 'is_credit', 'due_date', 'paid_amount', 'payment_status')`,
    },
    {
      name: 'CHECK sales.payment_status',
      sql: `SELECT COUNT(*)::int AS ok FROM pg_constraint
            WHERE conname = 'sales_payment_status_check'`,
    },
  ];

  for (const check of required) {
    const result = await pool.query(check.sql);
    const row = result.rows[0];
    const expected = check.name.startsWith('kolom sale_items.promo_id') ? 2
      : check.name.startsWith('kolom products.is_consignment') ? 2
        : check.name.startsWith('kolom sales.customer_id') ? 5
          : null;
    const ok = expected === null ? Boolean(row.ok) : row.ok === expected;
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

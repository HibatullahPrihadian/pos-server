const express = require('express');
const pool = require('../db');
const { verifyJwt, requireRole } = require('../middleware/auth');
const { isValidDate } = require('../utils/validate');
const { toInt } = require('../utils/pagination');
const { sendCsv } = require('../utils/csv');

const router = express.Router();

router.use(verifyJwt, requireRole('admin'));

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD' oleh db.js. Helper ini
// tetap menangani objek Date (memakai komponen lokal) sebagai pengaman.
const pad2 = (n) => String(n).padStart(2, '0');
const toIso = (value) => {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
};

// Normalisasi rentang tanggal. Default: bulan berjalan sampai hari ini.
const resolveRange = (query) => {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1);

  const from = isValidDate(query.from) ? query.from : toIso(defaultFrom);
  const to = isValidDate(query.to) ? query.to : toIso(today);
  return { from, to };
};

const wantsCsv = (query) => String(query.format || '').toLowerCase() === 'csv';

// Ekspresi laba kotor: (line_total - cost) hanya untuk transaksi completed.
const GROSS_PROFIT_EXPR = `
  SUM(si.line_total - (si.cost_price * si.qty))::bigint
`;

// =========================================================
// Ringkasan penjualan per hari
// =========================================================
router.get('/sales-summary', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const result = await pool.query(
      `SELECT
         s.created_at::date AS date,
         COUNT(*)::int AS txn_count,
         COALESCE(SUM(s.subtotal), 0)::bigint AS subtotal,
         COALESCE(SUM(s.item_discount), 0)::bigint AS item_discount,
         COALESCE(SUM(s.txn_discount), 0)::bigint AS txn_discount,
         COALESCE(SUM(s.points_value), 0)::bigint AS points_value,
         COALESCE(SUM(s.tax_total), 0)::bigint AS tax_total,
         COALESCE(SUM(s.grand_total), 0)::bigint AS grand_total
       FROM sales s
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY s.created_at::date
       ORDER BY s.created_at::date DESC`,
      [from, to]
    );

    const returnsResult = await pool.query(
      `SELECT r.created_at::date AS date, COALESCE(SUM(r.total), 0)::bigint AS refund_total
       FROM returns r
       WHERE r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY r.created_at::date`,
      [from, to]
    );
    const refundMap = new Map(returnsResult.rows.map((r) => [toIso(r.date), Number(r.refund_total)]));

    const rows = result.rows.map((r) => ({
      date: toIso(r.date),
      txn_count: r.txn_count,
      subtotal: Number(r.subtotal),
      item_discount: Number(r.item_discount),
      txn_discount: Number(r.txn_discount),
      points_value: Number(r.points_value),
      tax_total: Number(r.tax_total),
      grand_total: Number(r.grand_total),
      refund_total: refundMap.get(toIso(r.date)) || 0,
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `penjualan-${from}_${to}.csv`, rows, [
        'date', 'txn_count', 'subtotal', 'item_discount', 'txn_discount', 'points_value', 'tax_total', 'grand_total', 'refund_total',
      ]);
    }

    const totals = rows.reduce(
      (acc, r) => ({
        txn_count: acc.txn_count + r.txn_count,
        grand_total: acc.grand_total + r.grand_total,
        tax_total: acc.tax_total + r.tax_total,
        refund_total: acc.refund_total + r.refund_total,
      }),
      { txn_count: 0, grand_total: 0, tax_total: 0, refund_total: 0 }
    );

    res.json({ from, to, rows, totals });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Penjualan per kasir
// =========================================================
router.get('/by-cashier', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const result = await pool.query(
      `SELECT u.id AS cashier_id, u.full_name AS cashier_name,
              COUNT(*)::int AS txn_count,
              COALESCE(SUM(s.grand_total), 0)::bigint AS grand_total,
              COALESCE(SUM(s.grand_total - s.tax_total), 0)::bigint AS net_sales
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY u.id, u.full_name
       ORDER BY grand_total DESC`,
      [from, to]
    );

    const rows = result.rows.map((r) => ({
      cashier_id: r.cashier_id,
      cashier_name: r.cashier_name,
      txn_count: r.txn_count,
      grand_total: Number(r.grand_total),
      net_sales: Number(r.net_sales),
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `penjualan-kasir-${from}_${to}.csv`, rows, [
        'cashier_id', 'cashier_name', 'txn_count', 'grand_total', 'net_sales',
      ]);
    }
    res.json({ from, to, rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Penjualan per metode bayar
// =========================================================
router.get('/by-payment', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const result = await pool.query(
      `SELECT sp.method,
              COUNT(DISTINCT sp.sale_id)::int AS txn_count,
              COALESCE(SUM(sp.amount), 0)::bigint AS total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY sp.method
       ORDER BY total DESC`,
      [from, to]
    );

    const rows = result.rows.map((r) => ({ method: r.method, txn_count: r.txn_count, total: Number(r.total) }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `pembayaran-${from}_${to}.csv`, rows, ['method', 'txn_count', 'total']);
    }
    res.json({ from, to, rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Laba kotor
// =========================================================
router.get('/gross-profit', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
         COALESCE(SUM(si.cost_price * si.qty), 0)::bigint AS cogs,
         ${GROSS_PROFIT_EXPR} AS gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')`,
      [from, to]
    );

    const daily = await pool.query(
      `SELECT s.created_at::date AS date,
              COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
              COALESCE(SUM(si.cost_price * si.qty), 0)::bigint AS cogs,
              ${GROSS_PROFIT_EXPR} AS gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY s.created_at::date
       ORDER BY s.created_at::date DESC`,
      [from, to]
    );

    const summary = {
      revenue: Number(result.rows[0].revenue),
      cogs: Number(result.rows[0].cogs),
      gross_profit: Number(result.rows[0].gross_profit),
    };
    const rows = daily.rows.map((r) => ({
      date: toIso(r.date),
      revenue: Number(r.revenue),
      cogs: Number(r.cogs),
      gross_profit: Number(r.gross_profit),
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `laba-kotor-${from}_${to}.csv`, rows, ['date', 'revenue', 'cogs', 'gross_profit']);
    }
    res.json({ from, to, summary, rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Produk terlaris
// =========================================================
router.get('/top-products', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));

    const result = await pool.query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.base_unit,
              SUM(si.base_qty)::int AS qty_sold,
              COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
              COALESCE(SUM(si.line_total - (si.cost_price * si.qty)), 0)::bigint AS gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY p.id, p.sku, p.name, p.base_unit
       ORDER BY qty_sold DESC
       LIMIT $3`,
      [from, to, limit]
    );

    const rows = result.rows.map((r) => ({
      product_id: r.product_id,
      sku: r.sku,
      product_name: r.product_name,
      base_unit: r.base_unit,
      qty_sold: r.qty_sold,
      revenue: Number(r.revenue),
      gross_profit: Number(r.gross_profit),
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `produk-terlaris-${from}_${to}.csv`, rows, [
        'product_id', 'sku', 'product_name', 'base_unit', 'qty_sold', 'revenue', 'gross_profit',
      ]);
    }
    res.json({ from, to, rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Stok minimum
// =========================================================
router.get('/low-stock', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.base_unit,
              p.stock_qty, p.min_stock, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = TRUE AND p.stock_qty <= p.min_stock
       ORDER BY (p.stock_qty - p.min_stock), p.name`
    );

    const rows = result.rows.map((r) => ({
      product_id: r.product_id,
      sku: r.sku,
      product_name: r.product_name,
      base_unit: r.base_unit,
      stock_qty: r.stock_qty,
      min_stock: r.min_stock,
      category_name: r.category_name || '',
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, 'stok-minimum.csv', rows, [
        'product_id', 'sku', 'product_name', 'base_unit', 'stock_qty', 'min_stock', 'category_name',
      ]);
    }
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Kartu stok
// =========================================================
router.get('/stock-card/:productId', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);

    const product = await pool.query(
      `SELECT p.id, p.sku, p.name, p.base_unit, p.stock_qty, p.min_stock, p.cost_price
       FROM products p WHERE p.id = $1`,
      [req.params.productId]
    );
    if (!product.rows[0]) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const result = await pool.query(
      `SELECT sm.created_at, sm.type, sm.qty_change, sm.balance_after, sm.ref_type, sm.ref_id,
              sm.unit_cost, sm.note, u.full_name AS user_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.product_id = $1 AND sm.created_at >= $2::date AND sm.created_at < ($3::date + INTERVAL '1 day')
       ORDER BY sm.created_at ASC, sm.id ASC`,
      [req.params.productId, from, to]
    );

    const rows = result.rows.map((r) => ({
      created_at: r.created_at.toISOString(),
      type: r.type,
      qty_change: r.qty_change,
      balance_after: r.balance_after,
      ref_type: r.ref_type || '',
      ref_id: r.ref_id ?? '',
      unit_cost: r.unit_cost ?? '',
      note: r.note || '',
      user_name: r.user_name || '',
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `kartu-stok-${product.rows[0].sku}-${from}_${to}.csv`, rows, [
        'created_at', 'type', 'qty_change', 'balance_after', 'ref_type', 'ref_id', 'unit_cost', 'note', 'user_name',
      ]);
    }
    res.json({ from, to, product: product.rows[0], rows });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Dashboard KPI
// =========================================================
router.get('/dashboard', async (req, res, next) => {
  try {
    const today = await pool.query(
      `SELECT COUNT(*)::int AS txn_count,
              COALESCE(SUM(grand_total), 0)::bigint AS grand_total,
              COALESCE(SUM(tax_total), 0)::bigint AS tax_total
       FROM sales
       WHERE status = 'completed' AND created_at::date = CURRENT_DATE`
    );

    const month = await pool.query(
      `SELECT COUNT(*)::int AS txn_count,
              COALESCE(SUM(grand_total), 0)::bigint AS grand_total
       FROM sales
       WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`
    );

    const profitToday = await pool.query(
      `SELECT COALESCE(SUM(si.line_total - (si.cost_price * si.qty)), 0)::bigint AS gross_profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at::date = CURRENT_DATE`
    );

    const topProducts = await pool.query(
      `SELECT p.name AS product_name, SUM(si.base_qty)::int AS qty_sold
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status = 'completed' AND s.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY p.name ORDER BY qty_sold DESC LIMIT 5`
    );

    const lowStock = await pool.query(
      `SELECT COUNT(*)::int AS n FROM products WHERE is_active = TRUE AND stock_qty <= min_stock`
    );

    const openShifts = await pool.query(
      `SELECT COUNT(*)::int AS n FROM shifts WHERE closed_at IS NULL`
    );

    const salesTrend = await pool.query(
      `SELECT created_at::date AS date, COALESCE(SUM(grand_total), 0)::bigint AS grand_total
       FROM sales
       WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date ORDER BY created_at::date`
    );

    res.json({
      today: {
        txn_count: today.rows[0].txn_count,
        grand_total: Number(today.rows[0].grand_total),
        tax_total: Number(today.rows[0].tax_total),
        gross_profit: Number(profitToday.rows[0].gross_profit),
      },
      month: {
        txn_count: month.rows[0].txn_count,
        grand_total: Number(month.rows[0].grand_total),
      },
      top_products: topProducts.rows,
      low_stock_count: lowStock.rows[0].n,
      open_shifts: openShifts.rows[0].n,
      trend: salesTrend.rows.map((r) => ({
        date: toIso(r.date),
        grand_total: Number(r.grand_total),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

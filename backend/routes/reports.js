const express = require('express');
const pool = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { isValidDate } = require('../utils/validate');
const { toInt } = require('../utils/pagination');
const { sendCsv } = require('../utils/csv');
const { getReceivableSummary } = require('../utils/receivables');

const router = express.Router();

router.use(verifyJwt, requirePermission('report.view'));

// Zona waktu toko untuk "hari ini"/"bulan ini" pada pembelian. purchases.date diisi
// dari tanggal lokal klien (WIB), sedangkan sesi DB berjalan di UTC — pin zona waktu
// agar batas hari tidak bergeser. Dapat dioverride lewat env APP_TIMEZONE.
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Jakarta';

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

// Retur periode: refund ke pelanggan (kas keluar) dan HPP barang yang diretur.
// HPP retur = cost_price pada sale_item (per satuan jual) x qty retur. Rekonsiliasi:
// Laba kotor bersih = gross_profit - (return_refund - return_cogs).
const RETURN_COGS_EXPR = `
  COALESCE(SUM(ri.qty * si.cost_price), 0)::bigint
`;
const returnCogsJoin = `
  FROM return_items ri
  JOIN returns r ON r.id = ri.return_id
  LEFT JOIN sale_items si ON si.id = ri.sale_item_id
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
// Laba rugi (Laba Bersih = Laba Kotor setelah retur - Beban Operasional)
// =========================================================
// Pembelian stok dan payout penitip BUKAN beban (hanya baris informasi): HPP
// sudah dikurangkan saat barang terjual, menambahkannya lagi = double counting.
router.get('/profit-loss', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const rangeParams = [from, to];

    // Penjualan & HPP (harian + total) hanya untuk transaksi completed.
    const salesResult = await pool.query(
      `SELECT s.created_at::date AS date,
              COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
              COALESCE(SUM(si.cost_price * si.qty), 0)::bigint AS cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY s.created_at::date`,
      rangeParams
    );

    // Retur per hari: refund (kas keluar) dan HPP barang yang kembali ke stok.
    const returnsResult = await pool.query(
      `SELECT r.created_at::date AS date,
              COALESCE(SUM(ri.refund_amount), 0)::bigint AS return_refund,
              ${RETURN_COGS_EXPR} AS return_cogs
       ${returnCogsJoin}
       WHERE r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY r.created_at::date`,
      rangeParams
    );

    // Beban operasional per hari (basis akrual: memakai `amount`, bukan `paid_amount`).
    const expenseResult = await pool.query(
      `SELECT e.date AS date, COALESCE(SUM(e.amount), 0)::bigint AS expense
       FROM expenses e
       WHERE e.date >= $1::date AND e.date <= $2::date
       GROUP BY e.date`,
      rangeParams
    );

    // Beban per kategori (periode).
    const expenseByCategory = await pool.query(
      `SELECT COALESCE(ec.name, 'Tanpa Kategori') AS category,
              COALESCE(SUM(e.amount), 0)::bigint AS amount
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
       WHERE e.date >= $1::date AND e.date <= $2::date
       GROUP BY COALESCE(ec.name, 'Tanpa Kategori')
       ORDER BY amount DESC`,
      rangeParams
    );

    // Baris informasi (TIDAK mengurangi laba).
    const purchaseResult = await pool.query(
      `SELECT COALESCE(SUM(total), 0)::bigint AS purchase_total
       FROM purchases
       WHERE status <> 'cancelled' AND date >= $1::date AND date <= $2::date`,
      rangeParams
    );
    // Modal: hanya PO yang sudah dibayar penuh (pola sama dengan /purchase-paid).
    const purchasePaidResult = await pool.query(
      `SELECT COALESCE(SUM(total), 0)::bigint AS purchase_paid
       FROM purchases
       WHERE payment_status = 'paid' AND status <> 'cancelled'
         AND date >= $1::date AND date <= $2::date`,
      rangeParams
    );
    const payoutResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS consignment_payout
       FROM consignment_payouts
       WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')`,
      rangeParams
    );

    const salesMap = new Map(salesResult.rows.map((r) => [toIso(r.date), r]));
    const returnsMap = new Map(returnsResult.rows.map((r) => [toIso(r.date), r]));
    const expenseMap = new Map(expenseResult.rows.map((r) => [toIso(r.date), Number(r.expense)]));

    const dates = new Set([...salesMap.keys(), ...returnsMap.keys(), ...expenseMap.keys()]);

    const totals = { revenue: 0, cogs: 0, return_refund: 0, return_cogs: 0, expense: 0 };
    const rows = [...dates].sort((a, b) => (a < b ? 1 : -1)).map((date) => {
      const sale = salesMap.get(date);
      const ret = returnsMap.get(date);
      const revenue = sale ? Number(sale.revenue) : 0;
      const cogs = sale ? Number(sale.cogs) : 0;
      const returnRefund = ret ? Number(ret.return_refund) : 0;
      const returnCogs = ret ? Number(ret.return_cogs) : 0;
      const expense = expenseMap.get(date) || 0;

      const grossProfit = revenue - cogs;
      const grossProfitNet = grossProfit - (returnRefund - returnCogs);
      const netProfit = grossProfitNet - expense;

      totals.revenue += revenue;
      totals.cogs += cogs;
      totals.return_refund += returnRefund;
      totals.return_cogs += returnCogs;
      totals.expense += expense;

      return {
        date,
        revenue,
        cogs,
        gross_profit: grossProfit,
        return_refund: returnRefund,
        return_cogs: returnCogs,
        gross_profit_net: grossProfitNet,
        expense,
        net_profit: netProfit,
      };
    });

    if (wantsCsv(req.query)) {
      return sendCsv(res, `laba-rugi-${from}_${to}.csv`, rows, [
        'date', 'revenue', 'cogs', 'gross_profit', 'return_refund', 'return_cogs',
        'gross_profit_net', 'expense', 'net_profit',
      ]);
    }

    const grossProfit = totals.revenue - totals.cogs;
    const grossProfitNet = grossProfit - (totals.return_refund - totals.return_cogs);
    const summary = {
      revenue: totals.revenue,
      cogs: totals.cogs,
      gross_profit: grossProfit,
      return_refund: totals.return_refund,
      return_cogs: totals.return_cogs,
      gross_profit_net: grossProfitNet,
      operating_expense: totals.expense,
      net_profit: grossProfitNet - totals.expense,
    };

    res.json({
      from,
      to,
      summary,
      expense_by_category: expenseByCategory.rows.map((r) => ({
        category: r.category,
        amount: Number(r.amount),
      })),
      info: {
        purchase_total: Number(purchaseResult.rows[0].purchase_total),
        purchase_paid: Number(purchasePaidResult.rows[0].purchase_paid),
        consignment_payout: Number(payoutResult.rows[0].consignment_payout),
      },
      rows,
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Modal pembelian (PO yang sudah dibayar penuh ke supplier)
// =========================================================
// Murni informatif: pembelian stok mengubah kas menjadi persediaan (aset),
// bukan beban laba. Filter opsional: supplier_id, search (kode/invoice).
router.get('/purchase-paid', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const params = [from, to];
    const conditions = ["pu.payment_status = 'paid'", "pu.status <> 'cancelled'", 'pu.date >= $1::date', 'pu.date <= $2::date'];

    const supplierId = Number(req.query.supplier_id);
    if (Number.isInteger(supplierId) && supplierId > 0) {
      params.push(supplierId);
      conditions.push(`pu.supplier_id = $${params.length}`);
    }

    const search = String(req.query.search || '').trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(pattern);
      conditions.push(`(pu.code ILIKE $${params.length} ESCAPE '\\' OR COALESCE(pu.invoice_no, '') ILIKE $${params.length} ESCAPE '\\')`);
    }

    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT pu.id, pu.code, pu.date, s.name AS supplier_name, pu.invoice_no,
              pu.status, pu.total, pu.paid_amount, pu.received_at,
              COALESCE(SUM(pi.qty), 0)::int AS qty_total,
              COALESCE(SUM(pi.base_qty), 0)::int AS base_qty_total,
              COUNT(pi.id)::int AS item_count
       FROM purchases pu
       LEFT JOIN suppliers s ON s.id = pu.supplier_id
       LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id
       WHERE ${where}
       GROUP BY pu.id, s.name
       ORDER BY pu.date DESC, pu.id DESC`,
      params
    );

    const rows = result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      date: toIso(r.date),
      supplier_name: r.supplier_name || '-',
      invoice_no: r.invoice_no || '',
      status: r.status,
      total: Number(r.total),
      paid_amount: Number(r.paid_amount),
      received_at: r.received_at ? r.received_at.toISOString() : '',
      qty_total: r.qty_total,
      base_qty_total: r.base_qty_total,
      item_count: r.item_count,
    }));

    if (wantsCsv(req.query)) {
      return sendCsv(res, `modal-pembelian-${from}_${to}.csv`, rows, [
        'id', 'code', 'date', 'supplier_name', 'invoice_no', 'status', 'total', 'paid_amount', 'received_at', 'qty_total', 'base_qty_total', 'item_count',
      ]);
    }

    const summary = rows.reduce(
      (acc, r) => ({
        total_amount: acc.total_amount + r.total,
        total_paid: acc.total_paid + r.paid_amount,
        po_count: acc.po_count + 1,
        item_qty: acc.item_qty + r.qty_total,
        item_base_qty: acc.item_base_qty + r.base_qty_total,
      }),
      { total_amount: 0, total_paid: 0, po_count: 0, item_qty: 0, item_base_qty: 0 }
    );

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

    // Retur hari ini (refund & HPP kembali) agar laba bersih konsisten dengan laporan.
    const profitTodayReturns = await pool.query(
      `SELECT COALESCE(SUM(ri.refund_amount), 0)::bigint AS return_refund,
              ${RETURN_COGS_EXPR} AS return_cogs
       ${returnCogsJoin}
       WHERE r.created_at >= CURRENT_DATE AND r.created_at < (CURRENT_DATE + INTERVAL '1 day')`
    );

    const expenseToday = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS expense FROM expenses WHERE date = CURRENT_DATE`
    );

    const expenseMonth = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS expense
       FROM expenses WHERE date >= DATE_TRUNC('month', CURRENT_DATE)::date`
    );

    const profitMonth = await pool.query(
      `SELECT ${GROSS_PROFIT_EXPR} AS gross_profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at >= DATE_TRUNC('month', CURRENT_DATE)`
    );

    // Retur bulan ini agar laba bersih bulanan konsisten dengan hari ini & laporan.
    const profitMonthReturns = await pool.query(
      `SELECT COALESCE(SUM(ri.refund_amount), 0)::bigint AS return_refund,
              ${RETURN_COGS_EXPR} AS return_cogs
       ${returnCogsJoin}
       WHERE r.created_at >= DATE_TRUNC('month', CURRENT_DATE)
         AND r.created_at < (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')`
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

    // Modal pembelian lunas (informatif). Kriteria & rentang sama dengan tab Laporan "Modal"
    // (from = awal bulan, to = hari ini). purchases.date ditulis dari tanggal lokal klien,
    // jadi bandingkan dengan tanggal lokal (bukan CURRENT_DATE/UTC) agar batas hari konsisten.
    const purchasePaidMonth = await pool.query(
      `SELECT COALESCE(SUM(total), 0)::bigint AS amount, COUNT(*)::int AS po_count
       FROM purchases
       WHERE payment_status = 'paid' AND status <> 'cancelled'
         AND date >= DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE $1))::date
         AND date <= (CURRENT_TIMESTAMP AT TIME ZONE $1)::date`,
      [APP_TIMEZONE]
    );

    const purchasePaidToday = await pool.query(
      `SELECT COALESCE(SUM(total), 0)::bigint AS amount, COUNT(*)::int AS po_count
       FROM purchases
       WHERE payment_status = 'paid' AND status <> 'cancelled'
         AND date = (CURRENT_TIMESTAMP AT TIME ZONE $1)::date`,
      [APP_TIMEZONE]
    );

    // Piutang grosir: total belum lunas, jumlah invoice, dan yang lewat jatuh tempo.
    const receivable = await getReceivableSummary();

    res.json({
      today: {
        txn_count: today.rows[0].txn_count,
        grand_total: Number(today.rows[0].grand_total),
        tax_total: Number(today.rows[0].tax_total),
        gross_profit: Number(profitToday.rows[0].gross_profit),
        expense: Number(expenseToday.rows[0].expense),
        purchase_paid: Number(purchasePaidToday.rows[0].amount),
        purchase_paid_count: purchasePaidToday.rows[0].po_count,
        // Laba bersih hari ini = laba kotor - koreksi retur - beban hari ini.
        net_profit:
          Number(profitToday.rows[0].gross_profit)
          - (Number(profitTodayReturns.rows[0].return_refund) - Number(profitTodayReturns.rows[0].return_cogs))
          - Number(expenseToday.rows[0].expense),
      },
      month: {
        txn_count: month.rows[0].txn_count,
        grand_total: Number(month.rows[0].grand_total),
        gross_profit: Number(profitMonth.rows[0].gross_profit),
        expense: Number(expenseMonth.rows[0].expense),
        purchase_paid: Number(purchasePaidMonth.rows[0].amount),
        purchase_paid_count: purchasePaidMonth.rows[0].po_count,
        // Samakan dengan net_profit harian & /profit-loss: koreksi retur ikut dihitung.
        net_profit:
          Number(profitMonth.rows[0].gross_profit)
          - (Number(profitMonthReturns.rows[0].return_refund) - Number(profitMonthReturns.rows[0].return_cogs))
          - Number(expenseMonth.rows[0].expense),
      },
      top_products: topProducts.rows,
      low_stock_count: lowStock.rows[0].n,
      open_shifts: openShifts.rows[0].n,
      receivable: {
        outstanding_total: receivable.outstanding_total,
        unpaid_count: receivable.unpaid_count,
        overdue_total: receivable.overdue_total,
        overdue_count: receivable.overdue_count,
      },
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

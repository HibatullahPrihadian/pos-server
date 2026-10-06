const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { restoreSaleStock } = require('../utils/batches');
const { getReceivableSummary, APP_TIMEZONE } = require('../utils/receivables');
const { sendCsv } = require('../utils/csv');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

const PAYMENT_METHODS = new Set(['cash', 'qris', 'debit', 'transfer']);

// Tanggal "hari ini" menurut zona waktu toko (konsisten dengan modul laporan).
const TODAY_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE '${APP_TIMEZONE}')::date`;

const INVOICE_SELECT = `
  SELECT s.id, s.invoice_no, s.created_at, s.due_date, s.customer_id, s.subtotal,
         s.item_discount, s.txn_discount, s.points_value, s.tax_total, s.grand_total,
         s.paid_amount, s.payment_status, s.status, s.cashier_id,
         c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone,
         c.address AS customer_address, c.npwp AS customer_npwp,
         u.full_name AS cashier_name,
         (s.grand_total - s.paid_amount)::bigint AS outstanding,
         (s.payment_status <> 'paid' AND s.due_date IS NOT NULL AND s.due_date < ${TODAY_SQL}) AS is_overdue
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN users u ON u.id = s.cashier_id
`;

const wantsCsv = (query) => String(query.format || '').toLowerCase() === 'csv';

const withNumbers = (row) => row && {
  ...row,
  subtotal: Number(row.subtotal),
  item_discount: Number(row.item_discount),
  txn_discount: Number(row.txn_discount),
  points_value: Number(row.points_value),
  tax_total: Number(row.tax_total),
  grand_total: Number(row.grand_total),
  paid_amount: Number(row.paid_amount),
  outstanding: Number(row.outstanding),
};

// =========================================================
// Ringkasan piutang (untuk dashboard)
// =========================================================
router.get('/summary', requirePermission('invoice.view', 'invoice.manage'), async (req, res, next) => {
  try {
    res.json(await getReceivableSummary(pool, req.business));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Daftar invoice kredit
// =========================================================
router.get('/', requirePermission('invoice.view', 'invoice.manage'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const customerId = toInt(req.query.customer_id, 0);
    const status = cleanString(req.query.payment_status, 10);
    const overdueOnly = String(req.query.overdue_only || '') === 'true';
    const search = cleanString(req.query.search, 60);

    // Piutang dipisah per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ["s.business = $1", "s.is_credit = TRUE", "s.status = 'completed'"];
    const params = [req.business];

    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`s.created_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`s.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (customerId > 0) {
      params.push(customerId);
      conditions.push(`s.customer_id = $${params.length}`);
    }
    if (['unpaid', 'partial', 'paid'].includes(status)) {
      params.push(status);
      conditions.push(`s.payment_status = $${params.length}`);
    }
    if (overdueOnly) {
      conditions.push(`s.payment_status <> 'paid' AND s.due_date IS NOT NULL AND s.due_date < ${TODAY_SQL}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(s.invoice_no) LIKE $${params.length} OR LOWER(COALESCE(c.name, '')) LIKE $${params.length})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${where}`,
      params
    );
    params.push(limit, offset);
    const result = await pool.query(
      `${INVOICE_SELECT} ${where} ORDER BY s.created_at DESC, s.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const data = result.rows.map(withNumbers);

    if (wantsCsv(req.query)) {
      return sendCsv(res, `invoice-grosir-${from || 'all'}_${to || 'all'}.csv`, data, [
        'invoice_no', 'created_at', 'due_date', 'customer_name', 'grand_total', 'paid_amount',
        'outstanding', 'payment_status', 'is_overdue',
      ]);
    }

    res.json(paginated(data, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Detail invoice
// =========================================================
router.get('/:id', requirePermission('invoice.view', 'invoice.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `${INVOICE_SELECT} WHERE s.id = $1 AND s.business = $2 AND s.is_credit = TRUE`,
      [req.params.id, req.business]
    );
    const invoice = result.rows[0];
    if (!invoice) throw new HttpError(404, 'Invoice tidak ditemukan');

    const items = await pool.query(
      `SELECT si.*, p.sku, p.name AS product_name, p.base_unit,
              b.name AS bundle_name, b.sku AS bundle_sku,
              ps.name AS service_name,
              COALESCE(p.name, b.name, ps.name) AS display_name
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN bundles b ON b.id = si.bundle_id
       LEFT JOIN print_services ps ON ps.id = si.service_id
       WHERE si.sale_id = $1
       ORDER BY si.id`,
      [req.params.id]
    );

    const payments = await pool.query(
      `SELECT ip.*, u.full_name AS user_name
       FROM invoice_payments ip
       LEFT JOIN users u ON u.id = ip.user_id
       WHERE ip.sale_id = $1
       ORDER BY ip.paid_at, ip.id`,
      [req.params.id]
    );

    res.json({
      ...withNumbers(invoice),
      items: items.rows.map((i) => ({
        ...i,
        line_total: Number(i.line_total),
        unit_price: Number(i.unit_price),
        discount: Number(i.discount),
      })),
      payments: payments.rows.map((p) => ({ ...p, amount: Number(p.amount) })),
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Catat pembayaran cicilan
// =========================================================
router.post('/:id/payments', requirePermission('invoice.manage'), async (req, res, next) => {
  try {
    const amount = Math.round(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah pembayaran tidak valid');

    const method = cleanString(req.body?.method, 10);
    if (!PAYMENT_METHODS.has(method)) throw new HttpError(400, 'Metode pembayaran tidak valid');
    const reference = cleanString(req.body?.reference, 100);
    const note = cleanString(req.body?.note, 300);

    const result = await withTransaction(async (client) => {
      const saleResult = await client.query(
        'SELECT * FROM sales WHERE id = $1 AND business = $2 AND is_credit = TRUE FOR UPDATE',
        [req.params.id, req.business]
      );
      const sale = saleResult.rows[0];
      if (!sale) throw new HttpError(404, 'Invoice tidak ditemukan');
      if (sale.status === 'void') throw new HttpError(400, 'Invoice sudah di-void');

      const outstanding = Number(sale.grand_total) - Number(sale.paid_amount);
      if (outstanding <= 0) throw new HttpError(400, 'Invoice sudah lunas');
      if (amount > outstanding) throw new HttpError(400, `Jumlah melebihi sisa tagihan (${outstanding})`);

      await client.query(
        `INSERT INTO invoice_payments (sale_id, amount, method, reference, user_id, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sale.id, amount, method, reference, req.user.id, note]
      );

      const newPaid = Number(sale.paid_amount) + amount;
      const paymentStatus = newPaid >= Number(sale.grand_total) ? 'paid' : 'partial';

      const updated = await client.query(
        `UPDATE sales SET paid_amount = $1, payment_status = $2 WHERE id = $3 RETURNING *`,
        [newPaid, paymentStatus, sale.id]
      );

      return { sale: updated.rows[0], amount, paymentStatus };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'invoice_payment',
      entity: 'sales',
      entityId: Number(req.params.id),
      detail: { amount, method, payment_status: result.paymentStatus },
    });

    res.json(withNumbers(result.sale));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Void invoice kredit (mengembalikan stok & membatalkan piutang)
// =========================================================
router.post('/:id/void', requirePermission('invoice.manage'), async (req, res, next) => {
  try {
    const reason = cleanString(req.body?.reason, 300) || 'Tanpa alasan';

    const result = await withTransaction(async (client) => {
      const saleResult = await client.query(
        'SELECT * FROM sales WHERE id = $1 AND business = $2 AND is_credit = TRUE FOR UPDATE',
        [req.params.id, req.business]
      );
      const sale = saleResult.rows[0];
      if (!sale) throw new HttpError(404, 'Invoice tidak ditemukan');
      if (sale.status === 'void') throw new HttpError(400, 'Invoice sudah di-void');

      // Void mengembalikan stok DAN membatalkan piutang. Pembayaran yang sudah
      // tercatat tetap tersimpan sebagai jejak di invoice_payments; invoice tidak
      // lagi dihitung sebagai piutang karena statusnya menjadi void.
      const paidBefore = Number(sale.paid_amount);

      // Kembalikan stok seluruh item (produk & paket) memakai helper bersama.
      await restoreSaleStock(client, sale, { userId: req.user.id });

      // Kembalikan poin member yang ditukar saat checkout (earned selalu 0 untuk
      // kredit). Tanpa ini, member kehilangan poin yang sudah didebit permanen.
      let pointsReturned = 0;
      if (sale.member_id) {
        const member = await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [sale.member_id]);
        if (member.rows[0]) {
          const delta = Number(sale.points_redeemed) - Number(sale.points_earned);
          if (delta !== 0) {
            const newBalance = Math.max(0, member.rows[0].points + delta);
            await client.query('UPDATE members SET points = $1 WHERE id = $2', [newBalance, sale.member_id]);
            await client.query(
              `INSERT INTO member_point_logs (member_id, change, balance_after, type, ref_type, ref_id, note)
               VALUES ($1, $2, $3, 'adjust', 'sale_void', $4, $5)`,
              [sale.member_id, delta, newBalance, sale.id, `Void ${sale.invoice_no}`]
            );
            pointsReturned = delta;
          }
        }
      }

      const updated = await client.query(
        `UPDATE sales SET status = 'void', void_reason = $1, void_by = $2, void_at = NOW()
         WHERE id = $3 RETURNING *`,
        [reason, req.user.id, sale.id]
      );

      return { sale: updated.rows[0], paidBefore, pointsReturned };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'void',
      entity: 'sales',
      entityId: Number(req.params.id),
      detail: { reason, is_credit: true, reversed_payment: result.paidBefore, points_returned: result.pointsReturned },
    });

    res.json(result.sale);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

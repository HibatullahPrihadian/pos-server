const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

// Ringkasan kas untuk sebuah shift.
const buildSummary = async (runner, shift) => {
  const salesAgg = await runner.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'completed' THEN grand_total ELSE 0 END), 0)::bigint AS sales_total,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS sales_count,
       COALESCE(SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END), 0)::int AS void_count
     FROM sales WHERE shift_id = $1`,
    [shift.id]
  );

  const cashPayments = await runner.query(
    `SELECT COALESCE(SUM(sp.amount), 0)::bigint AS cash_in
     FROM sale_payments sp
     JOIN sales s ON s.id = sp.sale_id
     WHERE s.shift_id = $1 AND s.status = 'completed' AND sp.method = 'cash'`,
    [shift.id]
  );

  const cashRefunds = await runner.query(
    `SELECT COALESCE(SUM(r.total), 0)::bigint AS cash_out
     FROM returns r
     WHERE r.shift_id = $1 AND r.refund_method = 'cash'`,
    [shift.id]
  );

  const byMethod = await runner.query(
    `SELECT sp.method, COALESCE(SUM(sp.amount), 0)::bigint AS total, COUNT(*)::int AS count
     FROM sale_payments sp
     JOIN sales s ON s.id = sp.sale_id
     WHERE s.shift_id = $1 AND s.status = 'completed'
     GROUP BY sp.method ORDER BY sp.method`,
    [shift.id]
  );

  const openingCash = Number(shift.opening_cash);
  const cashIn = Number(cashPayments.rows[0].cash_in);
  const cashOut = Number(cashRefunds.rows[0].cash_out);
  const expectedCash = openingCash + cashIn - cashOut;

  return {
    shift,
    sales_total: Number(salesAgg.rows[0].sales_total),
    sales_count: salesAgg.rows[0].sales_count,
    void_count: salesAgg.rows[0].void_count,
    cash_in: cashIn,
    cash_refund: cashOut,
    expected_cash: expectedCash,
    by_method: byMethod.rows.map((r) => ({ ...r, total: Number(r.total) })),
  };
};

router.get('/current', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM shifts WHERE user_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.json({ shift: null });

    const summary = await buildSummary(pool, result.rows[0]);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.post('/open', requirePermission('shift.use'), async (req, res, next) => {
  try {
    const openingCash = Math.max(0, Math.round(Number(req.body?.opening_cash) || 0));
    const note = cleanString(req.body?.note, 300);

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id FROM shifts WHERE user_id = $1 AND closed_at IS NULL FOR UPDATE',
        [req.user.id]
      );
      if (existing.rows[0]) throw new HttpError(400, 'Anda masih memiliki shift terbuka');

      const inserted = await client.query(
        `INSERT INTO shifts (user_id, opening_cash, note) VALUES ($1, $2, $3) RETURNING *`,
        [req.user.id, openingCash, note]
      );
      return inserted.rows[0];
    });

    await logAudit(pool, { userId: req.user.id, action: 'open', entity: 'shifts', entityId: result.id });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/close', requirePermission('shift.use'), async (req, res, next) => {
  try {
    const countedCash = Math.max(0, Math.round(Number(req.body?.counted_cash) || 0));
    const note = cleanString(req.body?.note, 300);
    const shiftId = toInt(req.body?.shift_id, 0) || null;

    const closed = await withTransaction(async (client) => {
      const result = shiftId
        ? await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId])
        : await client.query(
            'SELECT * FROM shifts WHERE user_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1 FOR UPDATE',
            [req.user.id]
          );

      const shift = result.rows[0];
      if (!shift) throw new HttpError(404, 'Shift terbuka tidak ditemukan');
      if (shift.closed_at) throw new HttpError(400, 'Shift sudah ditutup');
      if (!req.user.is_admin && shift.user_id !== req.user.id) {
        throw new HttpError(403, 'Shift ini bukan milik Anda');
      }

      const summary = await buildSummary(client, shift);
      const difference = countedCash - summary.expected_cash;

      const updated = await client.query(
        `UPDATE shifts SET closed_at = NOW(), expected_cash = $1, counted_cash = $2, difference = $3, note = COALESCE($4, note)
         WHERE id = $5 RETURNING *`,
        [summary.expected_cash, countedCash, difference, note, shift.id]
      );

      return { shift: updated.rows[0], summary, difference };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'close',
      entity: 'shifts',
      entityId: closed.shift.id,
      detail: { difference: closed.difference },
    });

    res.json(closed);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const userId = toInt(req.query.user_id, 0);

    const conditions = [];
    const params = [];
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`sh.opened_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`sh.opened_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (userId > 0) {
      params.push(userId);
      conditions.push(`sh.user_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM shifts sh ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT sh.*, u.full_name AS user_name FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id
       ${where} ORDER BY sh.opened_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/summary', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sh.*, u.full_name AS user_name FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id WHERE sh.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Shift tidak ditemukan');
    const summary = await buildSummary(pool, result.rows[0]);
    res.json({ ...summary, user_name: result.rows[0].user_name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

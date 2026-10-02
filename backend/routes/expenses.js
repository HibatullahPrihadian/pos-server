const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { requireString, cleanString, isValidDate, toBool } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt, requireRole('admin'));

const EXPENSE_SELECT = `
  SELECT e.*, ec.name AS category_name, u.full_name AS user_name
  FROM expenses e
  LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
  LEFT JOIN users u ON u.id = e.user_id
`;

const toMoney = (value) => Math.round(Number(value));

// =========================================================
// Kategori beban (expense_categories)
// =========================================================
router.get('/categories', async (req, res, next) => {
  try {
    const includeInactive = toBool(req.query.include_inactive, false);
    const result = await pool.query(
      `SELECT ec.*, COALESCE(cnt.n, 0)::int AS expense_count
       FROM expense_categories ec
       LEFT JOIN (
         SELECT expense_category_id, COUNT(*)::int AS n
         FROM expenses GROUP BY expense_category_id
       ) cnt ON cnt.expense_category_id = ec.id
       ${includeInactive ? '' : 'WHERE ec.is_active = TRUE'}
       ORDER BY ec.name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/categories', requireRole('admin'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama kategori', 100);
    if (name.error) throw new HttpError(400, name.error);
    const result = await pool.query(
      'INSERT INTO expense_categories (name) VALUES ($1) RETURNING *',
      [name.value]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'expense_categories', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama kategori', 100);
    if (name.error) throw new HttpError(400, name.error);
    const isActive = toBool(req.body?.is_active, true);

    const result = await pool.query(
      'UPDATE expense_categories SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
      [name.value, isActive, req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Kategori beban tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'expense_categories', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Hapus hanya jika belum dipakai beban; jika tidak, nonaktifkan saja.
router.delete('/categories/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM expenses WHERE expense_category_id = $1', [req.params.id]);
    if (used.rows[0].n > 0) {
      throw new HttpError(409, 'Kategori masih dipakai beban; nonaktifkan saja');
    }
    const result = await pool.query('DELETE FROM expense_categories WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Kategori beban tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'expense_categories', entityId: Number(req.params.id) });
    res.json({ message: 'Kategori beban dihapus' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Beban operasional (expenses)
// =========================================================
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const categoryId = toInt(req.query.category_id, 0);
    const status = cleanString(req.query.payment_status, 10);
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);

    const conditions = [];
    const params = [];
    if (categoryId > 0) {
      params.push(categoryId);
      conditions.push(`e.expense_category_id = $${params.length}`);
    }
    if (status && ['unpaid', 'paid'].includes(status)) {
      params.push(status);
      conditions.push(`e.payment_status = $${params.length}`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`e.date >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`e.date <= $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM expenses e ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${EXPENSE_SELECT} ${where} ORDER BY e.date DESC, e.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rows = result.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      paid_amount: Number(row.paid_amount),
    }));
    res.json(paginated(rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`${EXPENSE_SELECT} WHERE e.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Beban tidak ditemukan');
    const row = result.rows[0];
    res.json({ ...row, amount: Number(row.amount), paid_amount: Number(row.paid_amount) });
  } catch (err) {
    next(err);
  }
});

// Validasi & normalisasi payload beban. `existingPaid` dipakai saat update agar
// pengubahan beban tidak menghapus pembayaran parsial yang sudah tercatat.
const buildExpense = (body, existingPaid = 0) => {
  const amount = toMoney(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah beban harus lebih dari 0');

  const date = cleanString(body?.date, 10);
  if (date && !isValidDate(date)) throw new HttpError(400, 'Format tanggal harus YYYY-MM-DD');

  const categoryId = toInt(body?.expense_category_id, 0) || null;
  const method = cleanString(body?.method, 20);
  const note = cleanString(body?.note, 500);

  // Status awal: default 'paid' (dibayar penuh) agar input cepat beban tunai.
  const paymentStatus = body?.payment_status === 'unpaid' ? 'unpaid' : 'paid';
  // Bila body tidak mengirim paid_amount (mis. form edit), pertahankan nilai lama.
  const rawPaid = body?.paid_amount === undefined ? existingPaid : body.paid_amount;
  let paidAmount = toMoney(rawPaid);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) paidAmount = 0;
  if (paidAmount > amount) paidAmount = amount;
  if (paymentStatus === 'paid') paidAmount = amount;

  return { amount, date, categoryId, method, note, paymentStatus, paidAmount };
};

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const payload = buildExpense(req.body);
    const created = await withTransaction(async (client) => {
      const code = await nextDocNumber(client, 'EXP', payload.date || undefined);
      const result = await client.query(
        `INSERT INTO expenses (code, expense_category_id, date, amount, payment_status, paid_amount, method, note, user_id)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          code, payload.categoryId, payload.date || null, payload.amount,
          payload.paymentStatus, payload.paidAmount, payload.method, payload.note, req.user.id,
        ]
      );
      return result.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'create',
      entity: 'expenses',
      entityId: created.id,
      detail: { code: created.code, amount: Number(created.amount) },
    });
    res.status(201).json({ ...created, amount: Number(created.amount), paid_amount: Number(created.paid_amount) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Beban tidak ditemukan');

    const payload = buildExpense(req.body, Number(existing.rows[0].paid_amount));
    const updated = await pool.query(
      `UPDATE expenses SET expense_category_id = $1, date = COALESCE($2::date, date), amount = $3,
         payment_status = $4, paid_amount = $5, method = $6, note = $7
       WHERE id = $8 RETURNING *`,
      [
        payload.categoryId, payload.date || null, payload.amount,
        payload.paymentStatus, payload.paidAmount, payload.method, payload.note, req.params.id,
      ]
    );

    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'expenses',
      entityId: Number(req.params.id),
      detail: { amount: payload.amount },
    });
    res.json({ ...updated.rows[0], amount: Number(updated.rows[0].amount), paid_amount: Number(updated.rows[0].paid_amount) });
  } catch (err) {
    next(err);
  }
});

// Hapus beban. Beban lunas tetap boleh dihapus (dengan audit) karena kesalahan
// input beban tunai harus bisa dikoreksi; konfirmasi dilakukan di UI.
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Beban tidak ditemukan');

    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    await logAudit(pool, {
      userId: req.user.id,
      action: 'delete',
      entity: 'expenses',
      entityId: Number(req.params.id),
      detail: { code: existing.rows[0].code, amount: Number(existing.rows[0].amount) },
    });
    res.json({ message: 'Beban dihapus' });
  } catch (err) {
    next(err);
  }
});

// Catat pembayaran beban (unpaid -> paid bila lunas). Pola purchases/:id/payment.
router.post('/:id/payment', requireRole('admin'), async (req, res, next) => {
  try {
    const amount = toMoney(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah bayar tidak valid');

    const updated = await withTransaction(async (client) => {
      const result = await client.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [req.params.id]);
      const expense = result.rows[0];
      if (!expense) throw new HttpError(404, 'Beban tidak ditemukan');

      const total = Number(expense.amount);
      const newPaid = Math.min(total, Number(expense.paid_amount) + amount);
      const paymentStatus = newPaid >= total ? 'paid' : 'unpaid';

      const res2 = await client.query(
        'UPDATE expenses SET paid_amount = $1, payment_status = $2 WHERE id = $3 RETURNING *',
        [newPaid, paymentStatus, expense.id]
      );
      return res2.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'payment',
      entity: 'expenses',
      entityId: Number(req.params.id),
      detail: { amount },
    });
    res.json({ ...updated, amount: Number(updated.amount), paid_amount: Number(updated.paid_amount) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

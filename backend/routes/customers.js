const express = require('express');
const pool = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated } = require('../utils/pagination');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { APP_TIMEZONE } = require('../utils/receivables');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Email pelanggan: format dasar saja (konsisten dengan member).
const assertValidEmail = (value) => {
  const email = cleanString(value, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email tidak valid');
  }
  return email;
};

// Tanggal "hari ini" menurut zona waktu toko (konsisten dengan modul laporan).
const TODAY_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE '${APP_TIMEZONE}')::date`;

router.use(verifyJwt);

// Kode pelanggan berurutan: CUST-0001, CUST-0002, ...
const nextCustomerCode = async (client) => {
  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 6) AS INTEGER)), 0) AS last
     FROM customers WHERE code LIKE 'CUST-%'`
  );
  const next = Number(result.rows[0].last) + 1;
  return `CUST-${String(next).padStart(4, '0')}`;
};

const parseCreditLimit = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Limit kredit tidak valid');
  return n;
};

const parseTermDays = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 3650) throw new HttpError(400, 'Termin (hari) tidak valid');
  return n;
};

// print.use ikut diizinkan: form pesanan fotokopi memilih pelanggan dari master.
router.get('/', requirePermission('invoice.manage', 'invoice.view', 'customer.manage', 'print.use'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const search = cleanString(req.query.search, 150);
    const activeOnly = req.query.is_active === undefined ? true : toBool(req.query.is_active, true);

    // Pisahkan pelanggan per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ['business = $1'];
    const params = [req.business];
    if (activeOnly) conditions.push('is_active = TRUE');
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(name) LIKE $${params.length} OR LOWER(code) LIKE $${params.length}
          OR LOWER(COALESCE(contact_name, '')) LIKE $${params.length}
          OR COALESCE(phone, '') LIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM customers ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT c.*,
              COALESCE((
                SELECT SUM(s.grand_total - s.paid_amount)
                FROM sales s
                WHERE s.customer_id = c.id AND s.is_credit = TRUE AND s.status = 'completed'
                  AND s.payment_status <> 'paid'
              ), 0)::bigint AS outstanding
       FROM customers c ${where}
       ORDER BY c.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const data = result.rows.map((row) => ({ ...row, outstanding: Number(row.outstanding) }));
    res.json(paginated(data, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('invoice.manage', 'invoice.view', 'customer.manage', 'print.use'), async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    if (!result.rows[0]) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Statement piutang: daftar invoice kredit + total outstanding pelanggan.
router.get('/:id/statement', requirePermission('invoice.manage', 'invoice.view'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });

    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    const customer = customerResult.rows[0];
    if (!customer) throw new HttpError(404, 'Pelanggan tidak ditemukan');

    // Total piutang dihitung di SQL (bukan di JS) agar tidak bergantung jumlah baris.
    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(grand_total - paid_amount), 0)::bigint AS outstanding_total
       FROM sales
       WHERE customer_id = $1 AND business = $2 AND is_credit = TRUE AND status = 'completed' AND payment_status <> 'paid'`,
      [req.params.id, req.business]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM sales
       WHERE customer_id = $1 AND business = $2 AND is_credit = TRUE AND status = 'completed'`,
      [req.params.id, req.business]
    );

    const invoices = await pool.query(
      `SELECT id, invoice_no, created_at, due_date, grand_total, paid_amount, payment_status,
              (grand_total - paid_amount)::bigint AS outstanding,
              (payment_status <> 'paid' AND due_date IS NOT NULL AND due_date < ${TODAY_SQL}) AS is_overdue
       FROM sales
       WHERE customer_id = $1 AND business = $2 AND is_credit = TRUE AND status = 'completed'
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.business, limit, offset]
    );

    const rows = invoices.rows.map((r) => ({
      ...r,
      grand_total: Number(r.grand_total),
      paid_amount: Number(r.paid_amount),
      outstanding: Number(r.outstanding),
    }));

    res.json({
      customer,
      outstanding_total: Number(totalResult.rows[0].outstanding_total),
      invoices: rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        total_pages: limit > 0 ? Math.ceil(countResult.rows[0].total / limit) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('customer.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama pelanggan', 150);
    if (name.error) throw new HttpError(400, name.error);

    const termDays = parseTermDays(req.body?.payment_term_days ?? 0);
    const creditLimit = parseCreditLimit(req.body?.credit_limit ?? 0);
    const code = cleanString(req.body?.code, 30) || (await nextCustomerCode(pool));

    const result = await pool.query(
      `INSERT INTO customers
        (code, name, contact_name, phone, email, address, npwp, payment_term_days, credit_limit, business)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        code, name.value, cleanString(req.body?.contact_name, 150), cleanString(req.body?.phone, 50),
        assertValidEmail(req.body?.email), cleanString(req.body?.address, 1000), cleanString(req.body?.npwp, 50),
        termDays, creditLimit, req.business,
      ]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'customers', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('customer.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama pelanggan', 150);
    if (name.error) throw new HttpError(400, name.error);

    const termDays = parseTermDays(req.body?.payment_term_days ?? 0);
    const creditLimit = parseCreditLimit(req.body?.credit_limit ?? 0);
    // Bila is_active tidak dikirim, pertahankan nilai saat ini (jangan aktifkan ulang
    // pelanggan yang sudah dinonaktifkan hanya karena field ini dihilangkan).
    const isActive = req.body?.is_active === undefined || req.body?.is_active === null
      ? null
      : toBool(req.body.is_active, true);

    const result = await pool.query(
      `UPDATE customers SET
         name = $1, contact_name = $2, phone = $3, email = $4, address = $5, npwp = $6,
         payment_term_days = $7, credit_limit = $8, is_active = COALESCE($9::boolean, is_active)
       WHERE id = $10 AND business = $11 RETURNING *`,
      [
        name.value, cleanString(req.body?.contact_name, 150), cleanString(req.body?.phone, 50),
        assertValidEmail(req.body?.email), cleanString(req.body?.address, 1000), cleanString(req.body?.npwp, 50),
        termDays, creditLimit, isActive, req.params.id, req.business,
      ]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'customers', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('customer.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE customers SET is_active = FALSE WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Pelanggan tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'deactivate', entity: 'customers', entityId: Number(req.params.id) });
    res.json({ message: 'Pelanggan dinonaktifkan' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

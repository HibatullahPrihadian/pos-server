const express = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const includeInactive = toBool(req.query.include_inactive, false);
    const result = await pool.query(
      `SELECT * FROM suppliers
       WHERE business = $1 ${includeInactive ? '' : 'AND is_active = TRUE'}
       ORDER BY name`,
      [req.business]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM suppliers WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    if (!result.rows[0]) throw new HttpError(404, 'Supplier tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama supplier', 150);
    if (name.error) throw new HttpError(400, name.error);
    const result = await pool.query(
      'INSERT INTO suppliers (name, phone, address, note, business) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        name.value,
        cleanString(req.body?.phone, 50),
        cleanString(req.body?.address, 500),
        cleanString(req.body?.note, 500),
        req.business,
      ]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'suppliers', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama supplier', 150);
    if (name.error) throw new HttpError(400, name.error);
    const isActive = toBool(req.body?.is_active, true);

    const result = await pool.query(
      `UPDATE suppliers SET name = $1, phone = $2, address = $3, note = $4, is_active = $5
       WHERE id = $6 AND business = $7 RETURNING *`,
      [
        name.value,
        cleanString(req.body?.phone, 50),
        cleanString(req.body?.address, 500),
        cleanString(req.body?.note, 500),
        isActive,
        req.params.id,
        req.business,
      ]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Supplier tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'suppliers', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const used = await pool.query(
      'SELECT COUNT(*)::int AS n FROM products WHERE supplier_id = $1 AND business = $2',
      [req.params.id, req.business]
    );
    if (used.rows[0].n > 0) throw new HttpError(409, 'Supplier masih dipakai produk');

    const result = await pool.query(
      'DELETE FROM suppliers WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Supplier tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'suppliers', entityId: Number(req.params.id) });
    res.json({ message: 'Supplier dihapus' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const includeInactive = toBool(req.query.include_inactive, false);
    const conditions = ['c.business = $1'];
    const params = [req.business];
    if (!includeInactive) conditions.push('c.is_active = TRUE');
    const result = await pool.query(
      `SELECT c.*, (
         SELECT COUNT(*)::int FROM products p
         WHERE p.category_id = c.id AND p.business = $1
       ) AS product_count
       FROM categories c
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama kategori', 100);
    if (name.error) throw new HttpError(400, name.error);
    const result = await pool.query(
      'INSERT INTO categories (name, business) VALUES ($1, $2) RETURNING *',
      [name.value, req.business]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'categories', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama kategori', 100);
    if (name.error) throw new HttpError(400, name.error);
    const isActive = toBool(req.body?.is_active, true);

    const result = await pool.query(
      'UPDATE categories SET name = $1, is_active = $2 WHERE id = $3 AND business = $4 RETURNING *',
      [name.value, isActive, req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Kategori tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'categories', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Hapus hanya jika belum dipakai produk; jika tidak, nonaktifkan saja.
router.delete('/:id', requirePermission('supplier.manage'), async (req, res, next) => {
  try {
    const used = await pool.query(
      'SELECT COUNT(*)::int AS n FROM products WHERE category_id = $1 AND business = $2',
      [req.params.id, req.business]
    );
    if (used.rows[0].n > 0) {
      throw new HttpError(409, 'Kategori masih dipakai produk; nonaktifkan saja');
    }
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Kategori tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'categories', entityId: Number(req.params.id) });
    res.json({ message: 'Kategori dihapus' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

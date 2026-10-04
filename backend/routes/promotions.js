const express = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { requireString, cleanString, toBool, isValidDate } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const SCOPES = new Set(['product', 'category']);
const DISCOUNT_TYPES = new Set(['percent', 'amount', 'batch_price']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const SELECT_PROMO = `
  SELECT pr.*,
         p.name AS product_name,
         c.name AS category_name,
         pu.unit_name
  FROM promotions pr
  LEFT JOIN products p ON p.id = pr.product_id
  LEFT JOIN categories c ON c.id = pr.category_id
  LEFT JOIN product_units pu ON pu.id = pr.unit_id
`;

const normalizeMoney = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Math.round(Number(String(value).replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) ? n : null;
};

// Normalisasi jam ke 'HH:MM:SS'; null bila kosong.
const normalizeTime = (value) => {
  const s = cleanString(value, 8);
  if (!s) return null;
  if (!TIME_RE.test(s)) return { error: 'Format jam harus HH:MM' };
  return s.length === 5 ? `${s}:00` : s;
};

// Normalisasi days_of_week menjadi array smallint unik 0..6; null bila kosong.
const normalizeDays = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const days = [...new Set(list.map((d) => Math.round(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return days.length > 0 ? days : null;
};

const validateBody = (body, { partial = false } = {}) => {
  const value = {};

  if (!partial || 'name' in body) {
    const name = requireString(body?.name, 'Nama promo', 150);
    if (name.error) return { error: name.error };
    value.name = name.value;
  }

  if (!partial || 'scope' in body) {
    const scope = cleanString(body?.scope, 10);
    if (!SCOPES.has(scope)) return { error: 'Scope promo tidak valid' };
    value.scope = scope;
  }

  if (!partial || 'discount_type' in body) {
    const dtype = cleanString(body?.discount_type, 15);
    if (!DISCOUNT_TYPES.has(dtype)) return { error: 'Tipe diskon tidak valid' };
    value.discount_type = dtype;
  }

  if (!partial || 'discount_value' in body) {
    const dv = normalizeMoney(body?.discount_value);
    if (dv === null || dv < 0) return { error: 'Nilai diskon tidak valid' };
    if (value.discount_type === 'percent' && dv > 100) return { error: 'Diskon persen maksimal 100' };
    value.discount_value = dv;
  }

  if ('min_qty' in body) {
    const mq = Math.round(Number(body.min_qty));
    if (!Number.isFinite(mq) || mq <= 0) return { error: 'min_qty harus bilangan bulat positif' };
    value.min_qty = mq;
  }

  if ('product_id' in body) value.product_id = toInt(body.product_id, 0) || null;
  if ('category_id' in body) value.category_id = toInt(body.category_id, 0) || null;
  if ('unit_id' in body) value.unit_id = toInt(body.unit_id, 0) || null;

  if ('start_time' in body) {
    const t = normalizeTime(body.start_time);
    if (t && t.error) return { error: t.error };
    value.start_time = t;
  }
  if ('end_time' in body) {
    const t = normalizeTime(body.end_time);
    if (t && t.error) return { error: t.error };
    value.end_time = t;
  }

  if ('days_of_week' in body) value.days_of_week = normalizeDays(body.days_of_week);

  if ('start_date' in body) {
    const d = cleanString(body.start_date, 10);
    if (d && !isValidDate(d)) return { error: 'start_date tidak valid' };
    value.start_date = d || null;
  }
  if ('end_date' in body) {
    const d = cleanString(body.end_date, 10);
    if (d && !isValidDate(d)) return { error: 'end_date tidak valid' };
    value.end_date = d || null;
  }

  if ('is_active' in body) value.is_active = toBool(body.is_active, true);

  return { value };
};

// Validasi target sesuai scope dan konsistensi tanggal/satuan.
const validateScopeTarget = async (v) => {
  if (v.scope === 'product' && !v.product_id) throw new HttpError(400, 'Promo produk wajib memilih produk');
  if (v.scope === 'category' && !v.category_id) throw new HttpError(400, 'Promo kategori wajib memilih kategori');
  if (v.start_date && v.end_date && v.start_date > v.end_date) {
    throw new HttpError(400, 'Tanggal mulai tidak boleh melebihi tanggal selesai');
  }
  if (v.start_time && v.end_time && v.start_time === v.end_time) {
    throw new HttpError(400, 'Jam mulai dan selesai tidak boleh sama');
  }

  // Satuan (bila diisi) harus milik produk yang di-scope, atau produk dalam kategori
  // yang di-scope. Mencegah promo berlaku pada satuan produk yang tidak relevan.
  if (v.unit_id) {
    if (v.scope === 'product') {
      const unit = await pool.query(
        'SELECT id FROM product_units WHERE id = $1 AND product_id = $2',
        [v.unit_id, v.product_id]
      );
      if (!unit.rows[0]) throw new HttpError(400, 'Satuan tidak sesuai dengan produk promo');
    } else {
      const unit = await pool.query(
        `SELECT pu.id FROM product_units pu
         JOIN products p ON p.id = pu.product_id
         WHERE pu.id = $1 AND p.category_id = $2`,
        [v.unit_id, v.category_id]
      );
      if (!unit.rows[0]) throw new HttpError(400, 'Satuan tidak sesuai dengan kategori promo');
    }
  }
};

router.get('/', requirePermission('promotion.manage'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const activeOnly = toBool(req.query.is_active, false);

    const where = activeOnly ? 'WHERE pr.is_active = TRUE' : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM promotions pr ${where}`);
    const result = await pool.query(
      `${SELECT_PROMO} ${where} ORDER BY pr.is_active DESC, pr.id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('promotion.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(`${SELECT_PROMO} WHERE pr.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Promo tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('promotion.manage'), async (req, res, next) => {
  try {
    const { value, error } = validateBody(req.body || {}, { partial: false });
    if (error) throw new HttpError(400, error);
    value.min_qty = value.min_qty ?? 1;
    value.is_active = value.is_active ?? true;
    await validateScopeTarget(value);

    const result = await pool.query(
      `INSERT INTO promotions
        (name, scope, product_id, category_id, unit_id, discount_type, discount_value,
         min_qty, start_time, end_time, days_of_week, start_date, end_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        value.name, value.scope, value.product_id, value.category_id, value.unit_id,
        value.discount_type, value.discount_value, value.min_qty,
        value.start_time ?? null, value.end_time ?? null, value.days_of_week ?? null,
        value.start_date ?? null, value.end_date ?? null, value.is_active,
      ]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'promotions', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('promotion.manage'), async (req, res, next) => {
  try {
    const current = await pool.query('SELECT * FROM promotions WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) throw new HttpError(404, 'Promo tidak ditemukan');

    const { value, error } = validateBody(req.body || {}, { partial: true });
    if (error) throw new HttpError(400, error);

    // Gabung dengan nilai lama agar validasi lintas-field tetap konsisten.
    const merged = {
      scope: value.scope ?? current.rows[0].scope,
      product_id: 'product_id' in value ? value.product_id : current.rows[0].product_id,
      category_id: 'category_id' in value ? value.category_id : current.rows[0].category_id,
      unit_id: 'unit_id' in value ? value.unit_id : current.rows[0].unit_id,
      start_time: 'start_time' in value ? value.start_time : current.rows[0].start_time,
      end_time: 'end_time' in value ? value.end_time : current.rows[0].end_time,
      start_date: 'start_date' in value ? value.start_date : current.rows[0].start_date,
      end_date: 'end_date' in value ? value.end_date : current.rows[0].end_date,
      discount_type: value.discount_type ?? current.rows[0].discount_type,
      discount_value: value.discount_value ?? Number(current.rows[0].discount_value),
    };
    await validateScopeTarget(merged);
    if (merged.discount_type === 'percent' && merged.discount_value > 100) {
      throw new HttpError(400, 'Diskon persen maksimal 100');
    }

    const keys = Object.keys(value);
    if (keys.length === 0) throw new HttpError(400, 'Tidak ada perubahan');

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const params = keys.map((key) => value[key]);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE promotions SET ${setClause} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'promotions', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('promotion.manage'), async (req, res, next) => {
  try {
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM sale_items WHERE promo_id = $1', [req.params.id]);
    if (used.rows[0].n > 0) {
      // Promo sudah dipakai transaksi; nonaktifkan saja agar riwayat tetap utuh.
      const result = await pool.query(
        'UPDATE promotions SET is_active = FALSE WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!result.rows[0]) throw new HttpError(404, 'Promo tidak ditemukan');
      await logAudit(pool, { userId: req.user.id, action: 'deactivate', entity: 'promotions', entityId: Number(req.params.id) });
      return res.json({ message: 'Promo dinonaktifkan (sudah dipakai transaksi)' });
    }

    const result = await pool.query('DELETE FROM promotions WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Promo tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'promotions', entityId: Number(req.params.id) });
    res.json({ message: 'Promo dihapus' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

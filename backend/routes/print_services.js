const express = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const CATEGORIES = new Set(['fotokopi', 'print', 'scan', 'laminating', 'jilid', 'lainnya']);
const COLOR_MODES = new Set(['bw', 'color']);

// Ambil payload jasa; dipakai create & update agar aturan harga sama di dua jalur.
const readPayload = (body = {}) => {
  const name = requireString(body.name, 'Nama jasa', 150);
  if (name.error) throw new HttpError(400, name.error);

  const category = cleanString(body.category, 50);
  if (category && !CATEGORIES.has(category)) throw new HttpError(400, 'Kategori jasa tidak valid');

  const colorMode = cleanString(body.color_mode, 10);
  if (colorMode && !COLOR_MODES.has(colorMode)) throw new HttpError(400, 'Mode warna tidak valid');

  const readInt = (value, field, min = 0) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${field} tidak valid`);
    return n;
  };

  const pricePerPage = readInt(body.price_per_page ?? 0, 'Harga per halaman');
  const pricePerSheet = readInt(body.price_per_sheet ?? 0, 'Harga per lembar');
  const minQty = readInt(body.min_qty ?? 1, 'Min qty', 1);

  const bundlePriceRaw = body.bundle_price;
  const bundleQtyRaw = body.bundle_qty;
  const hasBundle = bundlePriceRaw !== undefined && bundlePriceRaw !== null && bundlePriceRaw !== ''
    && bundleQtyRaw !== undefined && bundleQtyRaw !== null && bundleQtyRaw !== '';
  let bundlePrice = null;
  let bundleQty = null;
  if (hasBundle) {
    bundlePrice = readInt(bundlePriceRaw, 'Harga paket', 1);
    bundleQty = readInt(bundleQtyRaw, 'Qty paket', 1);
  } else if (bundlePriceRaw || bundleQtyRaw) {
    throw new HttpError(400, 'Harga paket dan qty paket harus diisi bersamaan');
  }

  if (pricePerPage === 0 && pricePerSheet === 0 && !hasBundle) {
    throw new HttpError(400, 'Isi minimal satu harga (per halaman, per lembar, atau paket)');
  }

  return {
    name: name.value,
    category: category || null,
    paper_size: cleanString(body.paper_size, 20),
    color_mode: colorMode || null,
    price_per_page: pricePerPage,
    price_per_sheet: pricePerSheet,
    min_qty: minQty,
    bundle_price: bundlePrice,
    bundle_qty: bundleQty,
    is_active: toBool(body.is_active, true),
  };
};

router.get('/', requirePermission('print.use', 'print.manage'), async (req, res, next) => {
  try {
    const includeInactive = toBool(req.query.include_inactive, false);
    const result = await pool.query(
      `SELECT * FROM print_services
       WHERE business = $1 ${includeInactive ? '' : 'AND is_active = TRUE'}
       ORDER BY category NULLS LAST, name`,
      [req.business]
    );
    res.json(result.rows.map((r) => ({ ...r, price_per_page: Number(r.price_per_page), price_per_sheet: Number(r.price_per_sheet), bundle_price: r.bundle_price === null ? null : Number(r.bundle_price) })));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('print.manage'), async (req, res, next) => {
  try {
    const p = readPayload(req.body);
    const result = await pool.query(
      `INSERT INTO print_services
        (name, category, paper_size, color_mode, price_per_page, price_per_sheet,
         min_qty, bundle_price, bundle_qty, is_active, business)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [p.name, p.category, p.paper_size, p.color_mode, p.price_per_page, p.price_per_sheet,
        p.min_qty, p.bundle_price, p.bundle_qty, p.is_active, req.business]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'print_services', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('print.manage'), async (req, res, next) => {
  try {
    const p = readPayload(req.body);
    const result = await pool.query(
      `UPDATE print_services
       SET name = $1, category = $2, paper_size = $3, color_mode = $4,
           price_per_page = $5, price_per_sheet = $6, min_qty = $7,
           bundle_price = $8, bundle_qty = $9, is_active = $10
       WHERE id = $11 AND business = $12 RETURNING *`,
      [p.name, p.category, p.paper_size, p.color_mode, p.price_per_page, p.price_per_sheet,
        p.min_qty, p.bundle_price, p.bundle_qty, p.is_active, req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Jasa tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'print_services', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Hapus hanya bila belum pernah dipakai pesanan; kalau sudah, nonaktifkan saja.
router.delete('/:id', requirePermission('print.manage'), async (req, res, next) => {
  try {
    const owned = await pool.query(
      'SELECT id FROM print_services WHERE id = $1 AND business = $2',
      [req.params.id, req.business]
    );
    if (!owned.rows[0]) throw new HttpError(404, 'Jasa tidak ditemukan');

    const used = await pool.query(
      'SELECT COUNT(*)::int AS n FROM print_order_items WHERE service_id = $1',
      [req.params.id]
    );
    if (used.rows[0].n > 0) {
      throw new HttpError(409, 'Jasa sudah dipakai pesanan; nonaktifkan saja');
    }
    const result = await pool.query(
      'DELETE FROM print_services WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Jasa tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'print_services', entityId: Number(req.params.id) });
    res.json({ message: 'Jasa dihapus' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

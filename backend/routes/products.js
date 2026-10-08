const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { parseCsv, sendCsv } = require('../utils/csv');
const { imageUpload, uploadRoot, publicPath } = require('../utils/upload');
const { logAudit } = require('../utils/audit');
const { resolveItemsEffectivePricing } = require('../utils/item_pricing');

const router = express.Router();

const SELECT_PRODUCT = `
  SELECT p.*,
         c.name AS category_name,
         s.name AS supplier_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

const normalizeMoney = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Math.round(Number(String(value).replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) ? n : null;
};

const normalizeQty = (value) => {
  const n = Math.round(Number(String(value ?? '').replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) ? n : 0;
};

const validateProductBody = (body, { partial = false } = {}) => {
  const value = {};

  if (!partial || 'sku' in body) {
    const sku = requireString(body?.sku, 'SKU', 50);
    if (sku.error) return { error: sku.error };
    value.sku = sku.value;
  }

  if (!partial || 'name' in body) {
    const name = requireString(body?.name, 'Nama produk', 200);
    if (name.error) return { error: name.error };
    if (/[<>"']/.test(name.value)) return { error: 'Nama produk tidak boleh mengandung < > " \'' };
    value.name = name.value;
  }

  if (!partial || 'base_unit' in body) {
    const unit = requireString(body?.base_unit, 'Satuan dasar', 20);
    if (unit.error) return { error: unit.error };
    value.base_unit = unit.value.toLowerCase();
  }

  if (!partial || 'sell_price' in body) {
    const sellPrice = normalizeMoney(body?.sell_price);
    if (sellPrice === null || sellPrice < 0) return { error: 'Harga jual tidak valid' };
    value.sell_price = sellPrice;
  }

  if (!partial || 'cost_price' in body) {
    value.cost_price = normalizeMoney(body?.cost_price) ?? 0;
  }

  if ('barcode' in body) value.barcode = cleanString(body.barcode, 50);
  if ('member_price' in body) {
    const mp = normalizeMoney(body.member_price);
    value.member_price = mp === null || mp < 0 ? null : mp;
  }
  if ('min_stock' in body) value.min_stock = Math.max(0, normalizeQty(body.min_stock));
  if ('category_id' in body) {
    const cid = toInt(body.category_id, 0);
    value.category_id = cid > 0 ? cid : null;
  }
  if ('supplier_id' in body) {
    const sid = toInt(body.supplier_id, 0);
    value.supplier_id = sid > 0 ? sid : null;
  }
  if ('is_consignment' in body) value.is_consignment = toBool(body.is_consignment, false);
  if ('consignor_id' in body) {
    const cid = toInt(body.consignor_id, 0);
    value.consignor_id = cid > 0 ? cid : null;
  }
  // Penitip & konsinyasi harus konsisten: konsinyasi wajib punya penitip, non-konsinyasi tanpa penitip.
  if (value.is_consignment === true && value.consignor_id === null) {
    return { error: 'Penitip wajib dipilih untuk produk konsinyasi' };
  }
  if (value.is_consignment === false) value.consignor_id = null;
  if ('is_active' in body) value.is_active = toBool(body.is_active, true);

  return { value };
};

router.get('/', requirePermission('product.view'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const search = cleanString(req.query.search, 100);
    const categoryId = toInt(req.query.category_id, 0);
    const supplierId = toInt(req.query.supplier_id, 0);
    const lowStock = toBool(req.query.low_stock, false);
    const activeOnly = req.query.is_active === undefined ? true : toBool(req.query.is_active, true);

    // Produk dipisah per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ['p.business = $1'];
    const params = [req.business];

    if (activeOnly) conditions.push('p.is_active = TRUE');
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(p.name) LIKE $${params.length} OR LOWER(p.sku) LIKE $${params.length} OR LOWER(COALESCE(p.barcode, '')) LIKE $${params.length})`
      );
    }
    if (categoryId > 0) {
      params.push(categoryId);
      conditions.push(`p.category_id = $${params.length}`);
    }
    if (supplierId > 0) {
      params.push(supplierId);
      conditions.push(`p.supplier_id = $${params.length}`);
    }
    if (lowStock) conditions.push('p.stock_qty <= p.min_stock');

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products p ${where}`,
      params
    );

    params.push(limit, offset);
    const result = await pool.query(
      `${SELECT_PRODUCT} ${where} ORDER BY p.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// Cari berdasarkan barcode: tabel multibarcode -> barcode produk -> barcode satuan.
router.get('/barcode/:barcode', requirePermission('product.view'), async (req, res, next) => {
  try {
    const barcode = String(req.params.barcode || '').trim();
    if (!barcode) throw new HttpError(400, 'Barcode wajib diisi');

    let product = null;
    let matchedUnit = null;

    // 1) Barcode tambahan (product_barcodes). Bila unit_id terisi, satuan ikut dipakai.
    const extraResult = await pool.query(
      `SELECT pb.unit_id, pb.barcode, pb.product_id, pu.id AS unit_row_id, pu.product_id AS unit_product_id
       FROM product_barcodes pb
       LEFT JOIN product_units pu ON pu.id = pb.unit_id
       WHERE pb.barcode = $1`,
      [barcode]
    );
    if (extraResult.rows[0]) {
      const extra = extraResult.rows[0];
      const productId = extra.unit_id ? extra.unit_product_id : extra.product_id;
      const p = await pool.query(`${SELECT_PRODUCT} WHERE p.id = $1 AND p.is_active = TRUE AND p.business = $2`, [productId, req.business]);
      product = p.rows[0] || null;
      if (product && extra.unit_id) {
        const u = await pool.query('SELECT * FROM product_units WHERE id = $1', [extra.unit_id]);
        matchedUnit = u.rows[0] || null;
      }
    }

    // 2) Barcode utama produk.
    if (!product) {
      const productResult = await pool.query(
        `${SELECT_PRODUCT} WHERE p.barcode = $1 AND p.is_active = TRUE AND p.business = $2`,
        [barcode, req.business]
      );
      product = productResult.rows[0] || null;
    }

    // 3) Barcode satuan (kolom product_units.barcode).
    if (!product) {
      const unitResult = await pool.query(
        `SELECT pu.*, p.id AS product_id FROM product_units pu
         JOIN products p ON p.id = pu.product_id
         WHERE pu.barcode = $1 AND p.is_active = TRUE AND p.business = $2`,
        [barcode, req.business]
      );
      if (unitResult.rows[0]) {
        matchedUnit = unitResult.rows[0];
        const p = await pool.query(`${SELECT_PRODUCT} WHERE p.id = $1 AND p.business = $2`, [matchedUnit.product_id, req.business]);
        product = p.rows[0];
      }
    }

    if (!product) throw new HttpError(404, 'Produk tidak ditemukan');

    const units = await pool.query(
      'SELECT * FROM product_units WHERE product_id = $1 ORDER BY conversion_factor',
      [product.id]
    );

    res.json({ product, units: units.rows, matched_unit: matchedUnit });
  } catch (err) {
    next(err);
  }
});

// Pratinjau harga efektif (normal/member/tier/promo) untuk ditampilkan di POS.
// Server tetap menghitung ulang saat checkout; endpoint ini hanya untuk tampilan.
// Memakai resolver yang sama dengan checkout agar tidak terjadi penyimpangan harga.
const MAX_QUOTE_ITEMS = 200;
router.post('/quote', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length > MAX_QUOTE_ITEMS) {
      throw new HttpError(400, `item maksimal ${MAX_QUOTE_ITEMS}`);
    }

    // Validasi member di server (jangan percaya klien), sama seperti checkout.
    let memberId = toInt(req.body?.member_id, 0) || null;
    if (memberId) {
      const member = await pool.query(
        'SELECT id FROM members WHERE id = $1 AND is_active = TRUE AND business = $2',
        [memberId, req.business]
      );
      if (!member.rows[0]) memberId = null;
    }

    const priced = await resolveItemsEffectivePricing(pool, {
      items: items.map((raw) => ({
        product_id: toInt(raw?.product_id, 0),
        unit_id: toInt(raw?.unit_id, 0) || null,
        qty: Math.max(1, Math.round(Number(raw?.qty) || 1)),
      })),
      isMember: Boolean(memberId),
    });

    const quote = priced
      .filter((row) => row.product && !row.unitMissing)
      .map((row) => ({
        product_id: row.productId,
        unit_id: row.unitId,
        base_price: row.basePrice,
        effective_price: row.effectivePrice,
        promo_name: row.promoName,
        tier_min_qty: row.tierMinQty,
      }));

    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.get('/export', requirePermission('product.view'), async (req, res, next) => {
  try {
    const result = await pool.query(`${SELECT_PRODUCT} WHERE p.business = $1 ORDER BY p.name`, [req.business]);
    const rows = result.rows.map((p) => ({
      sku: p.sku,
      barcode: p.barcode || '',
      name: p.name,
      category: p.category_name || '',
      supplier: p.supplier_name || '',
      base_unit: p.base_unit,
      cost_price: p.cost_price,
      sell_price: p.sell_price,
      member_price: p.member_price ?? '',
      min_stock: p.min_stock,
      stock_qty: p.stock_qty,
      is_active: p.is_active,
    }));
    sendCsv(res, 'produk.csv', rows, [
      'sku', 'barcode', 'name', 'category', 'supplier', 'base_unit',
      'cost_price', 'sell_price', 'member_price', 'min_stock', 'stock_qty', 'is_active',
    ]);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('product.view'), async (req, res, next) => {
  try {
    const result = await pool.query(`${SELECT_PRODUCT} WHERE p.id = $1 AND p.business = $2`, [req.params.id, req.business]);
    if (!result.rows[0]) throw new HttpError(404, 'Produk tidak ditemukan');
    const units = await pool.query(
      'SELECT * FROM product_units WHERE product_id = $1 ORDER BY conversion_factor',
      [req.params.id]
    );
    res.json({ ...result.rows[0], units: units.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const { value, error } = validateProductBody(req.body || {});
    if (error) throw new HttpError(400, error);

    const result = await pool.query(
      `INSERT INTO products
        (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, is_consignment, consignor_id, business)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        value.sku, value.barcode || null, value.name, value.category_id || null,
        value.supplier_id || null, value.base_unit, value.cost_price ?? 0, value.sell_price,
        value.member_price ?? null, value.min_stock ?? 0, value.is_consignment ?? false,
        value.consignor_id || null, req.business,
      ]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'products', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const { value, error } = validateProductBody(req.body || {}, { partial: true });
    if (error) throw new HttpError(400, error);

    const keys = Object.keys(value);
    if (keys.length === 0) throw new HttpError(400, 'Tidak ada perubahan');

    // Cek konsistensi konsinyasi<->penitip pada state hasil merge (PUT parsial).
    if (value.is_consignment !== undefined || value.consignor_id !== undefined) {
      const current = await pool.query(
        'SELECT is_consignment, consignor_id FROM products WHERE id = $1 AND business = $2',
        [req.params.id, req.business]
      );
      if (!current.rows[0]) throw new HttpError(404, 'Produk tidak ditemukan');
      const nextConsignment = value.is_consignment !== undefined ? value.is_consignment : current.rows[0].is_consignment;
      const nextConsignor = value.consignor_id !== undefined ? value.consignor_id : current.rows[0].consignor_id;
      if (nextConsignment === true && (nextConsignor === null || nextConsignor === undefined)) {
        throw new HttpError(400, 'Penitip wajib dipilih untuk produk konsinyasi');
      }
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = keys.map((key) => (key === 'barcode' || key === 'member_price' ? value[key] ?? null : value[key]));

    values.push(req.params.id, req.business);
    const result = await pool.query(
      `UPDATE products SET ${setClause}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND business = $${values.length} RETURNING *`,
      values
    );
    if (!result.rows[0]) throw new HttpError(404, 'Produk tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'products', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Nonaktifkan produk (soft delete) agar riwayat transaksi tetap utuh.
router.delete('/:id', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Produk tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'deactivate', entity: 'products', entityId: Number(req.params.id) });
    res.json({ message: 'Produk dinonaktifkan' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/image', requirePermission('product.manage'), imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'File gambar wajib diunggah');

    const current = await pool.query(
      'SELECT image_path FROM products WHERE id = $1 AND business = $2',
      [req.params.id, req.business]
    );
    if (!current.rows[0]) {
      // Produk tak ada: hapus file yatim agar uploads tidak menumpuk.
      await fs.promises.unlink(req.file.path).catch(() => {});
      throw new HttpError(404, 'Produk tidak ditemukan');
    }

    if (current.rows[0].image_path) {
      const oldFile = path.join(uploadRoot, path.basename(current.rows[0].image_path));
      fs.promises.unlink(oldFile).catch(() => {});
    }

    const relative = publicPath(req.file.filename);
    const result = await pool.query(
      'UPDATE products SET image_path = $1, updated_at = NOW() WHERE id = $2 AND business = $3 RETURNING *',
      [relative, req.params.id, req.business]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Impor CSV (admin): JSON { csv } atau multipart field `csvFile`/text `csv`.
// (Field `file` dicadangkan untuk upload gambar — jangan pakai untuk CSV.)
// =========================================================
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const okType = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
    if (name.endsWith('.csv') || okType) return cb(null, true);
    return cb(new HttpError(400, 'File harus berformat CSV (.csv)'));
  },
}).single('csvFile');
router.post('/import', requirePermission('product.manage'), (req, res, next) => {
  if (req.is('multipart/form-data')) return csvUpload(req, res, (err) => (err ? next(err) : next()));
  return next();
}, async (req, res, next) => {
  try {
    let text = '';
    if (req.file) {
      text = String(req.file.buffer || '').replace(/^\uFEFF/, '');
    } else if (typeof req.body?.csv === 'string') {
      text = req.body.csv;
    } else {
      throw new HttpError(400, 'CSV wajib dikirim sebagai JSON { csv } atau multipart field csvFile');
    }

    const rows = parseCsv(text);
    if (rows.length === 0) throw new HttpError(400, 'CSV kosong atau tidak valid');

    const categories = await pool.query('SELECT id, name FROM categories WHERE business = $1', [req.business]);
    const suppliers = await pool.query('SELECT id, name FROM suppliers WHERE business = $1', [req.business]);
    const categoryMap = new Map(categories.rows.map((r) => [r.name.toLowerCase(), r.id]));
    const supplierMap = new Map(suppliers.rows.map((r) => [r.name.toLowerCase(), r.id]));

    const imported = [];
    const errors = [];
    const seenSku = new Set();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const line = i + 2;
      const sku = cleanString(row.sku, 50);
      const name = cleanString(row.name, 200);

      if (!sku || !name) {
        errors.push({ line, error: 'sku dan name wajib diisi' });
        continue;
      }
      if (seenSku.has(sku.toLowerCase())) {
        errors.push({ line, sku, error: 'SKU duplikat dalam file (baris terakhir menang bila diproses)' });
        continue;
      }
      seenSku.add(sku.toLowerCase());

      const sellPrice = normalizeMoney(row.sell_price);
      if (sellPrice === null || sellPrice < 0) {
        errors.push({ line, sku, error: 'sell_price tidak valid' });
        continue;
      }

      const categoryName = cleanString(row.category, 100);
      let categoryId = null;
      if (categoryName) {
        const key = categoryName.toLowerCase();
        if (!categoryMap.has(key)) {
          const inserted = await pool.query(
            'INSERT INTO categories (name, business) VALUES ($1, $2) ON CONFLICT (business, name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
            [categoryName, req.business]
          );
          categoryMap.set(key, inserted.rows[0].id);
        }
        categoryId = categoryMap.get(key);
      }

      const supplierName = cleanString(row.supplier, 150);
      let supplierId = null;
      if (supplierName) {
        const key = supplierName.toLowerCase();
        if (!supplierMap.has(key)) {
          // Tanpa unique (business,name): SELECT dulu lalu INSERT agar impor
          // ulang tak gandakan supplier.
          const existing = await pool.query(
            'SELECT id FROM suppliers WHERE business = $1 AND LOWER(name) = $2 LIMIT 1',
            [req.business, key]
          );
          if (existing.rows[0]) {
            supplierMap.set(key, existing.rows[0].id);
          } else {
            const inserted = await pool.query(
              'INSERT INTO suppliers (name, business) VALUES ($1, $2) RETURNING id',
              [supplierName, req.business]
            );
            supplierMap.set(key, inserted.rows[0].id);
          }
        }
        supplierId = supplierMap.get(key);
      }

      const stockQty = Math.max(0, normalizeQty(row.stock_qty));
      const costPrice = normalizeMoney(row.cost_price) ?? 0;
      const memberPrice = normalizeMoney(row.member_price);
      const minStock = Math.max(0, normalizeQty(row.min_stock));
      const barcode = cleanString(row.barcode, 50);
      const baseUnit = (cleanString(row.base_unit, 20) || 'pcs').toLowerCase();
      const isActive = row.is_active === undefined || row.is_active === ''
        ? true
        : toBool(row.is_active, true);

      try {
        const result = await pool.query(
          `INSERT INTO products
            (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty, is_active, business)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (sku) DO UPDATE SET
             barcode = EXCLUDED.barcode,
             name = EXCLUDED.name,
             category_id = EXCLUDED.category_id,
             supplier_id = EXCLUDED.supplier_id,
             base_unit = EXCLUDED.base_unit,
             cost_price = EXCLUDED.cost_price,
             sell_price = EXCLUDED.sell_price,
             member_price = EXCLUDED.member_price,
             min_stock = EXCLUDED.min_stock,
             is_active = EXCLUDED.is_active,
             updated_at = NOW()
           RETURNING id, sku, stock_qty`,
          [
            sku, barcode, name, categoryId, supplierId, baseUnit, costPrice,
            sellPrice, memberPrice, minStock, stockQty, isActive, req.business,
          ]
        );
        imported.push({ line, id: result.rows[0].id, sku: result.rows[0].sku });
      } catch (rowErr) {
        errors.push({ line, sku, error: rowErr.message });
      }
    }

    await logAudit(pool, {
      userId: req.user.id,
      action: 'import',
      entity: 'products',
      detail: { imported: imported.length, failed: errors.length },
    });

    res.json({ imported: imported.length, failed: errors.length, errors });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Satuan produk
// =========================================================
router.get('/:id/units', requirePermission('product.view'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      'SELECT * FROM product_units WHERE product_id = $1 ORDER BY conversion_factor',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/units', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const unitName = requireString(req.body?.unit_name, 'Nama satuan', 20);
    if (unitName.error) throw new HttpError(400, unitName.error);

    const factor = Math.round(Number(req.body?.conversion_factor));
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new HttpError(400, 'Faktor konversi harus bilangan bulat positif');
    }

    const sellPrice = normalizeMoney(req.body?.sell_price);
    if (sellPrice === null || sellPrice < 0) throw new HttpError(400, 'Harga jual satuan tidak valid');

    const memberPrice = normalizeMoney(req.body?.member_price);
    const barcode = cleanString(req.body?.barcode, 50);

    await assertProductExists(req.params.id, req.business);

    const result = await pool.query(
      `INSERT INTO product_units (product_id, unit_name, conversion_factor, sell_price, member_price, barcode)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, unitName.value.toLowerCase(), factor, sellPrice, memberPrice, barcode]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/units/:unitId', requirePermission('product.manage'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      'DELETE FROM product_units WHERE id = $1 AND product_id = $2 RETURNING id',
      [req.params.unitId, req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Satuan tidak ditemukan');
    res.json({ message: 'Satuan dihapus' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Barcode tambahan (multibarcode)
// =========================================================
// Pastikan produk ada (dan aktif). Dipakai sebelum operasi nested barcode/tier
// agar tidak bergantung pada error FK (yang muncul sebagai 500).
const assertProductExists = async (productId, business) => {
  const id = toInt(productId, 0);
  if (id <= 0) throw new HttpError(400, 'Produk tidak valid');
  const result = await pool.query(
    'SELECT id, is_active FROM products WHERE id = $1 AND business = $2',
    [id, business]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Produk tidak ditemukan');
  if (!result.rows[0].is_active) throw new HttpError(400, 'Produk tidak aktif');
  return result.rows[0];
};

// Pastikan barcode unik lintas ketiga sumber: products.barcode, product_units.barcode,
// product_barcodes.barcode (di luar baris `exceptBarcodeId` yang sedang diubah).
const assertBarcodeAvailable = async (barcode, { exceptBarcodeId = null } = {}) => {
  const conflict = await pool.query(
    `SELECT 'product' AS source FROM products WHERE barcode = $1
     UNION ALL
     SELECT 'unit' AS source FROM product_units WHERE barcode = $1
     UNION ALL
     SELECT 'extra' AS source FROM product_barcodes WHERE barcode = $1 AND id <> $2
     LIMIT 1`,
    [barcode, exceptBarcodeId || 0]
  );
  if (conflict.rows[0]) {
    throw new HttpError(409, `Barcode ${barcode} sudah dipakai (sumber: ${conflict.rows[0].source})`);
  }
};

router.get('/:id/barcodes', requirePermission('product.view'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      `SELECT pb.id, pb.barcode, pb.unit_id, pu.unit_name, pb.created_at
       FROM product_barcodes pb
       LEFT JOIN product_units pu ON pu.id = pb.unit_id
       WHERE pb.product_id = $1
       ORDER BY pb.id`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/barcodes', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const barcode = cleanString(req.body?.barcode, 50);
    if (!barcode) throw new HttpError(400, 'Barcode wajib diisi');

    const productId = toInt(req.params.id, 0);
    if (productId <= 0) throw new HttpError(400, 'Produk tidak valid');
    await assertProductExists(productId, req.business);

    let unitId = toInt(req.body?.unit_id, 0) || null;
    if (unitId) {
      const unit = await pool.query(
        'SELECT id FROM product_units WHERE id = $1 AND product_id = $2',
        [unitId, productId]
      );
      if (!unit.rows[0]) throw new HttpError(400, 'Satuan tidak sesuai dengan produk');
    }

    await assertBarcodeAvailable(barcode);

    const result = await pool.query(
      `INSERT INTO product_barcodes (product_id, barcode, unit_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [productId, barcode, unitId]
    );

    await logAudit(pool, {
      userId: req.user.id, action: 'create', entity: 'product_barcodes', entityId: result.rows[0].id,
      detail: { product_id: productId, barcode },
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/barcodes/:barcodeId', requirePermission('product.manage'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      'DELETE FROM product_barcodes WHERE id = $1 AND product_id = $2 RETURNING id',
      [req.params.barcodeId, req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Barcode tidak ditemukan');
    await logAudit(pool, {
      userId: req.user.id, action: 'delete', entity: 'product_barcodes', entityId: Number(req.params.barcodeId),
    });
    res.json({ message: 'Barcode dihapus' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Harga partai bertingkat (price_tiers)
// =========================================================
router.get('/:id/tiers', requirePermission('product.view'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      `SELECT pt.id, pt.unit_id, pu.unit_name, pt.min_qty, pt.price, pt.created_at
       FROM price_tiers pt
       LEFT JOIN product_units pu ON pu.id = pt.unit_id
       WHERE pt.product_id = $1
       ORDER BY pt.unit_id NULLS FIRST, pt.min_qty`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/tiers', requirePermission('product.manage'), async (req, res, next) => {
  try {
    const productId = toInt(req.params.id, 0);
    if (productId <= 0) throw new HttpError(400, 'Produk tidak valid');
    await assertProductExists(productId, req.business);

    const minQty = Math.round(Number(req.body?.min_qty));
    if (!Number.isFinite(minQty) || minQty <= 1) {
      throw new HttpError(400, 'min_qty harus lebih dari 1');
    }

    const price = normalizeMoney(req.body?.price);
    if (price === null || price < 0) throw new HttpError(400, 'Harga tier tidak valid');

    let unitId = toInt(req.body?.unit_id, 0) || null;
    if (unitId) {
      const unit = await pool.query(
        'SELECT id FROM product_units WHERE id = $1 AND product_id = $2',
        [unitId, productId]
      );
      if (!unit.rows[0]) throw new HttpError(400, 'Satuan tidak sesuai dengan produk');
    }

    const result = await pool.query(
      `INSERT INTO price_tiers (product_id, unit_id, min_qty, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, unit_id, min_qty) DO UPDATE SET price = EXCLUDED.price
       RETURNING *`,
      [productId, unitId, minQty, price]
    );

    await logAudit(pool, {
      userId: req.user.id, action: 'upsert', entity: 'price_tiers', entityId: result.rows[0].id,
      detail: { product_id: productId, unit_id: unitId, min_qty: minQty, price },
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/tiers/:tierId', requirePermission('product.manage'), async (req, res, next) => {
  try {
    await assertProductExists(req.params.id, req.business);
    const result = await pool.query(
      'DELETE FROM price_tiers WHERE id = $1 AND product_id = $2 RETURNING id',
      [req.params.tierId, req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Tier tidak ditemukan');
    await logAudit(pool, {
      userId: req.user.id, action: 'delete', entity: 'price_tiers', entityId: Number(req.params.tierId),
    });
    res.json({ message: 'Tier dihapus' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

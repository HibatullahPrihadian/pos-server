const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');
const {
  INTERNAL_PREFIX,
  isValidEan13,
  generateEan13,
  nextInternalBarcode,
  isBarcodeTaken,
} = require('../utils/barcode');
const bwipjs = require('bwip-js');

const router = express.Router();

router.use(verifyJwt);

// Render SVG EAN-13 memakai bwip-js. Mengembalikan string SVG.
const renderEan13Svg = (code) =>
  bwipjs.toSVG({
    bcid: 'ean13',
    text: code,
    scale: 3,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });

// Validasi barcode paket: kosong diizinkan; bila EAN-13 internal wajib check digit benar.
const validateBundleBarcode = async (runner, barcode, excludeId = null) => {
  if (!barcode) return;
  if (barcode.startsWith(INTERNAL_PREFIX)) {
    if (!isValidEan13(barcode)) {
      throw new HttpError(400, 'Barcode EAN-13 internal tidak valid (check digit salah)');
    }
  }
  if (await isBarcodeTaken(runner, barcode, excludeId)) {
    throw new HttpError(409, 'Barcode sudah dipakai paket lain');
  }
};

const SELECT_BUNDLE = `
  SELECT b.*,
         (SELECT COUNT(*)::int FROM bundle_items bi WHERE bi.bundle_id = b.id) AS item_count
  FROM bundles b
`;

const normalizeMoney = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Math.round(Number(String(value).replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) ? n : null;
};

// Validasi daftar komponen paket. Mengembalikan array { product_id, qty } unik.
const normalizeItems = (rawItems) => {
  const list = Array.isArray(rawItems) ? rawItems : [];
  if (list.length === 0) return { error: 'Komponen paket wajib diisi' };

  const byProduct = new Map();
  for (const raw of list) {
    const productId = toInt(raw?.product_id, 0);
    if (productId <= 0) return { error: 'product_id komponen tidak valid' };
    const qty = Math.round(Number(raw?.qty));
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'qty komponen harus bilangan bulat positif' };
    // Produk yang muncul dua kali digabung qty-nya agar UNIQUE (bundle_id, product_id) terjaga.
    byProduct.set(productId, (byProduct.get(productId) || 0) + qty);
  }
  return { items: [...byProduct.entries()].map(([productId, qty]) => ({ product_id: productId, qty })) };
};

// Pastikan semua produk komponen ada & aktif.
const assertComponentsExist = async (runner, items) => {
  const ids = items.map((i) => i.product_id);
  const found = await runner.query('SELECT id, name, is_active FROM products WHERE id = ANY($1::int[])', [ids]);
  const map = new Map(found.rows.map((r) => [r.id, r]));
  for (const item of items) {
    const product = map.get(item.product_id);
    if (!product) throw new HttpError(404, `Produk komponen #${item.product_id} tidak ditemukan`);
    if (!product.is_active) throw new HttpError(400, `Produk komponen ${product.name} tidak aktif`);
  }
};

// Ganti seluruh komponen paket (delete + insert) dalam satu transaksi.
const replaceItems = async (runner, bundleId, items) => {
  await runner.query('DELETE FROM bundle_items WHERE bundle_id = $1', [bundleId]);
  for (const item of items) {
    await runner.query(
      'INSERT INTO bundle_items (bundle_id, product_id, qty) VALUES ($1, $2, $3)',
      [bundleId, item.product_id, item.qty]
    );
  }
};

const loadItems = async (runner, bundleId) => {
  const result = await runner.query(
    `SELECT bi.id, bi.product_id, bi.qty, p.sku, p.name AS product_name, p.base_unit, p.stock_qty, p.cost_price
     FROM bundle_items bi
     JOIN products p ON p.id = bi.product_id
     WHERE bi.bundle_id = $1
     ORDER BY bi.id`,
    [bundleId]
  );
  return result.rows;
};

// =========================================================
// Barcode paket. Ditaruh sebelum /:id agar tidak tertangkap sebagai id.
// =========================================================

// Generate kode EAN-13 internal unik. Harus di atas /barcode/:barcode agar
// 'generate' tidak dibaca sebagai parameter :barcode.
router.get('/barcode/generate', requireRole('admin'), async (req, res, next) => {
  try {
    let barcode = await nextInternalBarcode(pool, INTERNAL_PREFIX);
    // Antisipasi bentrok (mis. barcode manual) dengan mencoba ulang beberapa kali.
    for (let attempt = 0; attempt < 5 && (await isBarcodeTaken(pool, barcode)); attempt += 1) {
      barcode = generateEan13(INTERNAL_PREFIX);
    }
    if (await isBarcodeTaken(pool, barcode)) {
      throw new HttpError(409, 'Gagal membuat barcode unik, coba lagi');
    }
    res.json({ barcode });
  } catch (err) {
    next(err);
  }
});

// Render SVG barcode satu paket (berdasarkan barcode tersimpan).
router.get('/:id/barcode.svg', requireRole('admin'), async (req, res, next) => {
  try {
    const id = toInt(req.params.id, 0);
    if (id <= 0) throw new HttpError(404, 'Paket tidak ditemukan');

    const result = await pool.query('SELECT barcode FROM bundles WHERE id = $1', [id]);
    const bundle = result.rows[0];
    if (!bundle) throw new HttpError(404, 'Paket tidak ditemukan');
    if (!bundle.barcode) throw new HttpError(404, 'Paket belum memiliki barcode');

    const svg = renderEan13Svg(bundle.barcode);
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    next(err);
  }
});

// Render batch SVG untuk banyak paket sekaligus (cetak label massal).
router.post('/barcodes/render', requireRole('admin'), async (req, res, next) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((id) => toInt(id, 0)).filter((id) => id > 0))];
    if (ids.length === 0) throw new HttpError(400, 'Pilih minimal satu paket');
    if (ids.length > 200) throw new HttpError(400, 'Maksimal 200 label per cetak');

    const result = await pool.query(
      `SELECT id, name, sku, barcode, price FROM bundles
       WHERE id = ANY($1::int[]) AND barcode IS NOT NULL AND barcode <> ''
       ORDER BY name`,
      [ids]
    );

    const items = result.rows.map((row) => {
      let svg = null;
      try {
        svg = renderEan13Svg(row.barcode);
      } catch {
        // Barcode non-EAN (mis. hasil scan pabrik) tidak bisa dirender EAN-13.
        svg = null;
      }
      return { id: row.id, name: row.name, sku: row.sku, code: row.barcode, price: Number(row.price), svg };
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/barcode/:barcode', async (req, res, next) => {
  try {
    const barcode = cleanString(req.params.barcode, 50);
    if (!barcode) throw new HttpError(400, 'Barcode wajib diisi');

    const result = await pool.query(`${SELECT_BUNDLE} WHERE b.barcode = $1 AND b.is_active = TRUE`, [barcode]);
    const bundle = result.rows[0];
    if (!bundle) throw new HttpError(404, 'Paket tidak ditemukan');

    const items = await loadItems(pool, bundle.id);
    res.json({ bundle, items });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const activeOnly = toBool(req.query.is_active, false);
    const where = activeOnly ? 'WHERE b.is_active = TRUE' : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM bundles b ${where}`);
    const result = await pool.query(
      `${SELECT_BUNDLE} ${where} ORDER BY b.is_active DESC, b.id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`${SELECT_BUNDLE} WHERE b.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');
    res.json({ ...result.rows[0], items: await loadItems(pool, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const sku = requireString(req.body?.sku, 'SKU', 50);
    if (sku.error) throw new HttpError(400, sku.error);
    const name = requireString(req.body?.name, 'Nama paket', 200);
    if (name.error) throw new HttpError(400, name.error);

    const price = normalizeMoney(req.body?.price);
    if (price === null || price < 0) throw new HttpError(400, 'Harga paket tidak valid');

    const barcode = cleanString(req.body?.barcode, 50);
    const isActive = toBool(req.body?.is_active, true);

    const { items, error } = normalizeItems(req.body?.items);
    if (error) throw new HttpError(400, error);

    const created = await withTransaction(async (client) => {
      await assertComponentsExist(client, items);
      await validateBundleBarcode(client, barcode);
      const result = await client.query(
        `INSERT INTO bundles (sku, name, barcode, price, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [sku.value, name.value, barcode, price, isActive]
      );
      await replaceItems(client, result.rows[0].id, items);
      return result.rows[0];
    });

    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'bundles', entityId: created.id });
    res.status(201).json({ ...created, items: await loadItems(pool, created.id) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT * FROM bundles WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');

    const value = {};
    if ('sku' in req.body) {
      const sku = requireString(req.body?.sku, 'SKU', 50);
      if (sku.error) throw new HttpError(400, sku.error);
      value.sku = sku.value;
    }
    if ('name' in req.body) {
      const name = requireString(req.body?.name, 'Nama paket', 200);
      if (name.error) throw new HttpError(400, name.error);
      value.name = name.value;
    }
    if ('price' in req.body) {
      const price = normalizeMoney(req.body?.price);
      if (price === null || price < 0) throw new HttpError(400, 'Harga paket tidak valid');
      value.price = price;
    }
    if ('barcode' in req.body) value.barcode = cleanString(req.body?.barcode, 50);
    if ('is_active' in req.body) value.is_active = toBool(req.body?.is_active, true);

    const hasItems = 'items' in req.body;
    let items = null;
    if (hasItems) {
      const normalized = normalizeItems(req.body?.items);
      if (normalized.error) throw new HttpError(400, normalized.error);
      items = normalized.items;
    }

    const keys = Object.keys(value);
    if (keys.length === 0 && !hasItems) throw new HttpError(400, 'Tidak ada perubahan');

    await withTransaction(async (client) => {
      if ('barcode' in value) await validateBundleBarcode(client, value.barcode, req.params.id);

      if (keys.length > 0) {
        const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
        const params = keys.map((key) => value[key]);
        params.push(req.params.id);
        await client.query(
          `UPDATE bundles SET ${setClause}, updated_at = NOW() WHERE id = $${params.length}`,
          params
        );
      } else {
        await client.query('UPDATE bundles SET updated_at = NOW() WHERE id = $1', [req.params.id]);
      }

      if (hasItems) {
        await assertComponentsExist(client, items);
        await replaceItems(client, req.params.id, items);
      }
    });

    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'bundles', entityId: Number(req.params.id) });
    const result = await pool.query(`${SELECT_BUNDLE} WHERE b.id = $1`, [req.params.id]);
    res.json({ ...result.rows[0], items: await loadItems(pool, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM sale_items WHERE bundle_id = $1', [req.params.id]);
    if (used.rows[0].n > 0) {
      // Paket sudah dipakai transaksi; nonaktifkan saja agar riwayat tetap utuh.
      const result = await pool.query(
        'UPDATE bundles SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!result.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');
      await logAudit(pool, { userId: req.user.id, action: 'deactivate', entity: 'bundles', entityId: Number(req.params.id) });
      return res.json({ message: 'Paket dinonaktifkan (sudah dipakai transaksi)' });
    }

    const result = await pool.query('DELETE FROM bundles WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'bundles', entityId: Number(req.params.id) });
    res.json({ message: 'Paket dihapus' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/items', async (req, res, next) => {
  try {
    const bundle = await pool.query('SELECT id FROM bundles WHERE id = $1', [req.params.id]);
    if (!bundle.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');
    res.json(await loadItems(pool, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/items', requireRole('admin'), async (req, res, next) => {
  try {
    const bundle = await pool.query('SELECT id FROM bundles WHERE id = $1', [req.params.id]);
    if (!bundle.rows[0]) throw new HttpError(404, 'Paket tidak ditemukan');

    const { items, error } = normalizeItems(req.body?.items);
    if (error) throw new HttpError(400, error);

    await withTransaction(async (client) => {
      await assertComponentsExist(client, items);
      await replaceItems(client, req.params.id, items);
      await client.query('UPDATE bundles SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    });

    await logAudit(pool, { userId: req.user.id, action: 'update_items', entity: 'bundles', entityId: Number(req.params.id) });
    res.json(await loadItems(pool, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

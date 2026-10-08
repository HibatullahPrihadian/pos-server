const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { applyStockMovement } = require('../utils/stock');
const { allocateFefo, addBatch, recordShortfall } = require('../utils/batches');
const { getSettings } = require('../utils/settings');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// =========================================================
// Kartu stok / mutasi
// =========================================================
router.get('/movements', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50 });
    const productId = toInt(req.query.product_id, 0);
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const type = cleanString(req.query.type, 20);

    // Mutasi stok dipisah per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ['sm.business = $1'];
    const params = [req.business];

    if (productId > 0) {
      params.push(productId);
      conditions.push(`sm.product_id = $${params.length}`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`sm.created_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`sm.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (type) {
      params.push(type);
      conditions.push(`sm.type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM stock_movements sm ${where}`,
      params
    );
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT sm.*, p.sku, p.name AS product_name, u.full_name AS user_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN users u ON u.id = sm.user_id
       ${where}
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/low', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.sku, p.name, p.base_unit, p.stock_qty, p.min_stock,
              c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.business = $1 AND p.is_active = TRUE AND p.stock_qty <= p.min_stock
       ORDER BY (p.stock_qty - p.min_stock), p.name`,
      [req.business]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Batch & kadaluarsa
// =========================================================
// Daftar batch dengan filter produk/hari-kadaluarsa.
router.get('/batches', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50 });
    const productId = toInt(req.query.product_id, 0);
    const withinDays = toInt(req.query.expiring_within_days, 0);
    const includeExpired = req.query.include_expired === 'true' || req.query.include_expired === '1';
    const onlyAvailable = req.query.only_available !== 'false';

    const conditions = ['p.business = $1'];
    const params = [req.business];
    if (productId > 0) {
      params.push(productId);
      conditions.push(`sb.product_id = $${params.length}`);
    }
    if (onlyAvailable) conditions.push('sb.qty_remaining > 0');
    if (withinDays > 0) {
      params.push(withinDays);
      conditions.push(`sb.expiry_date IS NOT NULL AND sb.expiry_date <= CURRENT_DATE + $${params.length}::int`);
      if (!includeExpired) {
        conditions.push('sb.expiry_date >= CURRENT_DATE');
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM stock_batches sb JOIN products p ON p.id = sb.product_id ${where}`,
      params
    );
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT sb.*, p.sku, p.name AS product_name, p.base_unit,
              (sb.expiry_date IS NOT NULL AND sb.expiry_date < CURRENT_DATE) AS is_expired,
              (sb.expiry_date IS NOT NULL AND sb.expiry_date >= CURRENT_DATE
                AND sb.expiry_date <= CURRENT_DATE + COALESCE(ss.expiry_warning_days, 180)) AS is_expiring
       FROM stock_batches sb
       JOIN products p ON p.id = sb.product_id
       LEFT JOIN store_settings ss ON ss.id = 1
       ${where}
       ORDER BY sb.expiry_date NULLS LAST, sb.received_at DESC, sb.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// Batch yang kadaluarsa dalam ambang peringatan (untuk dashboard).
router.get('/expiring', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const warningDays = toInt(req.query.within_days, 0) || settings?.expiry_warning_days || 180;

    const result = await pool.query(
      `SELECT sb.id, sb.product_id, sb.batch_code, sb.expiry_date, sb.qty_remaining,
              sb.unit_cost, p.sku, p.name AS product_name, p.base_unit, c.name AS category_name,
              (sb.expiry_date < CURRENT_DATE) AS is_expired,
              (sb.expiry_date - CURRENT_DATE) AS days_left
       FROM stock_batches sb
       JOIN products p ON p.id = sb.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.business = $2
         AND sb.qty_remaining > 0
         AND sb.expiry_date IS NOT NULL
         AND sb.expiry_date >= CURRENT_DATE - INTERVAL '365 days'
         AND sb.expiry_date <= CURRENT_DATE + $1::int
       ORDER BY sb.expiry_date, p.name
       LIMIT 200`,
      [warningDays, req.business]
    );

    const expired = result.rows.filter((r) => r.is_expired);
    const expiring = result.rows.filter((r) => !r.is_expired);
    res.json({ warning_days: warningDays, expiring, expired });
  } catch (err) {
    next(err);
  }
});

// Koreksi manual expiry/batch_code (admin).
router.put('/batches/:id', requirePermission('stock.manage'), async (req, res, next) => {
  try {
    const batchId = toInt(req.params.id, 0);
    if (batchId <= 0) throw new HttpError(400, 'ID batch tidak valid');

    const updates = [];
    const params = [];
    if ('expiry_date' in (req.body || {})) {
      const expiry = cleanString(req.body.expiry_date, 10);
      if (expiry && !isValidDate(expiry)) throw new HttpError(400, 'Format expiry_date harus YYYY-MM-DD');
      params.push(expiry || null);
      updates.push(`expiry_date = $${params.length}`);
    }
    if ('batch_code' in (req.body || {})) {
      params.push(cleanString(req.body.batch_code, 60));
      updates.push(`batch_code = $${params.length}`);
    }
    if (updates.length === 0) throw new HttpError(400, 'Tidak ada perubahan');

    params.push(batchId, req.business);
    const result = await pool.query(
      `UPDATE stock_batches sb SET ${updates.join(', ')}
       WHERE sb.id = $${params.length - 1}
         AND EXISTS (
           SELECT 1 FROM products p WHERE p.id = sb.product_id AND p.business = $${params.length}
         )
       RETURNING sb.*`,
      params
    );
    if (!result.rows[0]) throw new HttpError(404, 'Batch tidak ditemukan');

    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'stock_batches',
      entityId: batchId,
      detail: { expiry_date: req.body?.expiry_date, batch_code: req.body?.batch_code },
    });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Penyesuaian stok manual (admin)
// =========================================================
router.post('/adjustments', requirePermission('stock.manage'), async (req, res, next) => {
  try {
    const productId = toInt(req.body?.product_id, 0);
    if (productId <= 0) throw new HttpError(400, 'product_id wajib diisi');

    const qtyChange = Math.round(Number(req.body?.qty_change));
    if (!Number.isFinite(qtyChange) || qtyChange === 0) {
      throw new HttpError(400, 'qty_change harus bilangan bulat bukan nol');
    }
    const note = cleanString(req.body?.note, 300);
    const expiryDate = cleanString(req.body?.expiry_date, 10);
    if (expiryDate && !isValidDate(expiryDate)) {
      throw new HttpError(400, 'Format expiry_date harus YYYY-MM-DD');
    }

    const settings = await getSettings();
    const result = await withTransaction(async (client) => {
      const movement = await applyStockMovement(client, {
        productId,
        qtyChange,
        type: 'adjustment',
        refType: 'manual',
        note,
        userId: req.user.id,
        business: req.business,
        allowNegative: settings?.allow_negative_stock === true,
      });

      // Sinkronkan batch: positif -> batch baru; negatif -> konsumsi FEFO.
      if (qtyChange > 0) {
        await addBatch(client, {
          productId,
          qtyBase: qtyChange,
          unitCost: movement.previousCost,
          expiryDate: expiryDate || null,
          source: 'adjustment',
          note: note || 'Penyesuaian stok',
        });
      } else {
        const allocations = await allocateFefo(client, {
          productId,
          qtyBase: -qtyChange,
          allowShortfall: true,
          allowExpired: true,
        });
        const allocatedQty = allocations.reduce((sum, a) => sum + a.qty, 0);
        if (allocatedQty < -qtyChange) {
          await recordShortfall(client, {
            productId,
            qtyShortfall: -qtyChange - allocatedQty,
            unitCost: movement.previousCost,
            note: note || 'Stok minus penyesuaian',
          });
        }
      }
      return movement;
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'adjust',
      entity: 'stock',
      entityId: productId,
      detail: { qty_change: qtyChange, balance_after: result.balance },
    });

    res.json({ product_id: productId, qty_change: qtyChange, balance_after: result.balance });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Stok opname
// =========================================================
router.get('/opnames', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const status = cleanString(req.query.status, 10);

    const params = [req.business];
    let where = 'WHERE so.business = $1';
    if (status === 'draft' || status === 'posted') {
      params.push(status);
      where += ` AND so.status = $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM stock_opnames so ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT so.*, u.full_name AS user_name,
              (SELECT COUNT(*)::int FROM stock_opname_items i WHERE i.opname_id = so.id) AS item_count
       FROM stock_opnames so
       LEFT JOIN users u ON u.id = so.user_id
       ${where}
       ORDER BY so.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/opnames/:id', requirePermission('stock.view'), async (req, res, next) => {
  try {
    const opname = await pool.query(
      `SELECT so.*, u.full_name AS user_name FROM stock_opnames so
       LEFT JOIN users u ON u.id = so.user_id WHERE so.id = $1 AND so.business = $2`,
      [req.params.id, req.business]
    );
    if (!opname.rows[0]) throw new HttpError(404, 'Opname tidak ditemukan');

    const items = await pool.query(
      `SELECT i.*, p.sku, p.name AS product_name, p.base_unit
       FROM stock_opname_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.opname_id = $1
       ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ ...opname.rows[0], items: items.rows });
  } catch (err) {
    next(err);
  }
});

// Buat opname draft. Bila items tidak dikirim, ambil semua produk aktif
// dengan counted_qty = system_qty (kasir mengisi hitungan fisik menyusul).
router.post('/opnames', requirePermission('stock.manage'), async (req, res, next) => {
  try {
    const date = cleanString(req.body?.date, 10);
    if (date && !isValidDate(date)) throw new HttpError(400, 'Format tanggal harus YYYY-MM-DD');
    const note = cleanString(req.body?.note, 500);

    const inputItems = Array.isArray(req.body?.items) ? req.body.items : null;

    const created = await withTransaction(async (client) => {
      const code = await nextDocNumber(client, 'OPN');
      const opnameResult = await client.query(
        `INSERT INTO stock_opnames (code, date, user_id, note, business)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5) RETURNING *`,
        [code, date || null, req.user.id, note, req.business]
      );
      const opname = opnameResult.rows[0];

      if (inputItems && inputItems.length > 0) {
        for (const item of inputItems) {
          const productId = toInt(item.product_id, 0);
          if (productId <= 0) continue;
          const counted = Math.max(0, Math.round(Number(item.counted_qty) || 0));
          const product = await client.query('SELECT stock_qty FROM products WHERE id = $1 AND business = $2', [productId, req.business]);
          if (!product.rows[0]) continue;
          const systemQty = product.rows[0].stock_qty;
          await client.query(
            `INSERT INTO stock_opname_items (opname_id, product_id, system_qty, counted_qty, diff)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (opname_id, product_id) DO UPDATE
               SET counted_qty = EXCLUDED.counted_qty, diff = EXCLUDED.counted_qty - stock_opname_items.system_qty`,
            [opname.id, productId, systemQty, counted, counted - systemQty]
          );
        }
      } else {
        await client.query(
          `INSERT INTO stock_opname_items (opname_id, product_id, system_qty, counted_qty, diff)
           SELECT $1, p.id, p.stock_qty, p.stock_qty, 0 FROM products p
           WHERE p.business = $2 AND p.is_active = TRUE`,
          [opname.id, req.business]
        );
      }

      return opname;
    });

    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'stock_opnames', entityId: created.id });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Update item hitungan pada opname draft.
router.put('/opnames/:id/items', requirePermission('stock.manage'), async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) throw new HttpError(400, 'items wajib diisi');

    const opname = await pool.query('SELECT id, status FROM stock_opnames WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    if (!opname.rows[0]) throw new HttpError(404, 'Opname tidak ditemukan');
    if (opname.rows[0].status === 'posted') throw new HttpError(400, 'Opname sudah diposting');

    await withTransaction(async (client) => {
      for (const item of items) {
        const productId = toInt(item.product_id, 0);
        if (productId <= 0) continue;
        const counted = Math.max(0, Math.round(Number(item.counted_qty) || 0));
        await client.query(
          `UPDATE stock_opname_items
           SET counted_qty = $1, diff = $1 - system_qty
           WHERE opname_id = $2 AND product_id = $3`,
          [counted, req.params.id, productId]
        );
      }
    });

    res.json({ message: 'Item opname diperbarui' });
  } catch (err) {
    next(err);
  }
});

// Posting opname: terapkan selisih ke stok sebagai mutasi 'opname'.
router.post('/opnames/:id/post', requirePermission('stock.manage'), async (req, res, next) => {
  try {
    const settings = await getSettings();

    const result = await withTransaction(async (client) => {
      const opnameResult = await client.query(
        'SELECT * FROM stock_opnames WHERE id = $1 AND business = $2 FOR UPDATE',
        [req.params.id, req.business]
      );
      const opname = opnameResult.rows[0];
      if (!opname) throw new HttpError(404, 'Opname tidak ditemukan');
      if (opname.status === 'posted') throw new HttpError(400, 'Opname sudah diposting');

      const itemsResult = await client.query(
        'SELECT * FROM stock_opname_items WHERE opname_id = $1',
        [opname.id]
      );

      let adjusted = 0;
      for (const item of itemsResult.rows) {
        const locked = await client.query(
          'SELECT stock_qty, cost_price FROM products WHERE id = $1 FOR UPDATE',
          [item.product_id]
        );
        const currentQty = locked.rows[0]?.stock_qty ?? item.system_qty;
        const costPrice = Number(locked.rows[0]?.cost_price || 0);
        const diff = item.counted_qty - currentQty;
        if (diff === 0) continue;

        await applyStockMovement(client, {
          productId: item.product_id,
          qtyChange: diff,
          type: 'opname',
          refType: 'stock_opname',
          refId: opname.id,
          note: `Opname ${opname.code}`,
          userId: req.user.id,
          business: req.business,
          allowNegative: true,
        });

        // Sinkronkan batch dengan selisih opname. Selisih positif memakai HPP
        // produk saat ini agar COGS penjualan berikutnya tidak nol.
        if (diff > 0) {
          await addBatch(client, {
            productId: item.product_id,
            qtyBase: diff,
            unitCost: costPrice,
            expiryDate: null,
            source: 'opname',
            note: `Opname ${opname.code}`,
          });
        } else {
          const allocations = await allocateFefo(client, {
            productId: item.product_id,
            qtyBase: -diff,
            allowShortfall: true,
            allowExpired: true,
          });
          const allocatedQty = allocations.reduce((sum, a) => sum + a.qty, 0);
          if (allocatedQty < -diff) {
            await recordShortfall(client, {
              productId: item.product_id,
              qtyShortfall: -diff - allocatedQty,
              unitCost: costPrice,
              note: `Stok minus opname ${opname.code}`,
            });
          }
        }

        await client.query('UPDATE stock_opname_items SET diff = $1 WHERE id = $2', [diff, item.id]);
        adjusted += 1;
      }

      await client.query(
        `UPDATE stock_opnames SET status = 'posted', posted_at = NOW() WHERE id = $1`,
        [opname.id]
      );

      return { code: opname.code, adjusted };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'post',
      entity: 'stock_opnames',
      entityId: Number(req.params.id),
      detail: result,
    });

    res.json({ message: 'Opname diposting', ...result, allow_negative_stock: settings?.allow_negative_stock });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

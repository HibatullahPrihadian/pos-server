const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { applyStockMovement } = require('../utils/stock');
const { addBatch } = require('../utils/batches');
const { movingAverageCost } = require('../utils/money');
const { getSettings } = require('../utils/settings');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const PO_SELECT = `
  SELECT pu.*, s.name AS supplier_name, u.full_name AS user_name
  FROM purchases pu
  LEFT JOIN suppliers s ON s.id = pu.supplier_id
  LEFT JOIN users u ON u.id = pu.user_id
`;

// Validasi & normalisasi item PO. Mengembalikan array item siap insert.
const buildItems = async (client, rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Item pembelian wajib diisi');
  }

  const items = [];
  for (const raw of rawItems) {
    const productId = toInt(raw.product_id, 0);
    if (productId <= 0) throw new HttpError(400, 'product_id tidak valid');

    const qty = Math.round(Number(raw.qty));
    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty harus bilangan bulat positif');

    const unitCost = Math.round(Number(raw.unit_cost));
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new HttpError(400, 'unit_cost tidak valid');

    const unitId = toInt(raw.unit_id, 0) || null;

    let conversionFactor = 1;
    if (unitId) {
      const unit = await client.query(
        'SELECT conversion_factor FROM product_units WHERE id = $1 AND product_id = $2',
        [unitId, productId]
      );
      if (!unit.rows[0]) throw new HttpError(400, 'Satuan produk tidak ditemukan');
      conversionFactor = unit.rows[0].conversion_factor;
    }

    const baseQty = qty * conversionFactor;
    items.push({
      product_id: productId,
      unit_id: unitId,
      qty,
      base_qty: baseQty,
      unit_cost: unitCost,
      line_total: qty * unitCost,
      base_unit_cost: Math.round(unitCost / conversionFactor),
    });
  }
  return items;
};

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const status = cleanString(req.query.status, 20);
    const supplierId = toInt(req.query.supplier_id, 0);
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);

    const conditions = [];
    const params = [];
    if (status) {
      params.push(status);
      conditions.push(`pu.status = $${params.length}`);
    }
    if (supplierId > 0) {
      params.push(supplierId);
      conditions.push(`pu.supplier_id = $${params.length}`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`pu.date >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`pu.date <= $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM purchases pu ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${PO_SELECT} ${where} ORDER BY pu.date DESC, pu.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`${PO_SELECT} WHERE pu.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Pembelian tidak ditemukan');

    const items = await pool.query(
      `SELECT pi.*, p.sku, p.name AS product_name, p.base_unit, pu2.unit_name
       FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id
       LEFT JOIN product_units pu2 ON pu2.id = pi.unit_id
       WHERE pi.purchase_id = $1
       ORDER BY pi.id`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], items: items.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const supplierId = toInt(req.body?.supplier_id, 0) || null;
    const invoiceNo = cleanString(req.body?.invoice_no, 80);
    const date = cleanString(req.body?.date, 10);
    if (date && !isValidDate(date)) throw new HttpError(400, 'Format tanggal harus YYYY-MM-DD');
    const note = cleanString(req.body?.note, 500);
    const status = ['draft', 'ordered'].includes(req.body?.status) ? req.body.status : 'draft';

    const created = await withTransaction(async (client) => {
      const items = await buildItems(client, req.body?.items);
      const total = items.reduce((sum, item) => sum + item.line_total, 0);
      const code = await nextDocNumber(client, 'PO');

      const result = await client.query(
        `INSERT INTO purchases (code, supplier_id, invoice_no, date, status, total, note, user_id)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8) RETURNING *`,
        [code, supplierId, invoiceNo, date || null, status, total, note, req.user.id]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_items (purchase_id, product_id, unit_id, qty, base_qty, unit_cost, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [result.rows[0].id, item.product_id, item.unit_id, item.qty, item.base_qty, item.unit_cost, item.line_total]
        );
      }

      return result.rows[0];
    });

    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'purchases', entityId: created.id });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT * FROM purchases WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Pembelian tidak ditemukan');
    if (!['draft', 'ordered'].includes(existing.rows[0].status)) {
      throw new HttpError(400, 'Hanya PO draft/ordered yang dapat diubah');
    }

    const supplierId = toInt(req.body?.supplier_id, 0) || null;
    const invoiceNo = cleanString(req.body?.invoice_no, 80);
    const date = cleanString(req.body?.date, 10);
    if (date && !isValidDate(date)) throw new HttpError(400, 'Format tanggal harus YYYY-MM-DD');
    const note = cleanString(req.body?.note, 500);
    const status = ['draft', 'ordered'].includes(req.body?.status) ? req.body.status : existing.rows[0].status;

    const updated = await withTransaction(async (client) => {
      const items = await buildItems(client, req.body?.items);
      const total = items.reduce((sum, item) => sum + item.line_total, 0);

      await client.query(
        `UPDATE purchases SET supplier_id = $1, invoice_no = $2, date = COALESCE($3::date, date),
           status = $4, total = $5, note = $6 WHERE id = $7`,
        [supplierId, invoiceNo, date || null, status, total, note, req.params.id]
      );

      await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [req.params.id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_items (purchase_id, product_id, unit_id, qty, base_qty, unit_cost, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, item.product_id, item.unit_id, item.qty, item.base_qty, item.unit_cost, item.line_total]
        );
      }

      const result = await client.query('SELECT * FROM purchases WHERE id = $1', [req.params.id]);
      return result.rows[0];
    });

    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'purchases', entityId: Number(req.params.id) });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Penerimaan barang: tambah stok + update HPP moving average.
// items: [{ purchase_item_id, received_qty }]; bila kosong, terima semua sisa.
router.post('/:id/receive', requireRole('admin'), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const allowNegative = settings?.allow_negative_stock === true;

    const result = await withTransaction(async (client) => {
      const poResult = await client.query('SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [req.params.id]);
      const po = poResult.rows[0];
      if (!po) throw new HttpError(404, 'Pembelian tidak ditemukan');
      if (po.status === 'cancelled') throw new HttpError(400, 'PO sudah dibatalkan');
      if (po.status === 'received') throw new HttpError(400, 'PO sudah diterima penuh');

      const itemsResult = await client.query(
        'SELECT * FROM purchase_items WHERE purchase_id = $1 ORDER BY id',
        [po.id]
      );

      const input = Array.isArray(req.body?.items) ? req.body.items : null;
      const requested = new Map();
      const itemMeta = new Map();
      if (input) {
        input.forEach((row) => {
          const itemId = toInt(row.purchase_item_id, 0);
          const qty = Math.round(Number(row.received_qty) || 0);
          if (itemId <= 0) return;
          if (qty > 0) requested.set(itemId, qty);
          const expiry = cleanString(row.expiry_date, 10);
          if (expiry && !isValidDate(expiry)) {
            throw new HttpError(400, 'Format expiry_date harus YYYY-MM-DD');
          }
          itemMeta.set(itemId, {
            expiry_date: expiry || null,
            batch_code: cleanString(row.batch_code, 60),
          });
        });
      }

      let anyReceived = false;
      let allReceived = true;

      for (const item of itemsResult.rows) {
        const remaining = item.qty - item.received_qty;
        let receiveQty = requested.has(item.id) ? requested.get(item.id) : remaining;

        if (receiveQty > remaining) {
          throw new HttpError(400, `Jumlah terima melebihi sisa pesanan (sisa ${remaining})`);
        }
        if (receiveQty <= 0) {
          if (remaining > 0) allReceived = false;
          continue;
        }

        const conversion = item.base_qty / item.qty;
        const baseReceiveQty = Math.round(receiveQty * conversion);
        const baseUnitCost = Math.round(item.unit_cost / conversion);

        const product = await client.query(
          'SELECT stock_qty, cost_price FROM products WHERE id = $1 FOR UPDATE',
          [item.product_id]
        );
        if (!product.rows[0]) throw new HttpError(404, 'Produk pada PO tidak ditemukan');

        const newCost = movingAverageCost(
          product.rows[0].stock_qty,
          product.rows[0].cost_price,
          baseReceiveQty,
          baseUnitCost
        );

        await applyStockMovement(client, {
          productId: item.product_id,
          qtyChange: baseReceiveQty,
          type: 'purchase',
          refType: 'purchase',
          refId: po.id,
          unitCost: baseUnitCost,
          note: `Penerimaan ${po.code}`,
          userId: req.user.id,
          allowNegative,
          newCostPrice: newCost,
        });

        // Buat batch baru untuk penerimaan ini (expiry opsional dari input).
        const meta = itemMeta.get(item.id) || {};
        await addBatch(client, {
          productId: item.product_id,
          qtyBase: baseReceiveQty,
          unitCost: baseUnitCost,
          expiryDate: meta.expiry_date || null,
          batchCode: meta.batch_code || null,
          source: 'purchase',
          purchaseItemId: item.id,
          note: `Penerimaan ${po.code}`,
        });

        await client.query(
          'UPDATE purchase_items SET received_qty = received_qty + $1 WHERE id = $2',
          [receiveQty, item.id]
        );

        anyReceived = true;
        if (item.received_qty + receiveQty < item.qty) allReceived = false;
      }

      if (!anyReceived) throw new HttpError(400, 'Tidak ada barang yang diterima');

      const newStatus = allReceived ? 'received' : 'partial';
      const updated = await client.query(
        `UPDATE purchases SET status = $1, received_at = NOW() WHERE id = $2 RETURNING *`,
        [newStatus, po.id]
      );

      return updated.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'receive',
      entity: 'purchases',
      entityId: Number(req.params.id),
      detail: { status: result.status },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Pembayaran sederhana ke supplier (belum_lunas -> lunas), tanpa ledger hutang penuh.
router.post('/:id/payment', requireRole('admin'), async (req, res, next) => {
  try {
    const amount = Math.round(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah bayar tidak valid');

    const result = await withTransaction(async (client) => {
      const poResult = await client.query('SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [req.params.id]);
      const po = poResult.rows[0];
      if (!po) throw new HttpError(404, 'Pembelian tidak ditemukan');
      if (po.status === 'cancelled') throw new HttpError(400, 'PO sudah dibatalkan');

      const newPaid = Number(po.paid_amount) + amount;
      const paymentStatus = newPaid >= Number(po.total) ? 'paid' : 'unpaid';

      const updated = await client.query(
        'UPDATE purchases SET paid_amount = $1, payment_status = $2 WHERE id = $3 RETURNING *',
        [newPaid, paymentStatus, po.id]
      );
      return updated.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'payment',
      entity: 'purchases',
      entityId: Number(req.params.id),
      detail: { amount },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE purchases SET status = 'cancelled'
       WHERE id = $1 AND status IN ('draft', 'ordered') RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(400, 'PO tidak dapat dibatalkan (sudah ada penerimaan)');
    await logAudit(pool, {
      userId: req.user.id,
      action: 'cancel',
      entity: 'purchases',
      entityId: Number(req.params.id),
    });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

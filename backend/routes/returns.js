const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { applyStockMovement } = require('../utils/stock');
const { restoreSaleItemBatches } = require('../utils/batches');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

const RETURN_SELECT = `
  SELECT r.*, s.invoice_no, u.full_name AS user_name
  FROM returns r
  LEFT JOIN sales s ON s.id = r.sale_id
  LEFT JOIN users u ON u.id = r.user_id
`;

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const saleId = toInt(req.query.sale_id, 0);

    const conditions = [];
    const params = [];
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`r.created_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`r.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (saleId > 0) {
      params.push(saleId);
      conditions.push(`r.sale_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM returns r ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${RETURN_SELECT} ${where} ORDER BY r.created_at DESC
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
    const result = await pool.query(`${RETURN_SELECT} WHERE r.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Retur tidak ditemukan');

    const items = await pool.query(
      `SELECT ri.*, p.sku, p.name AS product_name,
              b.name AS bundle_name, b.sku AS bundle_sku,
              COALESCE(p.name, b.name) AS display_name
       FROM return_items ri
       LEFT JOIN products p ON p.id = ri.product_id
       LEFT JOIN bundles b ON b.id = ri.bundle_id
       WHERE ri.return_id = $1 ORDER BY ri.id`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], items: items.rows });
  } catch (err) {
    next(err);
  }
});

// Retur per item dari struk. Mengembalikan stok dengan HPP asli (cost_price saat jual).
router.post('/', async (req, res, next) => {
  try {
    const saleId = toInt(req.body?.sale_id, 0);
    if (saleId <= 0) throw new HttpError(400, 'sale_id wajib diisi');

    const refundMethod = req.body?.refund_method === 'transfer' ? 'transfer' : 'cash';
    const reason = cleanString(req.body?.reason, 300);
    const shiftId = toInt(req.body?.shift_id, 0) || null;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) throw new HttpError(400, 'Item retur wajib diisi');

    const created = await withTransaction(async (client) => {
      const saleResult = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
      const sale = saleResult.rows[0];
      if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan');
      if (sale.status !== 'completed') throw new HttpError(400, 'Transaksi void tidak dapat diretur');

      const code = await nextDocNumber(client, 'RET');
      let total = 0;
      const prepared = [];

      for (const raw of items) {
        const saleItemId = toInt(raw?.sale_item_id, 0);
        if (saleItemId <= 0) throw new HttpError(400, 'sale_item_id tidak valid');

        const qty = Math.round(Number(raw?.qty));
        if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty retur harus bilangan bulat positif');

        const itemResult = await client.query(
          'SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2',
          [saleItemId, saleId]
        );
        const item = itemResult.rows[0];
        if (!item) throw new HttpError(404, 'Item transaksi tidak ditemukan');

        const remaining = item.qty - item.returned_qty;
        if (qty > remaining) {
          throw new HttpError(400, `Qty retur melebihi sisa (sisa ${remaining})`);
        }

        // Refund proporsional terhadap line_total setelah diskon item.
        // Saat unit terakhir diretur, sisa nilai dikembalikan penuh agar tidak ada selisih pembulatan.
        const priorRefundResult = await client.query(
          'SELECT COALESCE(SUM(refund_amount), 0)::bigint AS prior FROM return_items WHERE sale_item_id = $1',
          [item.id]
        );
        const priorRefund = Number(priorRefundResult.rows[0].prior);
        const netPerUnit = Math.floor(item.line_total / item.qty);

        const isFinal = qty === remaining;
        const refund = isFinal
          ? Math.max(0, item.line_total - priorRefund)
          : netPerUnit * qty;

        prepared.push({ item, qty, refund });
        total += refund;
      }

      const shift = shiftId
        ? (await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId])).rows[0]
        : null;
      if (shiftId && !shift) throw new HttpError(404, 'Shift tidak ditemukan');
      if (shift && shift.closed_at) throw new HttpError(400, 'Shift sudah ditutup');

      const returnResult = await client.query(
        `INSERT INTO returns (code, sale_id, shift_id, user_id, total, refund_method, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [code, saleId, shiftId, req.user.id, total, refundMethod, reason]
      );
      const ret = returnResult.rows[0];

      for (const entry of prepared) {
        await client.query(
          `INSERT INTO return_items (return_id, sale_item_id, product_id, bundle_id, qty, unit_price, refund_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ret.id, entry.item.id, entry.item.product_id, entry.item.bundle_id,
            entry.qty, entry.item.unit_price, entry.refund,
          ]
        );

        await client.query(
          'UPDATE sale_items SET returned_qty = returned_qty + $1 WHERE id = $2',
          [entry.qty, entry.item.id]
        );

        // Kembalikan stok retur ke batch asal (FEFO trace, fallback legacy).
        await restoreSaleItemBatches(client, entry.item, entry.qty);

        // Baris paket: kembalikan stok tiap komponen sesuai qty paket (HPP asli komponen).
        if (entry.item.bundle_id) {
          const components = await client.query(
            `SELECT bi.product_id, bi.qty, p.cost_price
             FROM bundle_items bi
             JOIN products p ON p.id = bi.product_id
             WHERE bi.bundle_id = $1`,
            [entry.item.bundle_id]
          );
          for (const component of components.rows) {
            await applyStockMovement(client, {
              productId: component.product_id,
              qtyChange: component.qty * entry.qty,
              type: 'return',
              refType: 'return',
              refId: ret.id,
              unitCost: Number(component.cost_price),
              note: `Retur ${code}`,
              userId: req.user.id,
              allowNegative: true,
            });
          }
          continue;
        }

        const conversionFactor = entry.item.base_qty / entry.item.qty;

        await applyStockMovement(client, {
          productId: entry.item.product_id,
          qtyChange: Math.round(conversionFactor * entry.qty),
          type: 'return',
          refType: 'return',
          refId: ret.id,
          // cost_price tersimpan per satuan jual; kartu stok memakai satuan dasar.
          unitCost: Math.round(entry.item.cost_price / conversionFactor),
          note: `Retur ${code}`,
          userId: req.user.id,
          allowNegative: true,
        });
      }

      return ret;
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'return',
      entity: 'returns',
      entityId: created.id,
      detail: { code: created.code, sale_id: saleId, total: Number(created.total) },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

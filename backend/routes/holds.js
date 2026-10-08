const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

// Selaras dengan checkout minimarket (sales.js).
const MAX_LINE_QTY = 100000;
const HOLD_STATUSES = new Set(['active', 'resumed', 'cancelled']);

const HOLD_SELECT = `
  SELECT oh.*, u.full_name AS cashier_name, m.name AS member_name, m.code AS member_code,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(oh.items) AS item) AS item_count
  FROM order_holds oh
  LEFT JOIN users u ON u.id = oh.cashier_id
  LEFT JOIN members m ON m.id = oh.member_id
`;

// Normalisasi item hold: simpan referensi (id + qty + discount) + display hint.
// Harga tidak dipercaya — dihitung ulang via quote/checkout saat resume.
const normalizeItems = (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Keranjang kosong');
  }
  return rawItems.map((raw) => {
    const bundleId = toInt(raw?.bundle_id, 0);
    const productId = toInt(raw?.product_id, 0);
    const qty = Math.round(Number(raw?.qty));
    const discount = Math.max(0, Math.round(Number(raw?.discount) || 0));
    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty harus bilangan bulat positif');
    if (qty > MAX_LINE_QTY) throw new HttpError(400, `qty melebihi batas ${MAX_LINE_QTY}`);
    if (bundleId > 0) {
      return {
        bundle_id: bundleId,
        qty,
        discount,
        name: cleanString(raw?.name, 150) || null,
        sku: cleanString(raw?.sku, 50) || null,
        price: Math.max(0, Math.round(Number(raw?.price) || 0)),
      };
    }
    if (productId > 0) {
      return {
        product_id: productId,
        unit_id: toInt(raw?.unit_id, 0) || null,
        qty,
        discount,
        name: cleanString(raw?.name, 150) || null,
        unit_name: cleanString(raw?.unit_name, 30) || null,
        sku: cleanString(raw?.sku, 50) || null,
        price: Math.max(0, Math.round(Number(raw?.price) || 0)),
      };
    }
    throw new HttpError(400, 'Item hold tidak valid (product_id/bundle_id)');
  });
};

// Validasi ringan: produk/paket ada & aktif. Stok TIDAK dikunci di sini.
const validateItemsExist = async (client, items, business) => {
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  const bundleIds = [...new Set(items.map((i) => i.bundle_id).filter(Boolean))];
  if (productIds.length > 0) {
    const result = await client.query(
      'SELECT id, name, is_active FROM products WHERE id = ANY($1::int[]) AND business = $2',
      [productIds, business]
    );
    const map = new Map(result.rows.map((r) => [r.id, r]));
    productIds.forEach((id) => {
      const product = map.get(id);
      if (!product) throw new HttpError(400, `Produk #${id} tidak ditemukan`);
      if (!product.is_active) throw new HttpError(400, `Produk ${product.name} tidak aktif`);
    });
  }
  if (bundleIds.length > 0) {
    const result = await client.query(
      'SELECT id, name, is_active FROM bundles WHERE id = ANY($1::int[]) AND business = $2',
      [bundleIds, business]
    );
    const map = new Map(result.rows.map((r) => [r.id, r]));
    bundleIds.forEach((id) => {
      const bundle = map.get(id);
      if (!bundle) throw new HttpError(400, `Paket #${id} tidak ditemukan`);
      if (!bundle.is_active) throw new HttpError(400, `Paket ${bundle.name} tidak aktif`);
    });
  }
};

// =========================================================
// Tahan keranjang (parkir tanpa mengunci stok)
// =========================================================
router.post('/', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const items = normalizeItems(body.items);
    const memberId = toInt(body.member_id, 0) || null;
    const txnDiscount = Math.max(0, Math.round(Number(body.txn_discount) || 0));
    const redeemPoints = Math.max(0, Math.round(Number(body.redeem_points) || 0));
    const estimatedTotal = Math.max(0, Math.round(Number(body.estimated_total) || 0));
    const holdName = cleanString(body.hold_name, 100);
    const note = cleanString(body.note, 300);
    const shiftId = toInt(body.shift_id, 0) || null;

    const created = await withTransaction(async (client) => {
      if (memberId) {
        const memberResult = await client.query(
          'SELECT id, is_active FROM members WHERE id = $1 AND business = $2',
          [memberId, req.business]
        );
        const member = memberResult.rows[0];
        if (!member) throw new HttpError(400, 'Member tidak ditemukan');
        if (!member.is_active) throw new HttpError(400, 'Member tidak aktif');
      }
      if (shiftId) {
        const shiftResult = await client.query(
          'SELECT id, business FROM shifts WHERE id = $1',
          [shiftId]
        );
        const shift = shiftResult.rows[0];
        if (!shift || shift.business !== req.business) {
          throw new HttpError(400, 'Shift tidak ditemukan');
        }
      }

      await validateItemsExist(client, items, req.business);

      const holdCode = await nextDocNumber(client, 'HOLD');
      const holdResult = await client.query(
        `INSERT INTO order_holds
           (business, hold_code, shift_id, cashier_id, hold_name, member_id,
            txn_discount, redeem_points, items, estimated_total, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          req.business, holdCode, shiftId, req.user.id, holdName || null, memberId,
          txnDiscount, redeemPoints, JSON.stringify(items), estimatedTotal, note || null,
        ]
      );
      return holdResult.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'hold_create',
      entity: 'order_hold',
      entityId: created.id,
      detail: { hold_code: created.hold_code, item_count: items.length },
    });

    res.status(201).json({ hold: created });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Daftar hold
// =========================================================
router.get('/', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const status = HOLD_STATUSES.has(req.query.status) ? req.query.status : 'active';
    const cashierId = toInt(req.query.cashier_id, 0);

    const conditions = ['oh.business = $1', 'oh.status = $2'];
    const params = [req.business, status];
    if (cashierId > 0) {
      params.push(cashierId);
      conditions.push(`oh.cashier_id = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM order_holds oh ${where}`,
      params
    );
    params.push(limit, offset);
    const result = await pool.query(
      `${HOLD_SELECT} ${where} ORDER BY oh.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Detail hold — item diflag is_gone bila produk/paket hilang/tidak aktif
// =========================================================
router.get('/:id', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const holdResult = await pool.query(
      `${HOLD_SELECT} WHERE oh.id = $1 AND oh.business = $2`,
      [req.params.id, req.business]
    );
    const hold = holdResult.rows[0];
    if (!hold) throw new HttpError(404, 'Hold tidak ditemukan');

    const rawItems = Array.isArray(hold.items) ? hold.items : [];
    const productIds = [...new Set(rawItems.map((i) => i.product_id).filter(Boolean))];
    const bundleIds = [...new Set(rawItems.map((i) => i.bundle_id).filter(Boolean))];
    const gone = new Set();

    if (productIds.length > 0) {
      const result = await pool.query(
        'SELECT id, is_active FROM products WHERE id = ANY($1::int[]) AND business = $2',
        [productIds, req.business]
      );
      const map = new Map(result.rows.map((r) => [r.id, r]));
      productIds.forEach((id) => {
        const p = map.get(id);
        if (!p || !p.is_active) gone.add(`product:${id}`);
      });
    }
    if (bundleIds.length > 0) {
      const result = await pool.query(
        'SELECT id, is_active FROM bundles WHERE id = ANY($1::int[]) AND business = $2',
        [bundleIds, req.business]
      );
      const map = new Map(result.rows.map((r) => [r.id, r]));
      bundleIds.forEach((id) => {
        const b = map.get(id);
        if (!b || !b.is_active) gone.add(`bundle:${id}`);
      });
    }

    const items = rawItems.map((item) => ({
      ...item,
      is_gone: item.bundle_id
        ? gone.has(`bundle:${item.bundle_id}`)
        : gone.has(`product:${item.product_id}`),
    }));

    res.json({ ...hold, items });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Batalkan / tandai diambil (resume)
// =========================================================
// FOR UPDATE + cek status='active' agar dua terminal tidak mengambil hold yang
// sama. v1 resume non-atomic: frontend hydrate cart dulu, lalu memanggil ini
// dengan ?reason=resume; checkout memakai POST /api/sales seperti biasa.
router.delete('/:id', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const reason = req.query.reason === 'resume' ? 'resumed' : 'cancelled';
    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        'SELECT * FROM order_holds WHERE id = $1 AND business = $2 FOR UPDATE',
        [req.params.id, req.business]
      );
      const hold = result.rows[0];
      if (!hold) throw new HttpError(404, 'Hold tidak ditemukan');
      if (hold.status !== 'active') {
        throw new HttpError(409, 'Hold sudah diambil atau dibatalkan');
      }
      const updateResult = await client.query(
        `UPDATE order_holds
         SET status = $1, cancelled_by = $2, cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [reason, req.user.id, hold.id]
      );
      return updateResult.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: reason === 'resumed' ? 'hold_resume' : 'hold_cancel',
      entity: 'order_hold',
      entityId: updated.id,
      detail: { hold_code: updated.hold_code },
    });

    res.json({ hold: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

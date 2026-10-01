const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { requireString, cleanString, isValidDate } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt, requireRole('admin'));

const resolveRange = (query) => {
  const today = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const toIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    from: isValidDate(query.from) ? query.from : toIso(defaultFrom),
    to: isValidDate(query.to) ? query.to : toIso(today),
  };
};

// Hutang berjalan per penitip (harga setor):
//   SUM(sale_items.cost_price * qty) untuk produk konsinyasi (completed, neto retur)
//   dikurangi SUM(consignment_payouts.amount).
// cost_price tersimpan per satuan jual, jadi dikalikan qty (bukan base_qty).
const PAYABLE_SQL = `
  SELECT c.id AS consignor_id, c.name AS consignor_name, c.phone,
         COALESCE(sold.qty, 0)::int AS qty_sold,
         COALESCE(sold.payable, 0)::bigint AS sold_value,
         COALESCE(paid.total, 0)::bigint AS paid_total,
         (COALESCE(sold.payable, 0) - COALESCE(paid.total, 0))::bigint AS payable
  FROM consignors c
  LEFT JOIN (
    SELECT p.consignor_id,
           SUM(si.qty - si.returned_qty) AS qty,
           SUM(si.cost_price * (si.qty - si.returned_qty)) AS payable
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.status = 'completed' AND p.is_consignment = TRUE AND p.consignor_id IS NOT NULL
    GROUP BY p.consignor_id
  ) sold ON sold.consignor_id = c.id
  LEFT JOIN (
    SELECT consignor_id, SUM(amount) AS total
    FROM consignment_payouts
    GROUP BY consignor_id
  ) paid ON paid.consignor_id = c.id
`;

// =========================================================
// Penitip (consignors)
// =========================================================
router.get('/consignors', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const activeOnly = req.query.is_active === 'true';

    const where = activeOnly ? 'WHERE c.is_active = TRUE' : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM consignors c ${where}`);
    const result = await pool.query(
      `${PAYABLE_SQL} ${where} ORDER BY c.name LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/consignors/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`${PAYABLE_SQL} WHERE c.id = $1`, [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Penitip tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/consignors', async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama penitip', 150);
    if (name.error) throw new HttpError(400, name.error);

    const result = await pool.query(
      `INSERT INTO consignors (name, phone, address, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        name.value,
        cleanString(req.body?.phone, 50),
        cleanString(req.body?.address, 500),
        cleanString(req.body?.note, 500),
      ]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'consignors', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/consignors/:id', async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT * FROM consignors WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Penitip tidak ditemukan');

    const value = {};
    if ('name' in req.body) {
      const name = requireString(req.body?.name, 'Nama penitip', 150);
      if (name.error) throw new HttpError(400, name.error);
      value.name = name.value;
    }
    if ('phone' in req.body) value.phone = cleanString(req.body?.phone, 50);
    if ('address' in req.body) value.address = cleanString(req.body?.address, 500);
    if ('note' in req.body) value.note = cleanString(req.body?.note, 500);
    if ('is_active' in req.body) value.is_active = req.body.is_active === true || req.body.is_active === 'true' || req.body.is_active === 1;

    const keys = Object.keys(value);
    if (keys.length === 0) throw new HttpError(400, 'Tidak ada perubahan');

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const params = keys.map((key) => value[key]);
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE consignors SET ${setClause} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'consignors', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/consignors/:id', async (req, res, next) => {
  try {
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE consignor_id = $1', [req.params.id]);
    if (used.rows[0].n > 0) {
      const result = await pool.query(
        'UPDATE consignors SET is_active = FALSE WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!result.rows[0]) throw new HttpError(404, 'Penitip tidak ditemukan');
      await logAudit(pool, { userId: req.user.id, action: 'deactivate', entity: 'consignors', entityId: Number(req.params.id) });
      return res.json({ message: 'Penitip dinonaktifkan (masih terkait produk)' });
    }
    const result = await pool.query('DELETE FROM consignors WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Penitip tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'delete', entity: 'consignors', entityId: Number(req.params.id) });
    res.json({ message: 'Penitip dihapus' });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Barang titipan (produk konsinyasi) + sisa stok
// =========================================================
router.get('/products', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const consignorId = toInt(req.query.consignor_id, 0);

    const conditions = ['p.is_consignment = TRUE'];
    const params = [];
    if (consignorId > 0) {
      params.push(consignorId);
      conditions.push(`p.consignor_id = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT p.id, p.sku, p.name, p.base_unit, p.cost_price, p.sell_price, p.stock_qty,
              p.is_active, p.consignor_id, c.name AS consignor_name
       FROM products p
       LEFT JOIN consignors c ON c.id = p.consignor_id
       ${where}
       ORDER BY p.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Laporan penjualan konsinyasi
// =========================================================
router.get('/sales', async (req, res, next) => {
  try {
    const { from, to } = resolveRange(req.query);
    const consignorId = toInt(req.query.consignor_id, 0);

    const params = [from, to];
    let filter = '';
    if (consignorId > 0) {
      params.push(consignorId);
      filter = `AND p.consignor_id = $${params.length}`;
    }

    // Ringkasan per penitip.
    const summary = await pool.query(
      `SELECT p.consignor_id, COALESCE(c.name, '(tanpa penitip)') AS consignor_name,
              SUM(si.qty - si.returned_qty)::int AS qty_sold,
              COALESCE(SUM(si.cost_price * (si.qty - si.returned_qty)), 0)::bigint AS payable_value,
              COALESCE(SUM(si.line_total), 0)::bigint AS sale_value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN consignors c ON c.id = p.consignor_id
       WHERE s.status = 'completed' AND p.is_consignment = TRUE
         AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
         ${filter}
       GROUP BY p.consignor_id, c.name
       ORDER BY payable_value DESC`,
      params
    );

    // Rincian per produk.
    const detail = await pool.query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.base_unit,
              COALESCE(c.name, '(tanpa penitip)') AS consignor_name,
              SUM(si.qty - si.returned_qty)::int AS qty_sold,
              COALESCE(SUM(si.cost_price * (si.qty - si.returned_qty)), 0)::bigint AS payable_value,
              COALESCE(SUM(si.line_total), 0)::bigint AS sale_value
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN consignors c ON c.id = p.consignor_id
       WHERE s.status = 'completed' AND p.is_consignment = TRUE
         AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
         ${filter}
       GROUP BY p.id, p.sku, p.name, p.base_unit, c.name
       ORDER BY payable_value DESC`,
      params
    );

    res.json({
      from,
      to,
      summary: summary.rows.map((r) => ({
        ...r,
        payable_value: Number(r.payable_value),
        sale_value: Number(r.sale_value),
      })),
      detail: detail.rows.map((r) => ({
        ...r,
        payable_value: Number(r.payable_value),
        sale_value: Number(r.sale_value),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Hutang berjalan & pembayaran
// =========================================================
router.get('/payables', async (req, res, next) => {
  try {
    const result = await pool.query(`${PAYABLE_SQL} ORDER BY payable DESC, c.name`);
    res.json({
      rows: result.rows.map((r) => ({
        ...r,
        sold_value: Number(r.sold_value),
        paid_total: Number(r.paid_total),
        payable: Number(r.payable),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/payouts', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const consignorId = toInt(req.query.consignor_id, 0);

    const params = [];
    const conditions = [];
    if (consignorId > 0) {
      params.push(consignorId);
      conditions.push(`cp.consignor_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM consignment_payouts cp ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT cp.*, c.name AS consignor_name, u.full_name AS user_name
       FROM consignment_payouts cp
       JOIN consignors c ON c.id = cp.consignor_id
       LEFT JOIN users u ON u.id = cp.user_id
       ${where} ORDER BY cp.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.post('/payouts', async (req, res, next) => {
  try {
    const consignorId = toInt(req.body?.consignor_id, 0);
    if (consignorId <= 0) throw new HttpError(400, 'consignor_id wajib diisi');

    const amount = Math.round(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah pembayaran tidak valid');

    const periodFrom = cleanString(req.body?.period_from, 10);
    const periodTo = cleanString(req.body?.period_to, 10);
    if (periodFrom && !isValidDate(periodFrom)) throw new HttpError(400, 'period_from tidak valid');
    if (periodTo && !isValidDate(periodTo)) throw new HttpError(400, 'period_to tidak valid');

    const created = await withTransaction(async (client) => {
      const consignor = await client.query('SELECT * FROM consignors WHERE id = $1 FOR UPDATE', [consignorId]);
      if (!consignor.rows[0]) throw new HttpError(404, 'Penitip tidak ditemukan');

      const payableResult = await client.query(
        `SELECT
           COALESCE((
             SELECT SUM(si.cost_price * (si.qty - si.returned_qty))
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             JOIN products p ON p.id = si.product_id
             WHERE s.status = 'completed' AND p.is_consignment = TRUE AND p.consignor_id = $1
           ), 0)::bigint AS sold,
           COALESCE((
             SELECT SUM(amount) FROM consignment_payouts WHERE consignor_id = $1
           ), 0)::bigint AS paid`,
        [consignorId]
      );
      const payable = Number(payableResult.rows[0].sold) - Number(payableResult.rows[0].paid);
      if (amount > payable) {
        throw new HttpError(400, `Pembayaran melebihi hutang berjalan (hutang ${payable})`);
      }

      const result = await client.query(
        `INSERT INTO consignment_payouts (consignor_id, amount, period_from, period_to, note, user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [consignorId, amount, periodFrom, periodTo, cleanString(req.body?.note, 500), req.user.id]
      );
      return result.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'payout',
      entity: 'consignment_payouts',
      entityId: created.id,
      detail: { consignor_id: consignorId, amount },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

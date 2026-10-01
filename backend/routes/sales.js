const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { applyStockMovement } = require('../utils/stock');
const { extractTax, pointsEarned } = require('../utils/money');
const { resolveUnit, resolvePrice } = require('../utils/pricing');
const { getSettings } = require('../utils/settings');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

const PAYMENT_METHODS = new Set(['cash', 'qris', 'debit', 'transfer']);

const SALE_SELECT = `
  SELECT s.*, u.full_name AS cashier_name, m.name AS member_name, m.code AS member_code,
         (SELECT STRING_AGG(DISTINCT sp.method, ',') FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods
  FROM sales s
  LEFT JOIN users u ON u.id = s.cashier_id
  LEFT JOIN members m ON m.id = s.member_id
`;

// =========================================================
// Checkout
// =========================================================
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const shiftId = toInt(body.shift_id, 0);
    if (shiftId <= 0) throw new HttpError(400, 'shift_id wajib diisi');

    const memberId = toInt(body.member_id, 0) || null;
    const redeemPoints = Math.max(0, Math.round(Number(body.redeem_points) || 0));
    const txnDiscountInput = Math.max(0, Math.round(Number(body.txn_discount) || 0));

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, 'Keranjang kosong');
    }

    const payments = Array.isArray(body.payments) ? body.payments : [];
    if (payments.length === 0) throw new HttpError(400, 'Metode pembayaran wajib diisi');
    payments.forEach((p) => {
      if (!PAYMENT_METHODS.has(p?.method)) throw new HttpError(400, 'Metode pembayaran tidak valid');
      if (!Number.isFinite(Number(p?.amount)) || Number(p.amount) <= 0) {
        throw new HttpError(400, 'Jumlah pembayaran tidak valid');
      }
    });

    const settings = await getSettings();
    if (!settings) throw new HttpError(500, 'Pengaturan toko belum diinisialisasi');

    const result = await withTransaction(async (client) => {
      // Shift harus terbuka.
      const shiftResult = await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);
      const shift = shiftResult.rows[0];
      if (!shift) throw new HttpError(404, 'Shift tidak ditemukan');
      if (shift.closed_at) throw new HttpError(400, 'Shift sudah ditutup');
      if (req.user.role !== 'admin' && shift.user_id !== req.user.id) {
        throw new HttpError(403, 'Shift ini bukan milik Anda');
      }

      // Member (opsional).
      let member = null;
      if (memberId) {
        const memberResult = await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [memberId]);
        member = memberResult.rows[0];
        if (!member) throw new HttpError(404, 'Member tidak ditemukan');
        if (!member.is_active) throw new HttpError(400, 'Member tidak aktif');
      }

      const isMember = Boolean(member);

      // Hitung ulang setiap baris dari data server (jangan percaya total klien).
      const lines = [];
      let subtotal = 0;
      let itemDiscountTotal = 0;

      for (const raw of body.items) {
        const productId = toInt(raw?.product_id, 0);
        if (productId <= 0) throw new HttpError(400, 'product_id tidak valid');

        const qty = Math.round(Number(raw?.qty));
        if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty harus bilangan bulat positif');

        const unitId = toInt(raw?.unit_id, 0) || null;

        const productResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
        const product = productResult.rows[0];
        if (!product) throw new HttpError(404, `Produk #${productId} tidak ditemukan`);
        if (!product.is_active) throw new HttpError(400, `Produk ${product.name} tidak aktif`);

        const resolved = await resolveUnit(client, { productId, unitId });
        if (!resolved) throw new HttpError(400, 'Satuan produk tidak ditemukan');

        const unitPrice = resolvePrice(product, resolved.unit, isMember);
        const baseQty = qty * resolved.conversionFactor;

        const grossLine = unitPrice * qty;
        const lineDiscount = Math.max(0, Math.round(Number(raw?.discount) || 0));
        if (lineDiscount > grossLine) {
          throw new HttpError(400, `Diskon item ${product.name} melebihi harga`);
        }

        subtotal += grossLine;
        itemDiscountTotal += lineDiscount;

        lines.push({
          product,
          unitId,
          unitName: resolved.unit ? resolved.unit.unit_name : product.base_unit,
          qty,
          baseQty,
          unitPrice,
          discount: lineDiscount,
          lineTotal: grossLine - lineDiscount,
          // HPP per satuan jual (bukan per satuan dasar) agar laporan laba kotor
          // yang memakai cost_price * qty tetap benar untuk penjualan multi-satuan.
          costPrice: Math.round(Number(product.cost_price) * resolved.conversionFactor),
          // HPP per satuan dasar, dipakai untuk kartu stok (qty dalam satuan dasar).
          baseCostPrice: Number(product.cost_price),
        });
      }

      const afterItemDiscount = subtotal - itemDiscountTotal;
      if (txnDiscountInput > afterItemDiscount) {
        throw new HttpError(400, 'Diskon transaksi melebihi subtotal');
      }

      const afterTxnDiscount = afterItemDiscount - txnDiscountInput;

      // Penukaran poin.
      let pointsRedeemed = 0;
      let pointsValue = 0;
      if (redeemPoints > 0) {
        if (!member) throw new HttpError(400, 'Penukaran poin memerlukan member');
        if (redeemPoints < settings.point_min_redeem) {
          throw new HttpError(400, `Minimal penukaran ${settings.point_min_redeem} poin`);
        }
        if (redeemPoints > member.points) throw new HttpError(400, 'Poin member tidak mencukupi');

        const pointValue = Number(settings.point_value_rupiah);
        const rawValue = redeemPoints * pointValue;
        // Potongan tidak boleh melebihi total, dan poin yang didebit harus
        // sepadan dengan nilai potongan yang benar-benar diberikan.
        pointsValue = Math.min(rawValue, afterTxnDiscount);
        pointsRedeemed = pointValue > 0 ? Math.floor(pointsValue / pointValue) : 0;
        pointsValue = pointsRedeemed * pointValue;
      }

      const payable = afterTxnDiscount - pointsValue;
      if (payable < 0) throw new HttpError(400, 'Total tidak boleh negatif');

      // PPN: harga jual sudah include PPN -> hitung terbalik dari total bayar.
      let taxTotal = 0;
      let grandTotal = payable;
      if (settings.tax_included) {
        taxTotal = extractTax(payable, settings.tax_rate).taxTotal;
      } else {
        taxTotal = Math.round((payable * Number(settings.tax_rate)) / 100);
        grandTotal = payable + taxTotal;
      }

      // Poin didapat dihitung dari nilai belanja setelah penukaran poin.
      const earned = pointsEarned(payable, settings.point_earn_per_amount);

      const paidTotal = payments.reduce((sum, p) => sum + Math.round(Number(p.amount)), 0);
      if (paidTotal < grandTotal) {
        throw new HttpError(400, `Pembayaran kurang ${grandTotal - paidTotal}`);
      }
      const cashTendered = payments
        .filter((p) => p.method === 'cash')
        .reduce((sum, p) => sum + Math.round(Number(p.amount)), 0);
      const change = paidTotal - grandTotal;
      // Kembalian hanya boleh berasal dari uang tunai yang benar-benar diterima,
      // sehingga split payment tidak bisa membuat toko menyerahkan kas lebih besar
      // daripada yang diterima.
      if (change > cashTendered) {
        throw new HttpError(400, 'Kelebihan bayar melebihi jumlah pembayaran tunai');
      }

      const invoiceNo = await nextDocNumber(client, settings.invoice_prefix || 'INV');

      const saleResult = await client.query(
        `INSERT INTO sales
          (invoice_no, shift_id, cashier_id, member_id, subtotal, item_discount, txn_discount,
           points_value, tax_total, grand_total, points_earned, points_redeemed, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'completed')
         RETURNING *`,
        [
          invoiceNo, shiftId, req.user.id, memberId, subtotal, itemDiscountTotal, txnDiscountInput,
          pointsValue, taxTotal, grandTotal, earned, pointsRedeemed,
        ]
      );
      const sale = saleResult.rows[0];

      // Simpan item + kurangi stok.
      for (const line of lines) {
        await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, unit_id, unit_name, qty, base_qty, unit_price, discount, cost_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            sale.id, line.product.id, line.unitId, line.unitName, line.qty, line.baseQty,
            line.unitPrice, line.discount, line.costPrice, line.lineTotal,
          ]
        );

        await applyStockMovement(client, {
          productId: line.product.id,
          qtyChange: -line.baseQty,
          type: 'sale',
          refType: 'sale',
          refId: sale.id,
          unitCost: line.baseCostPrice,
          note: invoiceNo,
          userId: req.user.id,
          allowNegative: settings.allow_negative_stock === true,
        });
      }

      // Simpan pembayaran.
      for (const payment of payments) {
        await client.query(
          'INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES ($1, $2, $3, $4)',
          [sale.id, payment.method, Math.round(Number(payment.amount)), cleanString(payment.reference, 120)]
        );
      }

      // Poin member.
      let memberPointsAfter = member ? member.points : null;
      if (member) {
        if (pointsRedeemed > 0) {
          memberPointsAfter -= pointsRedeemed;
          await client.query('UPDATE members SET points = $1 WHERE id = $2', [memberPointsAfter, member.id]);
          await client.query(
            `INSERT INTO member_point_logs (member_id, change, balance_after, type, ref_type, ref_id, note)
             VALUES ($1, $2, $3, 'redeem', 'sale', $4, $5)`,
            [member.id, -pointsRedeemed, memberPointsAfter, sale.id, invoiceNo]
          );
        }
        if (earned > 0) {
          memberPointsAfter += earned;
          await client.query('UPDATE members SET points = $1 WHERE id = $2', [memberPointsAfter, member.id]);
          await client.query(
            `INSERT INTO member_point_logs (member_id, change, balance_after, type, ref_type, ref_id, note)
             VALUES ($1, $2, $3, 'earn', 'sale', $4, $5)`,
            [member.id, earned, memberPointsAfter, sale.id, invoiceNo]
          );
        }
      }

      return { sale, change, memberPointsAfter, invoiceNo };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'checkout',
      entity: 'sales',
      entityId: result.sale.id,
      detail: { invoice_no: result.invoiceNo, grand_total: Number(result.sale.grand_total) },
    });

    res.status(201).json({
      sale: result.sale,
      change: result.change,
      member_points: result.memberPointsAfter,
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Riwayat & detail
// =========================================================
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const cashierId = toInt(req.query.cashier_id, 0);
    const shiftId = toInt(req.query.shift_id, 0);
    const status = cleanString(req.query.status, 10);
    const method = cleanString(req.query.method, 10);
    const invoiceNo = cleanString(req.query.invoice_no, 40);

    const conditions = [];
    const params = [];

    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`s.created_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`s.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (cashierId > 0) {
      params.push(cashierId);
      conditions.push(`s.cashier_id = $${params.length}`);
    }
    if (shiftId > 0) {
      params.push(shiftId);
      conditions.push(`s.shift_id = $${params.length}`);
    }
    if (status === 'completed' || status === 'void') {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (invoiceNo) {
      params.push(`%${invoiceNo}%`);
      conditions.push(`s.invoice_no ILIKE $${params.length}`);
    }
    if (method && PAYMENT_METHODS.has(method)) {
      params.push(method);
      conditions.push(
        `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = $${params.length})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM sales s ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${SALE_SELECT} ${where} ORDER BY s.created_at DESC, s.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

const loadSaleDetail = async (runner, whereClause, params) => {
  const saleResult = await runner.query(`${SALE_SELECT} ${whereClause}`, params);
  const sale = saleResult.rows[0];
  if (!sale) return null;

  const items = await runner.query(
    `SELECT si.*, p.sku, p.name AS product_name, p.base_unit,
            si.returned_qty
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [sale.id]
  );
  const payments = await runner.query(
    'SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY id',
    [sale.id]
  );
  const returns = await runner.query(
    'SELECT * FROM returns WHERE sale_id = $1 ORDER BY created_at DESC',
    [sale.id]
  );
  return { ...sale, items: items.rows, payments: payments.rows, returns: returns.rows };
};

router.get('/by-invoice/:invoiceNo', async (req, res, next) => {
  try {
    const detail = await loadSaleDetail(pool, 'WHERE s.invoice_no = $1', [req.params.invoiceNo]);
    if (!detail) throw new HttpError(404, 'Transaksi tidak ditemukan');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const detail = await loadSaleDetail(pool, 'WHERE s.id = $1', [req.params.id]);
    if (!detail) throw new HttpError(404, 'Transaksi tidak ditemukan');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Void: hanya transaksi hari ini & shift belum ditutup
// =========================================================
router.post('/:id/void', async (req, res, next) => {
  try {
    const reason = cleanString(req.body?.reason, 300) || 'Tanpa alasan';

    const result = await withTransaction(async (client) => {
      const saleResult = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [req.params.id]);
      const sale = saleResult.rows[0];
      if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan');
      if (sale.status === 'void') throw new HttpError(400, 'Transaksi sudah di-void');

      const todayCheck = await client.query(
        'SELECT (created_at::date = CURRENT_DATE) AS is_today FROM sales WHERE id = $1',
        [sale.id]
      );
      if (!todayCheck.rows[0].is_today) {
        throw new HttpError(400, 'Hanya transaksi hari ini yang dapat di-void');
      }

      if (sale.shift_id) {
        const shift = await client.query('SELECT closed_at FROM shifts WHERE id = $1', [sale.shift_id]);
        if (shift.rows[0]?.closed_at) throw new HttpError(400, 'Shift sudah ditutup, transaksi tidak dapat di-void');
      }

      const settings = await getSettings();

      const items = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
      for (const item of items.rows) {
        // Hanya kembalikan qty yang belum pernah diretur, agar stok tidak
        // bertambah dua kali (retur sudah menambah stok).
        const unreturnedBaseQty = Math.round(
          (item.base_qty / item.qty) * (item.qty - item.returned_qty)
        );
        if (unreturnedBaseQty <= 0) continue;

        await applyStockMovement(client, {
          productId: item.product_id,
          qtyChange: unreturnedBaseQty,
          type: 'void',
          refType: 'sale',
          refId: sale.id,
          // cost_price tersimpan per satuan jual; kartu stok memakai satuan dasar.
          unitCost: Math.round(item.cost_price / (item.base_qty / item.qty)),
          note: `Void ${sale.invoice_no}`,
          userId: req.user.id,
          allowNegative: true,
        });
      }

      // Kembalikan poin: redeemed dikembalikan, earned ditarik kembali.
      if (sale.member_id) {
        const member = await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [sale.member_id]);
        if (member.rows[0]) {
          const delta = Number(sale.points_redeemed) - Number(sale.points_earned);
          if (delta !== 0) {
            const newBalance = member.rows[0].points + delta;
            await client.query('UPDATE members SET points = $1 WHERE id = $2', [Math.max(0, newBalance), sale.member_id]);
            await client.query(
              `INSERT INTO member_point_logs (member_id, change, balance_after, type, ref_type, ref_id, note)
               VALUES ($1, $2, $3, 'adjust', 'sale_void', $4, $5)`,
              [sale.member_id, delta, Math.max(0, newBalance), sale.id, `Void ${sale.invoice_no}`]
            );
          }
        }
      }

      const updated = await client.query(
        `UPDATE sales SET status = 'void', void_reason = $1, void_by = $2, void_at = NOW()
         WHERE id = $3 RETURNING *`,
        [reason, req.user.id, sale.id]
      );

      return { sale: updated.rows[0], allowNegative: settings?.allow_negative_stock };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'void',
      entity: 'sales',
      entityId: Number(req.params.id),
      detail: { reason },
    });

    res.json(result.sale);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

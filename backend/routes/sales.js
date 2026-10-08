const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../utils/permissions');
const { APP_TIMEZONE } = require('../utils/receivables');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { applyStockMovement } = require('../utils/stock');
const { allocateFefo, recordSaleItemBatch, recordShortfall, restoreSaleStock } = require('../utils/batches');
const { extractTax, pointsEarned } = require('../utils/money');
const { resolveItemsEffectivePricing } = require('../utils/item_pricing');
const { getSettings, getSettingsFor } = require('../utils/settings');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

const PAYMENT_METHODS = new Set(['cash', 'qris', 'debit', 'transfer']);

// Batas jumlah per baris item agar perhitungan uang tetap aman (Number -> BIGINT)
// dan mencegah penyalahgunaan nilai qty yang sangat besar.
const MAX_LINE_QTY = 100000;

const SALE_SELECT = `
  SELECT s.*, u.full_name AS cashier_name, m.name AS member_name, m.code AS member_code,
         c.name AS customer_name, c.code AS customer_code,
         (SELECT STRING_AGG(DISTINCT sp.method, ',') FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods
  FROM sales s
  LEFT JOIN users u ON u.id = s.cashier_id
  LEFT JOIN members m ON m.id = s.member_id
  LEFT JOIN customers c ON c.id = s.customer_id
`;

// =========================================================
// Checkout
// =========================================================
router.post('/', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const shiftId = toInt(body.shift_id, 0);
    if (shiftId <= 0) throw new HttpError(400, 'shift_id wajib diisi');

    const memberId = toInt(body.member_id, 0) || null;
    const redeemPoints = Math.max(0, Math.round(Number(body.redeem_points) || 0));
    const txnDiscountInput = Math.max(0, Math.round(Number(body.txn_discount) || 0));

    // Penjualan kredit grosir: pembayaran opsional (uang muka), wajib pelanggan,
    // dan butuh izin invoice.manage (memberi kredit = keputusan pemilik/admin).
    const isCredit = body.is_credit === true;
    const customerId = toInt(body.customer_id, 0) || null;
    const termDaysInput = body.payment_term_days !== undefined && body.payment_term_days !== null
      ? Math.round(Number(body.payment_term_days))
      : null;
    const dueDateInput = cleanString(body.due_date, 10);

    if (isCredit && !hasPermission(req.user, 'invoice.manage')) {
      throw new HttpError(403, 'Akses ditolak: izin menerbitkan invoice kredit tidak mencukupi');
    }
    if (isCredit && !customerId) throw new HttpError(400, 'Pelanggan grosir wajib dipilih untuk penjualan kredit');
    if (!isCredit && customerId) throw new HttpError(400, 'customer_id hanya untuk penjualan kredit');

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, 'Keranjang kosong');
    }

    const payments = Array.isArray(body.payments) ? body.payments : [];
    if (!isCredit && payments.length === 0) throw new HttpError(400, 'Metode pembayaran wajib diisi');
    payments.forEach((p) => {
      if (!PAYMENT_METHODS.has(p?.method)) throw new HttpError(400, 'Metode pembayaran tidak valid');
      if (!Number.isFinite(Number(p?.amount)) || Number(p.amount) <= 0) {
        throw new HttpError(400, 'Jumlah pembayaran tidak valid');
      }
    });

    const settings = await getSettings();
    if (!settings) throw new HttpError(500, 'Pengaturan toko belum diinisialisasi');

    // Idempotensi: kirim header X-Idempotency-Key yang sama saat retry agar
    // double-klik/retry jaringan tidak membuat dua invoice + stok ganda.
    const idemKey = cleanString(req.get('X-Idempotency-Key'), 64);
    if (idemKey) {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS sale_idempotency (
          key VARCHAR(64) NOT NULL,
          business VARCHAR(30) NOT NULL DEFAULT 'minimarket',
          sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (business, key)
        )`
      );
      const prior = await pool.query(
        'SELECT sale_id FROM sale_idempotency WHERE business = $1 AND key = $2',
        [req.business, idemKey]
      );
      if (prior.rows[0]) {
        const detail = await loadSaleDetail(pool, 'WHERE s.id = $1', [prior.rows[0].sale_id]);
        if (detail) return res.status(200).json({ sale: detail, change: 0, member_points: null, idempotent: true });
      }
    }

    const result = await withTransaction(async (client) => {
      // Shift harus terbuka.
      const shiftResult = await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);
      const shift = shiftResult.rows[0];
      if (!shift) throw new HttpError(404, 'Shift tidak ditemukan');
      if (shift.closed_at) throw new HttpError(400, 'Shift sudah ditutup');
      if (shift.business !== req.business) throw new HttpError(400, 'Shift bukan milik usaha ini');
      if (!req.user.is_admin && shift.user_id !== req.user.id) {
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

      // Pelanggan grosir (wajib untuk kredit).
      let customer = null;
      if (customerId) {
        const customerResult = await client.query(
          'SELECT * FROM customers WHERE id = $1 FOR UPDATE',
          [customerId]
        );
        customer = customerResult.rows[0];
        if (!customer) throw new HttpError(404, 'Pelanggan grosir tidak ditemukan');
        if (!customer.is_active) throw new HttpError(400, 'Pelanggan grosir tidak aktif');
      }

      // Hitung ulang setiap baris dari data server (jangan percaya total klien).
      const lines = [];
      let subtotal = 0;
      let itemDiscountTotal = 0;

      // Pisahkan baris produk biasa dan baris paket (bundle). Baris paket ditandai
      // dengan `bundle_id` sebagai ganti `product_id`.
      const normalizedProductItems = [];
      const normalizedBundleItems = [];
      for (const raw of body.items) {
        const bundleId = toInt(raw?.bundle_id, 0);
        const qty = Math.round(Number(raw?.qty));
        if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty harus bilangan bulat positif');
        if (qty > MAX_LINE_QTY) throw new HttpError(400, `qty melebihi batas ${MAX_LINE_QTY}`);

        if (bundleId > 0) {
          normalizedBundleItems.push({ raw, bundleId, qty });
          continue;
        }
        const productId = toInt(raw?.product_id, 0);
        if (productId <= 0) throw new HttpError(400, 'product_id tidak valid');
        const unitId = toInt(raw?.unit_id, 0) || null;
        normalizedProductItems.push({ raw, productId, qty, unitId, index: normalizedProductItems.length });
      }

      const lockedProducts = new Map();
      for (const item of normalizedProductItems) {
        if (lockedProducts.has(item.productId)) continue;
        const productResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
        const product = productResult.rows[0];
        if (!product) throw new HttpError(404, `Produk #${item.productId} tidak ditemukan`);
        if (!product.is_active) throw new HttpError(400, `Produk ${product.name} tidak aktif`);
        lockedProducts.set(item.productId, product);
      }

      // Resolusi harga efektif (normal/member/tier/promo) dalam query tetap, bukan N+1.
      // Paket tidak lewat resolver ini; harganya tetap dari bundles.price.
      const priced = await resolveItemsEffectivePricing(client, {
        items: normalizedProductItems.map((i) => ({ product_id: i.productId, unit_id: i.unitId, qty: i.qty })),
        isMember,
      });

      const allowNegativeStock = req.business === 'minimarket'
        ? settings.allow_negative_stock === true
        : (await getSettingsFor(req.business, client)).allow_negative_stock === true;

      // Baris paket: ambil komponen, hitung HPP total, dan siapkan mutasi stok per komponen.
      const bundleLines = [];
      for (const item of normalizedBundleItems) {
        const bundleResult = await client.query('SELECT * FROM bundles WHERE id = $1', [item.bundleId]);
        const bundle = bundleResult.rows[0];
        if (!bundle) throw new HttpError(404, `Paket #${item.bundleId} tidak ditemukan`);
        if (!bundle.is_active) throw new HttpError(400, `Paket ${bundle.name} tidak aktif`);

        const componentsResult = await client.query(
          `SELECT bi.product_id, bi.qty, p.name, p.cost_price
           FROM bundle_items bi
           JOIN products p ON p.id = bi.product_id
           WHERE bi.bundle_id = $1
           ORDER BY bi.id`,
          [bundle.id]
        );
        if (componentsResult.rows.length === 0) {
          throw new HttpError(400, `Paket ${bundle.name} belum memiliki komponen`);
        }

        const unitPrice = Number(bundle.price);
        const grossLine = unitPrice * item.qty;
        const lineDiscount = Math.max(0, Math.round(Number(item.raw?.discount) || 0));
        if (lineDiscount > grossLine) {
          throw new HttpError(400, `Diskon paket ${bundle.name} melebihi harga`);
        }

        // HPP per satuan paket = SUM(HPP komponen * qty komponen dalam satuan dasar).
        const unitCost = componentsResult.rows.reduce(
          (sum, c) => sum + Number(c.cost_price) * c.qty,
          0
        );

        subtotal += grossLine;
        itemDiscountTotal += lineDiscount;

        bundleLines.push({
          bundle,
          qty: item.qty,
          unitPrice,
          lineDiscount,
          lineTotal: grossLine - lineDiscount,
          // costPrice per satuan jual paket (laporan laba kotor memakai cost_price * qty).
          costPrice: Math.round(unitCost),
          components: componentsResult.rows.map((c) => ({
            productId: c.product_id,
            qtyPerBundle: c.qty,
            name: c.name,
            baseCostPrice: Number(c.cost_price),
          })),
        });
      }

      for (let idx = 0; idx < normalizedProductItems.length; idx += 1) {
        const { raw, productId, qty, unitId } = normalizedProductItems[idx];
        const priced_line = priced[idx];
        const product = lockedProducts.get(productId);
        if (!priced_line || priced_line.unitMissing) {
          throw new HttpError(400, 'Satuan produk tidak ditemukan');
        }

        const unitPrice = priced_line.effectivePrice;
        const conversionFactor = priced_line.conversionFactor || 1;
        const baseQty = qty * conversionFactor;

        const grossLine = unitPrice * qty;
        const lineDiscount = Math.max(0, Math.round(Number(raw?.discount) || 0));
        if (lineDiscount > grossLine) {
          throw new HttpError(400, `Diskon item ${product.name} melebihi harga`);
        }

        subtotal += grossLine;
        itemDiscountTotal += lineDiscount;

        lines.push({
          kind: 'product',
          product,
          unitId,
          unitName: priced_line.unitName,
          qty,
          baseQty,
          unitPrice,
          discount: lineDiscount,
          lineTotal: grossLine - lineDiscount,
          promoId: priced_line.promoId,
          tierId: priced_line.tierId,
          // HPP per satuan jual (bukan per satuan dasar) agar laporan laba kotor
          // yang memakai cost_price * qty tetap benar untuk penjualan multi-satuan.
          costPrice: Math.round(Number(product.cost_price) * conversionFactor),
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
      // Grosir kredit TIDAK memberi poin member (keputusan: pelanggan B2B tanpa poin).
      const earned = isCredit ? 0 : pointsEarned(payable, settings.point_earn_per_amount);

      const paidTotal = payments.reduce((sum, p) => sum + Math.round(Number(p.amount)), 0);
      let change = 0;
      let paidAmount = 0;
      let paymentStatus = 'paid';

      if (isCredit) {
        // Uang muka (DP) opsional; sisanya menjadi piutang. Tidak ada kembalian.
        if (paidTotal > grandTotal) {
          throw new HttpError(400, 'Uang muka tidak boleh melebihi total tagihan');
        }
        paidAmount = paidTotal;
        paymentStatus = paidAmount >= grandTotal ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');
      } else {
        if (paidTotal < grandTotal) {
          throw new HttpError(400, `Pembayaran kurang ${grandTotal - paidTotal}`);
        }
        const cashTendered = payments
          .filter((p) => p.method === 'cash')
          .reduce((sum, p) => sum + Math.round(Number(p.amount)), 0);
        change = paidTotal - grandTotal;
        // Kembalian hanya boleh berasal dari uang tunai yang benar-benar diterima,
        // sehingga split payment tidak bisa membuat toko menyerahkan kas lebih besar
        // daripada yang diterima.
        if (change > cashTendered) {
          throw new HttpError(400, 'Kelebihan bayar melebihi jumlah pembayaran tunai');
        }
      }

      // Jatuh tempo kredit: override due_date bila valid, jika tidak dari termin
      // pelanggan (atau override payment_term_days), dihitung dari hari ini.
      let dueDate = null;
      if (isCredit) {
        if (dueDateInput) {
          if (!isValidDate(dueDateInput)) throw new HttpError(400, 'Format due_date harus YYYY-MM-DD');
          dueDate = dueDateInput;
        } else {
          const termDays = termDaysInput !== null && Number.isFinite(termDaysInput)
            ? termDaysInput
            : Number(customer.payment_term_days) || 0;
          if (termDays < 0 || termDays > 3650) throw new HttpError(400, 'Termin (hari) tidak valid');
          // Basis hari mengikuti zona waktu toko, konsisten dengan laporan.
          const dueResult = await client.query(
            `SELECT ((CURRENT_TIMESTAMP AT TIME ZONE $1)::date + $2::int)::date AS due_date`,
            [APP_TIMEZONE, termDays]
          );
          dueDate = dueResult.rows[0].due_date;
        }

        // Cek limit kredit (0 = tanpa batas): piutang berjalan + tagihan ini.
        const creditLimit = Number(customer.credit_limit) || 0;
        if (creditLimit > 0) {
          const outstandingResult = await client.query(
            `SELECT COALESCE(SUM(grand_total - paid_amount), 0)::bigint AS outstanding
             FROM sales
             WHERE customer_id = $1 AND is_credit = TRUE AND status = 'completed' AND payment_status <> 'paid'`,
            [customer.id]
          );
          const outstanding = Number(outstandingResult.rows[0].outstanding);
          const remaining = grandTotal - paidAmount;
          if (outstanding + remaining > creditLimit) {
            throw new HttpError(
              400,
              `Melebihi limit kredit pelanggan (limit ${creditLimit}, piutang berjalan ${outstanding}, tagihan ${remaining})`
            );
          }
        }
      }

      const invoiceNo = await nextDocNumber(client, settings.invoice_prefix || 'INV');

      const saleResult = await client.query(
        `INSERT INTO sales
          (invoice_no, shift_id, cashier_id, member_id, customer_id, is_credit, due_date,
           paid_amount, payment_status, subtotal, item_discount, txn_discount,
           points_value, tax_total, grand_total, points_earned, points_redeemed, status, business)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'completed',$18)
         RETURNING *`,
        [
          invoiceNo, shiftId, req.user.id, memberId, isCredit ? customer.id : null, isCredit, dueDate,
          paidAmount, paymentStatus, subtotal, itemDiscountTotal, txnDiscountInput,
          pointsValue, taxTotal, grandTotal, earned, pointsRedeemed, req.business,
        ]
      );
      const sale = saleResult.rows[0];

      // Simpan item + kurangi stok (FEFO per batch).
      for (const line of lines) {
        const itemResult = await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, unit_id, unit_name, qty, base_qty, unit_price, discount, cost_price, line_total, promo_id, tier_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            sale.id, line.product.id, line.unitId, line.unitName, line.qty, line.baseQty,
            line.unitPrice, line.discount, line.costPrice, line.lineTotal, line.promoId, line.tierId,
          ]
        );
        const saleItemId = itemResult.rows[0].id;

        // Alokasi batch FEFO (blokir batch kadaluarsa). Bila stok agregat tidak
        // cukup namun allow_negative_stock aktif, sisa dicatat sebagai shortfall
        // agar invariant SUM(qty_remaining) == stock_qty tetap terjaga.
        const allocations = await allocateFefo(client, {
          productId: line.product.id,
          qtyBase: line.baseQty,
          allowShortfall: allowNegativeStock,
          productName: line.product.name,
        });
        let allocatedQty = 0;
        for (const alloc of allocations) {
          await recordSaleItemBatch(client, {
            saleItemId,
            batchId: alloc.batchId,
            qty: alloc.qty,
            costPrice: alloc.costPrice,
          });
          allocatedQty += alloc.qty;
        }
        if (allocatedQty < line.baseQty) {
          await recordShortfall(client, {
            productId: line.product.id,
            qtyShortfall: line.baseQty - allocatedQty,
            unitCost: line.baseCostPrice,
            note: `Stok minus penjualan ${invoiceNo}`,
          });
        }

        await applyStockMovement(client, {
          productId: line.product.id,
          qtyChange: -line.baseQty,
          type: 'sale',
          refType: 'sale',
          refId: sale.id,
          unitCost: line.baseCostPrice,
          note: invoiceNo,
          userId: req.user.id,
          business: req.business,
          allowNegative: allowNegativeStock,
        });
      }

      // Simpan baris paket (product_id NULL, bundle_id terisi) dan kurangi stok
      // tiap komponen. Paket tidak masuk tier/promo item (harga tetap admin).
      for (const line of bundleLines) {
        const bundleItemResult = await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, bundle_id, unit_name, qty, base_qty, unit_price, discount, cost_price, line_total)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            sale.id, line.bundle.id, line.bundle.sku || 'PAKET', line.qty, line.qty,
            line.unitPrice, line.lineDiscount, line.costPrice, line.lineTotal,
          ]
        );
        const bundleSaleItemId = bundleItemResult.rows[0].id;

        // Mutasi stok per komponen; qty dasar = qty komponen (integer) * qty paket.
        const movements = new Map();
        for (const component of line.components) {
          const baseQty = component.qtyPerBundle * line.qty;
          const existing = movements.get(component.productId);
          movements.set(component.productId, {
            baseQty: (existing?.baseQty || 0) + baseQty,
            baseCostPrice: component.baseCostPrice,
            name: component.name,
          });
        }
        for (const [productId, mv] of movements) {
          const allocations = await allocateFefo(client, {
            productId,
            qtyBase: mv.baseQty,
            allowShortfall: allowNegativeStock,
            productName: mv.name,
          });
          let allocatedQty = 0;
          for (const alloc of allocations) {
            await recordSaleItemBatch(client, {
              saleItemId: bundleSaleItemId,
              batchId: alloc.batchId,
              qty: alloc.qty,
              costPrice: alloc.costPrice,
            });
            allocatedQty += alloc.qty;
          }
          if (allocatedQty < mv.baseQty) {
            await recordShortfall(client, {
              productId,
              qtyShortfall: mv.baseQty - allocatedQty,
              unitCost: mv.baseCostPrice,
              note: `Stok minus penjualan ${invoiceNo} (paket ${line.bundle.name})`,
            });
          }

          await applyStockMovement(client, {
            productId,
            qtyChange: -mv.baseQty,
            type: 'sale',
            refType: 'sale',
            refId: sale.id,
            unitCost: mv.baseCostPrice,
            note: `${invoiceNo} (paket ${line.bundle.name})`,
            userId: req.user.id,
            business: req.business,
            allowNegative: allowNegativeStock,
          });
        }
      }

      // Simpan pembayaran. Untuk kredit, uang muka (DP) dicatat di invoice_payments
      // agar kas shift TIDAK bertambah (expected_cash berbasis sale_payments).
      if (isCredit) {
        for (const payment of payments) {
          const amount = Math.round(Number(payment.amount));
          if (amount <= 0) continue;
          await client.query(
            `INSERT INTO invoice_payments (sale_id, amount, method, reference, user_id, note)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [sale.id, amount, payment.method, cleanString(payment.reference, 100), req.user.id, 'Uang muka']
          );
        }
      } else {
        for (const payment of payments) {
          await client.query(
            'INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES ($1, $2, $3, $4)',
            [sale.id, payment.method, Math.round(Number(payment.amount)), cleanString(payment.reference, 120)]
          );
        }
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

    if (idemKey && result?.sale?.id) {
      await pool.query(
        `INSERT INTO sale_idempotency (business, key, sale_id)
         VALUES ($1, $2, $3) ON CONFLICT (business, key) DO NOTHING`,
        [req.business, idemKey, result.sale.id]
      );
    }

    await logAudit(pool, {
      userId: req.user.id,
      action: 'checkout',
      entity: 'sales',
      entityId: result.sale.id,
      detail: {
        invoice_no: result.invoiceNo,
        grand_total: Number(result.sale.grand_total),
        is_credit: Boolean(result.sale.is_credit),
      },
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
router.get('/', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const cashierId = toInt(req.query.cashier_id, 0);
    const shiftId = toInt(req.query.shift_id, 0);
    const status = cleanString(req.query.status, 10);
    const method = cleanString(req.query.method, 10);
    const invoiceNo = cleanString(req.query.invoice_no, 40);

    // Penjualan dipisah per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ['s.business = $1'];
    const params = [req.business];
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
            b.name AS bundle_name, b.sku AS bundle_sku,
            ps.name AS service_name,
            COALESCE(p.name, b.name, ps.name) AS display_name,
            si.returned_qty
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     LEFT JOIN bundles b ON b.id = si.bundle_id
     LEFT JOIN print_services ps ON ps.id = si.service_id
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

router.get('/by-invoice/:invoiceNo', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const detail = await loadSaleDetail(pool, 'WHERE s.invoice_no = $1 AND s.business = $2', [req.params.invoiceNo, req.business]);
    if (!detail) throw new HttpError(404, 'Transaksi tidak ditemukan');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const detail = await loadSaleDetail(pool, 'WHERE s.id = $1 AND s.business = $2', [req.params.id, req.business]);
    if (!detail) throw new HttpError(404, 'Transaksi tidak ditemukan');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Void: hanya transaksi hari ini & shift belum ditutup
// =========================================================
router.post('/:id/void', requirePermission('pos.use'), async (req, res, next) => {
  try {
    const reason = cleanString(req.body?.reason, 300) || 'Tanpa alasan';

    const result = await withTransaction(async (client) => {
      const saleResult = await client.query('SELECT * FROM sales WHERE id = $1 AND business = $2 FOR UPDATE', [req.params.id, req.business]);
      const sale = saleResult.rows[0];
      if (!sale) throw new HttpError(404, 'Transaksi tidak ditemukan');
      if (sale.status === 'void') throw new HttpError(400, 'Transaksi sudah di-void');
      // Invoice kredit dikelola lewat modul Invoice Grosir (void dengan validasi
      // piutang). Tolak di jalur void penjualan biasa agar tidak ada kas dianggap kembali.
      if (sale.is_credit) {
        throw new HttpError(400, 'Invoice kredit di-void melalui halaman Invoice Grosir');
      }

      const todayCheck = await client.query(
        'SELECT ((created_at AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date) AS is_today FROM sales WHERE id = $1',
        [sale.id, APP_TIMEZONE]
      );
      if (!todayCheck.rows[0].is_today) {
        throw new HttpError(400, 'Hanya transaksi hari ini yang dapat di-void');
      }

      if (sale.shift_id) {
        const shift = await client.query('SELECT closed_at FROM shifts WHERE id = $1', [sale.shift_id]);
        if (shift.rows[0]?.closed_at) throw new HttpError(400, 'Shift sudah ditutup, transaksi tidak dapat di-void');
      }

      // Kembalikan stok seluruh item (produk & paket) memakai helper bersama.
      await restoreSaleStock(client, sale, { userId: req.user.id });

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

      return { sale: updated.rows[0] };
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

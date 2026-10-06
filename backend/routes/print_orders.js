const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { nextDocNumber } = require('../utils/invoice');
const { getSettingsFor } = require('../utils/settings');
const { extractTax } = require('../utils/money');
const { logAudit } = require('../utils/audit');
const { resolveItemsEffectivePricing } = require('../utils/item_pricing');
const { allocateFefo, recordSaleItemBatch, recordShortfall } = require('../utils/batches');
const { applyStockMovement } = require('../utils/stock');

const router = express.Router();

router.use(verifyJwt);

const PAYMENT_METHODS = new Set(['cash', 'qris', 'debit', 'transfer']);
const SIDES = new Set(['single', 'double']);
const STATUSES = ['queued', 'processing', 'ready', 'picked_up', 'cancelled'];
// Batas qty per baris produk, selaras dengan checkout minimarket (sales.js).
const MAX_LINE_QTY = 100000;

// Transisi status antrian. cancelled hanya dari antrean/proses (belum diambil).
const STATUS_FLOW = {
  queued: ['processing', 'cancelled'],
  processing: ['ready', 'cancelled'],
  ready: ['picked_up'],
  picked_up: [],
  cancelled: [],
};

const SELECT_ORDER = `
  SELECT po.*, c.name AS customer_customer_name, c.code AS customer_code,
         u.full_name AS creator_name, s.invoice_no, s.grand_total AS sale_grand_total
  FROM print_orders po
  LEFT JOIN customers c ON c.id = po.customer_id
  LEFT JOIN users u ON u.id = po.created_by
  LEFT JOIN sales s ON s.id = po.sale_id
`;

// =========================================================
// Kalkulator harga (dihitung di server, tidak dipercaya dari klien)
// =========================================================
// lembar = CEIL(halaman / sisi) * rangkap; sisi 'double' = 2 halaman per lembar.
// Harga: paket bila qty mencapai bundle_qty, selain itu per lembar (atau per
// halaman bila harga per lembar tidak diisi).
const computeLine = (service, raw) => {
  const pages = Math.round(Number(raw.pages));
  const copies = Math.round(Number(raw.copies ?? 1));
  if (!Number.isFinite(pages) || pages < 1) throw new HttpError(400, 'Jumlah halaman minimal 1');
  if (!Number.isFinite(copies) || copies < 1) throw new HttpError(400, 'Jumlah rangkap minimal 1');
  if (pages > 100000 || copies > 10000) throw new HttpError(400, 'Jumlah halaman/rangkap terlalu besar');

  const sides = SIDES.has(raw.sides) ? raw.sides : 'single';
  const sheets = Math.ceil(pages / (sides === 'double' ? 2 : 1)) * copies;

  const minQty = Number(service.min_qty) || 1;
  if (sheets < minQty) {
    throw new HttpError(400, `Minimal ${minQty} lembar untuk jasa ${service.name}`);
  }

  const pricePerSheet = Number(service.price_per_sheet) || 0;
  const pricePerPage = Number(service.price_per_page) || 0;
  const bundlePrice = service.bundle_price === null || service.bundle_price === undefined
    ? null : Number(service.bundle_price);
  const bundleQty = service.bundle_qty === null || service.bundle_qty === undefined
    ? null : Number(service.bundle_qty);

  const perSheet = pricePerSheet > 0 ? pricePerSheet : pricePerPage;
  let lineTotal;
  if (bundlePrice !== null && bundleQty && bundleQty > 0) {
    // Mode paket: qty < bundleQty tetap ditagih minimal 1 paket (bukan 0).
    const packs = Math.floor(sheets / bundleQty);
    const remainder = sheets % bundleQty;
    const remainderTotal = remainder * perSheet;
    // Bila tak ada harga satuan, sisa lembar dibulatkan ke paket berikutnya.
    lineTotal = packs * bundlePrice
      + (remainder > 0
        ? (perSheet > 0 ? remainderTotal : bundlePrice)
        : 0);
    if (packs === 0 && perSheet === 0 && sheets > 0) lineTotal = bundlePrice;
  } else if (pricePerSheet > 0) {
    lineTotal = sheets * pricePerSheet;
  } else {
    lineTotal = pages * copies * pricePerPage;
  }

  return {
    service_id: service.id,
    description: cleanString(raw.description, 200) || service.name,
    pages,
    copies,
    sides,
    paper_size: cleanString(raw.paper_size, 20) || service.paper_size || null,
    color_mode: cleanString(raw.color_mode, 10) || service.color_mode || null,
    unit_price: sheets > 0 ? Math.round(lineTotal / sheets) : 0,
    qty: sheets,
    line_total: lineTotal,
  };
};

// Bangun baris pesanan dari payload klien: kunci jasa/produk + hitung ulang harga.
// Satu pesanan boleh memuat baris jasa (fotokopi) dan baris produk (ATK). Harga
// produk memakai resolver yang sama dengan minimarket (normal/member/tier/promo)
// agar tidak ada dua sumber kebenaran. Stok TIDAK dicek/dikunci di sini — baru
// saat bayar (draft tidak boleh mengunci stok).
const buildLines = async (client, items, business) => {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Pesanan tanpa item');

  // Pisahkan baris jasa dan produk lebih awal; tandai `kind` agar payload
  // persisten & pembayaran memilih kolom yang tepat.
  const serviceRaws = [];
  const productRaws = [];
  for (const raw of items) {
    const productId = toInt(raw?.product_id, 0);
    if (productId > 0) {
      const qty = Math.round(Number(raw?.qty));
      if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'qty produk harus bilangan bulat positif');
      if (qty > MAX_LINE_QTY) throw new HttpError(400, `qty melebihi batas ${MAX_LINE_QTY}`);
      productRaws.push({ raw, productId, qty, unitId: toInt(raw?.unit_id, 0) || null });
    } else {
      serviceRaws.push(raw);
    }
  }

  if (serviceRaws.length === 0 && productRaws.length === 0) {
    throw new HttpError(400, 'Item pesanan tidak valid');
  }

  // --- Baris jasa ---
  const serviceIds = [...new Set(serviceRaws.map((i) => toInt(i?.service_id, 0)).filter((id) => id > 0))];
  const services = new Map();
  if (serviceIds.length > 0) {
    const servicesResult = await client.query(
      'SELECT * FROM print_services WHERE id = ANY($1::int[]) AND business = $2',
      [serviceIds, business]
    );
    servicesResult.rows.forEach((s) => services.set(s.id, s));
  }
  const serviceLines = serviceRaws.map((raw) => {
    const service = services.get(toInt(raw?.service_id, 0));
    if (!service) throw new HttpError(400, 'Jasa tidak ditemukan');
    if (!service.is_active) throw new HttpError(400, `Jasa ${service.name} tidak aktif`);
    return { ...computeLine(service, raw), kind: 'service' };
  });

  // --- Baris produk (ATK) ---
  const productLines = [];
  if (productRaws.length > 0) {
    // Kunci produk (FOR UPDATE) & pastikan milik usaha ini dan aktif.
    const lockedProducts = new Map();
    for (const item of productRaws) {
      if (lockedProducts.has(item.productId)) continue;
      const productResult = await client.query(
        'SELECT * FROM products WHERE id = $1 AND business = $2 FOR UPDATE',
        [item.productId, business]
      );
      const product = productResult.rows[0];
      if (!product) throw new HttpError(404, `Produk #${item.productId} tidak ditemukan`);
      if (!product.is_active) throw new HttpError(400, `Produk ${product.name} tidak aktif`);
      lockedProducts.set(item.productId, product);
    }

    const priced = await resolveItemsEffectivePricing(client, {
      items: productRaws.map((i) => ({ product_id: i.productId, unit_id: i.unitId, qty: i.qty })),
      // Mode fotokopi belum punya konsep member pada pesanan; pakai harga normal/tier/promo.
      isMember: false,
    });

    for (let idx = 0; idx < productRaws.length; idx += 1) {
      const { raw, productId, qty, unitId } = productRaws[idx];
      const pricedLine = priced[idx];
      const product = lockedProducts.get(productId);
      if (!pricedLine || pricedLine.unitMissing) throw new HttpError(400, 'Satuan produk tidak ditemukan');

      const unitPrice = pricedLine.effectivePrice;
      const conversionFactor = pricedLine.conversionFactor || 1;
      const baseQty = qty * conversionFactor;
      const grossLine = unitPrice * qty;
      const lineDiscount = Math.max(0, Math.round(Number(raw?.discount) || 0));
      if (lineDiscount > grossLine) throw new HttpError(400, `Diskon item ${product.name} melebihi harga`);

      productLines.push({
        kind: 'product',
        product_id: product.id,
        unit_id: unitId,
        unit_name: String(pricedLine.unitName || product.base_unit || '').slice(0, 20),
        description: cleanString(raw?.description, 200) || product.name,
        qty,
        base_qty: baseQty,
        unit_price: unitPrice,
        discount: lineDiscount,
        line_total: grossLine - lineDiscount,
        // HPP per satuan jual (laporan laba kotor memakai cost_price * qty).
        cost_price: Math.round(Number(product.cost_price) * conversionFactor),
        base_cost_price: Number(product.cost_price),
        promo_id: pricedLine.promoId,
        tier_id: pricedLine.tierId,
      });
    }
  }

  const lines = [...serviceLines, ...productLines];
  // subtotal pesanan = Σ line_total (sudah net diskon item). Diskon per baris
  // tetap disimpan (print_order_items.discount) dan dipakai saat bayar untuk
  // menulis sale_items/sales agar konsisten dengan checkout minimarket.
  const subtotal = lines.reduce((sum, line) => sum + line.line_total, 0);
  return { lines, subtotal };
};

// Simpan baris pesanan. Baris jasa mengisi service_id; baris produk mengisi
// product_id/unit_id/base_qty/cost_price. Kolom yang tidak relevan dikirim NULL.
const insertOrderItems = async (client, orderId, lines) => {
  for (const line of lines) {
    if (line.kind === 'product') {
      await client.query(
        `INSERT INTO print_order_items
          (order_id, product_id, unit_id, unit_name, description, unit_price, qty,
           base_qty, cost_price, base_cost_price, discount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [orderId, line.product_id, line.unit_id, line.unit_name, line.description,
          line.unit_price, line.qty, line.base_qty, line.cost_price, line.base_cost_price,
          line.discount, line.line_total]
      );
    } else {
      await client.query(
        `INSERT INTO print_order_items
          (order_id, service_id, description, pages, copies, sides, paper_size,
           color_mode, unit_price, qty, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, line.service_id, line.description, line.pages, line.copies, line.sides,
          line.paper_size, line.color_mode, line.unit_price, line.qty, line.line_total]
      );
    }
  }
};

// Pajak mengikuti pengaturan usaha (sama pola dengan checkout minimarket).
// `subtotal` sudah net diskon item (line_total); `discount` = diskon transaksi.
const applyTotals = (subtotal, discount, settings) => {
  if (discount > subtotal) throw new HttpError(400, 'Diskon melebihi subtotal');
  const payable = subtotal - discount;
  const rate = Number(settings?.tax_rate) || 0;
  if (settings?.tax_included) {
    const { taxTotal } = extractTax(payable, rate);
    return { taxTotal, grandTotal: payable };
  }
  const taxTotal = Math.round((payable * rate) / 100);
  return { taxTotal, grandTotal: payable + taxTotal };
};

// pg mengembalikan BIGINT sebagai string; samakan dengan gaya respon lain
// (angka) agar klien tidak perlu mengonversi saat menghitung.
const money = (value) => Number(value) || 0;

const toItemJson = (item) => ({
  ...item,
  unit_price: money(item.unit_price),
  line_total: money(item.line_total),
});

const toOrderJson = (order) => (order ? {
  ...order,
  subtotal: money(order.subtotal),
  discount: money(order.discount),
  tax_total: money(order.tax_total),
  grand_total: money(order.grand_total),
  paid_amount: money(order.paid_amount),
} : order);

const loadDetail = async (runner, id, business) => {
  const orderResult = await runner.query(
    `${SELECT_ORDER} WHERE po.id = $1 AND po.business = $2`,
    [id, business]
  );
  const order = orderResult.rows[0];
  if (!order) return null;
  const items = await runner.query(
    `SELECT poi.*,
            COALESCE(ps.name, p.name) AS display_name,
            ps.name AS service_name,
            p.name AS product_name,
            p.sku AS product_sku,
            ps.category
     FROM print_order_items poi
     LEFT JOIN print_services ps ON ps.id = poi.service_id
     LEFT JOIN products p ON p.id = poi.product_id
     WHERE poi.order_id = $1 ORDER BY poi.id`,
    [order.id]
  );
  return toOrderJson({ ...order, items: items.rows.map(toItemJson) });
};

// =========================================================
// Antrian aktif (layar operator) — sebelum /:id agar tidak tertangkap param.
// =========================================================
router.get('/queue', requirePermission('print.use', 'print.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `${SELECT_ORDER}
       WHERE po.status IN ('queued', 'processing', 'ready')
         AND po.business = $1
       ORDER BY po.queue_no DESC NULLS LAST, po.id DESC
       LIMIT 200`,
      [req.business]
    );
    res.json(result.rows.map(toOrderJson));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Daftar pesanan
// =========================================================
router.get('/', requirePermission('print.use', 'print.manage'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);
    const paymentStatus = cleanString(req.query.payment_status, 10);
    const search = cleanString(req.query.search, 100);

    const conditions = ['po.business = $1'];
    const params = [req.business];

    const statuses = String(req.query.status || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => STATUSES.includes(s));
    if (statuses.length > 0) {
      params.push(statuses);
      conditions.push(`po.status = ANY($${params.length}::varchar[])`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`po.created_at >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`po.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (paymentStatus === 'paid' || paymentStatus === 'unpaid' || paymentStatus === 'partial') {
      params.push(paymentStatus);
      conditions.push(`po.payment_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(po.code ILIKE $${params.length} OR po.customer_name ILIKE $${params.length})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM print_orders po ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${SELECT_ORDER} ${where} ORDER BY po.created_at DESC, po.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows.map(toOrderJson), countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Buat pesanan
// =========================================================
router.post('/', requirePermission('print.use'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const customerId = toInt(body.customer_id, 0) || null;
    const customerName = cleanString(body.customer_name, 150);
    const notes = cleanString(body.notes, 1000);
    const discount = Math.max(0, Math.round(Number(body.discount) || 0));
    const shiftId = toInt(body.shift_id, 0) || null;

    if (!customerId && !customerName) throw new HttpError(400, 'Pelanggan wajib diisi (pilih master atau tulis nama)');

    const settings = await getSettingsFor(req.business);
    if (!settings) throw new HttpError(500, 'Pengaturan usaha belum diinisialisasi');

    const result = await withTransaction(async (client) => {
      let resolvedName = customerName;
      if (customerId) {
        const customerResult = await client.query('SELECT * FROM customers WHERE id = $1 AND business = $2', [customerId, req.business]);
        const customer = customerResult.rows[0];
        if (!customer) throw new HttpError(404, 'Pelanggan tidak ditemukan');
        if (!customer.is_active) throw new HttpError(400, 'Pelanggan tidak aktif');
        resolvedName = resolvedName || customer.name;
      }

      const { lines, subtotal } = await buildLines(client, body.items, req.business);
      const { taxTotal, grandTotal } = applyTotals(subtotal, discount, settings);

      const code = await nextDocNumber(client, 'PRN');
      const queueNo = Number(code.split('-').pop());

      const orderResult = await client.query(
        `INSERT INTO print_orders
          (code, business, queue_no, customer_id, customer_name, notes, shift_id,
           subtotal, discount, tax_total, grand_total, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [code, req.business, queueNo, customerId, resolvedName, notes, shiftId,
          subtotal, discount, taxTotal, grandTotal, req.user.id]
      );
      const order = orderResult.rows[0];

      await insertOrderItems(client, order.id, lines);

      return order;
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'create',
      entity: 'print_orders',
      entityId: result.id,
      detail: { code: result.code, queue_no: result.queue_no },
    });

    res.status(201).json(await loadDetail(pool, result.id, req.business));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Detail
// =========================================================
router.get('/:id', requirePermission('print.use', 'print.manage'), async (req, res, next) => {
  try {
    const detail = await loadDetail(pool, req.params.id, req.business);
    if (!detail) throw new HttpError(404, 'Pesanan tidak ditemukan');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Ubah pesanan (hanya sebelum dibayar)
// =========================================================
router.put('/:id', requirePermission('print.use'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const settings = await getSettingsFor(req.business);

    await withTransaction(async (client) => {
      const current = await client.query('SELECT * FROM print_orders WHERE id = $1 AND business = $2 FOR UPDATE', [req.params.id, req.business]);
      const order = current.rows[0];
      if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
      if (order.payment_status !== 'unpaid') {
        throw new HttpError(400, 'Pesanan yang sudah dibayar tidak dapat diubah');
      }

      const customerId = toInt(body.customer_id, 0) || null;
      const customerName = cleanString(body.customer_name, 150);
      if (!customerId && !customerName) throw new HttpError(400, 'Pelanggan wajib diisi (pilih master atau tulis nama)');
      const notes = cleanString(body.notes, 1000);
      const discount = Math.max(0, Math.round(Number(body.discount) || 0));

      const { lines, subtotal } = await buildLines(client, body.items, req.business);
      const { taxTotal, grandTotal } = applyTotals(subtotal, discount, settings);

      await client.query(
        `UPDATE print_orders
         SET customer_id = $1, customer_name = $2, notes = $3, discount = $4,
             subtotal = $5, tax_total = $6, grand_total = $7, updated_at = NOW()
         WHERE id = $8`,
        [customerId, customerName, notes, discount, subtotal, taxTotal, grandTotal, order.id]
      );
      await client.query('DELETE FROM print_order_items WHERE order_id = $1', [order.id]);
      await insertOrderItems(client, order.id, lines);
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'print_orders',
      entityId: Number(req.params.id),
    });

    res.json(await loadDetail(pool, req.params.id, req.business));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Ubah status antrian
// =========================================================
router.put('/:id/status', requirePermission('print.use'), async (req, res, next) => {
  try {
    const nextStatus = cleanString(req.body?.status, 15);
    if (!STATUSES.includes(nextStatus)) throw new HttpError(400, 'Status tidak valid');

    const updated = await withTransaction(async (client) => {
      const current = await client.query('SELECT * FROM print_orders WHERE id = $1 AND business = $2 FOR UPDATE', [req.params.id, req.business]);
      const order = current.rows[0];
      if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
      if (!STATUS_FLOW[order.status].includes(nextStatus)) {
        throw new HttpError(400, `Tidak dapat mengubah status ${order.status} menjadi ${nextStatus}`);
      }
      const result = await client.query(
        'UPDATE print_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [nextStatus, order.id]
      );
      return result.rows[0];
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'status',
      entity: 'print_orders',
      entityId: Number(req.params.id),
      detail: { from: updated.status, to: nextStatus },
    });

    res.json(toOrderJson(updated));
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Bayar pesanan -> membuat sales (mode fotokopi) agar kas & laporan menyatu
// =========================================================
router.post('/:id/pay', requirePermission('print.use'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const shiftId = toInt(body.shift_id, 0);
    if (shiftId <= 0) throw new HttpError(400, 'shift_id wajib diisi');

    const settings = await getSettingsFor(req.business);
    if (!settings) throw new HttpError(500, 'Pengaturan usaha belum diinisialisasi');

    const result = await withTransaction(async (client) => {
      const current = await client.query('SELECT * FROM print_orders WHERE id = $1 AND business = $2 FOR UPDATE', [req.params.id, req.business]);
      const order = current.rows[0];
      if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan');
      if (order.payment_status === 'paid') throw new HttpError(400, 'Pesanan sudah dibayar');
      if (order.status === 'cancelled') throw new HttpError(400, 'Pesanan dibatalkan');

      const shiftResult = await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);
      const shift = shiftResult.rows[0];
      if (!shift) throw new HttpError(404, 'Shift tidak ditemukan');
      if (shift.closed_at) throw new HttpError(400, 'Shift sudah ditutup');
      if (shift.business !== req.business) throw new HttpError(400, 'Shift bukan milik usaha ini');
      if (!req.user.is_admin && shift.user_id !== req.user.id) {
        throw new HttpError(403, 'Shift ini bukan milik Anda');
      }

      const payments = Array.isArray(body.payments) && body.payments.length > 0
        ? body.payments
        : [{ method: body.method || 'cash', amount: body.amount ?? order.grand_total }];
      let paidTotal = 0;
      let cashTotal = 0;
      for (const payment of payments) {
        if (!PAYMENT_METHODS.has(payment?.method)) throw new HttpError(400, 'Metode pembayaran tidak valid');
        const amount = Math.round(Number(payment.amount));
        if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah pembayaran tidak valid');
        paidTotal += amount;
        if (payment.method === 'cash') cashTotal += amount;
      }
      const grandTotal = Number(order.grand_total);
      if (paidTotal < grandTotal) throw new HttpError(400, `Pembayaran kurang ${grandTotal - paidTotal}`);
      const change = paidTotal - grandTotal;
      if (change > cashTotal) throw new HttpError(400, 'Kelebihan bayar melebihi jumlah pembayaran tunai');

      const invoiceNo = await nextDocNumber(client, settings.invoice_prefix || 'INV');

      const items = await client.query(
        `SELECT poi.*, COALESCE(ps.name, p.name, poi.description) AS service_name
         FROM print_order_items poi
         LEFT JOIN print_services ps ON ps.id = poi.service_id
         LEFT JOIN products p ON p.id = poi.product_id
         WHERE poi.order_id = $1 ORDER BY poi.id`,
        [order.id]
      );
      if (items.rows.length === 0) throw new HttpError(400, 'Pesanan tanpa item');

      // Selaraskan pembukuan penjualan dengan checkout minimarket:
      // sales.subtotal = harga bruto (Σ line_total + diskon item),
      // sales.item_discount = Σ diskon baris. order.subtotal tetap net (dipakai
      // untuk tampilan nota pesanan), grand_total tidak berubah.
      const itemDiscount = items.rows.reduce((sum, it) => sum + Number(it.discount || 0), 0);
      const grossSubtotal = Number(order.subtotal) + itemDiscount;

      const saleResult = await client.query(
        `INSERT INTO sales
          (invoice_no, shift_id, cashier_id, customer_id, paid_amount, payment_status,
           subtotal, item_discount, txn_discount, tax_total, grand_total, business, status)
         VALUES ($1,$2,$3,$4,$5,'paid',$6,$7,$8,$9,$10,$11,'completed') RETURNING *`,
        [invoiceNo, shiftId, req.user.id, order.customer_id, grandTotal,
          grossSubtotal, itemDiscount, Number(order.discount),
          Number(order.tax_total), grandTotal, req.business]
      );
      const sale = saleResult.rows[0];

      // Stok produk divalidasi & dikurangi SAAT BAYAR (draft tidak mengunci stok).
      // Bila stok turun antara draft dan bayar, allocateFefo menolaknya dengan
      // pesan jelas; allow_negative_stock mengizinkan minus lewat shortfall.
      const allowNegativeStock = settings.allow_negative_stock === true;

      for (const item of items.rows) {
        if (item.product_id) {
          const inserted = await client.query(
            `INSERT INTO sale_items
              (sale_id, product_id, unit_id, unit_name, qty, base_qty, unit_price,
               discount, cost_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            // unit_name VARCHAR(20); nama satuan panjang dipangkas.
            [sale.id, item.product_id, item.unit_id, String(item.unit_name || '').slice(0, 20) || null,
              item.qty, item.base_qty, item.unit_price, Number(item.discount || 0),
              item.cost_price, Number(item.line_total)]
          );
          const saleItemId = inserted.rows[0].id;

          // Alokasi batch FEFO (blokir kadaluarsa), mirror checkout sales.js.
          const baseQty = Number(item.base_qty) || Number(item.qty);
          // HPP per satuan dasar. Pakai nilai yang disimpan saat buildLines agar
          // tidak terjadi drift pembulatan; fallback re-derivasi untuk data lama
          // yang belum punya base_cost_price.
          const baseCostPrice = Number(item.base_cost_price) || Math.round(
            Number(item.cost_price) / (baseQty / (Number(item.qty) || 1))
          );
          const allocations = await allocateFefo(client, {
            productId: item.product_id,
            qtyBase: baseQty,
            allowShortfall: allowNegativeStock,
            productName: item.description,
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
          if (allocatedQty < baseQty) {
            await recordShortfall(client, {
              productId: item.product_id,
              qtyShortfall: baseQty - allocatedQty,
              unitCost: baseCostPrice,
              note: `Stok minus pesanan ${order.code}`,
            });
          }

          await applyStockMovement(client, {
            productId: item.product_id,
            qtyChange: -baseQty,
            type: 'sale',
            refType: 'sale',
            refId: sale.id,
            unitCost: baseCostPrice,
            note: invoiceNo,
            userId: req.user.id,
            business: req.business,
            allowNegative: allowNegativeStock,
          });
          continue;
        }

        await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, service_id, unit_name, qty, base_qty, unit_price,
             discount, cost_price, line_total)
           VALUES ($1, NULL, $2, $3, $4, $4, $5, $6, 0, $7)`,
          // unit_name dibatasi 20 karakter (VARCHAR(20)); nama jasa panjang dipangkas.
          [sale.id, item.service_id, String(item.service_name || 'jasa').slice(0, 20),
            item.qty, item.unit_price, 0, Number(item.line_total)]
        );
      }

      for (const payment of payments) {
        await client.query(
          'INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES ($1, $2, $3, $4)',
          [sale.id, payment.method, Math.round(Number(payment.amount)), cleanString(payment.reference, 120)]
        );
      }

      const updated = await client.query(
        `UPDATE print_orders
         SET sale_id = $1, shift_id = $2, paid_amount = $3, payment_status = 'paid', updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [sale.id, shiftId, grandTotal, order.id]
      );

      return { order: updated.rows[0], sale, change };
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'pay',
      entity: 'print_orders',
      entityId: Number(req.params.id),
      detail: { sale_id: result.sale.id, invoice_no: result.sale.invoice_no },
    });

    res.status(201).json({ ...result, order: toOrderJson(result.order) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

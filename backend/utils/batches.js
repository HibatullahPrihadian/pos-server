const { HttpError } = require('../middleware/error');

// =========================================================
// Alokasi stok per-batch (FEFO: First-Expired-First-Out).
// =========================================================
// Semua fungsi di sini WAJIB dipanggil dengan client transaksi yang sama dengan
// perubahan `products.stock_qty` (via applyStockMovement), agar invariant
// SUM(stock_batches.qty_remaining) == products.stock_qty tetap terjaga.

// Pilih batch untuk konsumsi qtyBase (satuan dasar) secara FEFO.
// - Batch dengan expiry_date < CURRENT_DATE TIDAK dialokasikan (blokir kadaluarsa),
//   kecuali allowExpired = true.
// - Batch tanpa expiry_date (NULL, mis. legacy) dialokasikan paling akhir.
// Mengembalikan [{ batchId, qty, costPrice }] dan mengurangi qty_remaining.
const allocateFefo = async (client, {
  productId,
  qtyBase,
  allowExpired = false,
  allowShortfall = false,
  productName = null,
}) => {
  const qty = Math.round(Number(qtyBase) || 0);
  if (qty <= 0) return [];
  if (qty > 100000) throw new HttpError(400, `qty batch melebihi batas 100000`);

  const params = [productId];
  let expiryFilter = '';
  if (!allowExpired) {
    expiryFilter = 'AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)';
  }

  const rows = await client.query(
    `SELECT id, qty_remaining, unit_cost, expiry_date
     FROM stock_batches
     WHERE product_id = $1 AND qty_remaining > 0 ${expiryFilter}
     ORDER BY expiry_date NULLS LAST, received_at, id
     FOR UPDATE`,
    params
  );

  const allocations = [];
  let remaining = qty;
  for (const batch of rows.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.qty_remaining);
    if (take <= 0) continue;

    await client.query(
      'UPDATE stock_batches SET qty_remaining = qty_remaining - $1 WHERE id = $2',
      [take, batch.id]
    );

    allocations.push({
      batchId: batch.id,
      qty: take,
      costPrice: Number(batch.unit_cost),
      expiryDate: batch.expiry_date,
    });
    remaining -= take;
  }

  if (remaining > 0 && !allowShortfall) {
    // Tidak cukup batch valid. Bila ada batch kadaluarsa, beri pesan spesifik.
    let expiredQty = 0;
    if (!allowExpired) {
      const expired = await client.query(
        `SELECT COALESCE(SUM(qty_remaining), 0)::int AS qty
         FROM stock_batches
         WHERE product_id = $1 AND qty_remaining > 0 AND expiry_date < CURRENT_DATE`,
        [productId]
      );
      expiredQty = expired.rows[0]?.qty || 0;
    }
    const label = productName ? ` ${productName}` : '';
    if (expiredQty > 0) {
      throw new HttpError(
        400,
        `Stok${label} tersedia sudah kedaluwarsa (${expiredQty}), tidak dapat dijual`
      );
    }
    throw new HttpError(400, `Stok${label} tidak mencukupi (batch)`);
  }

  return allocations;
};

// Kembalikan qty ke batch asal (retur/void). Bila batch tidak ada, error jelas.
const restoreToBatch = async (client, { batchId, qty }) => {
  const amount = Math.round(Number(qty) || 0);
  if (amount <= 0) return;
  const result = await client.query(
    'UPDATE stock_batches SET qty_remaining = qty_remaining + $1 WHERE id = $2 RETURNING id',
    [amount, batchId]
  );
  if (!result.rows[0]) throw new HttpError(500, `Batch #${batchId} tidak ditemukan saat restore`);
};

// Buat batch baru (penerimaan/adjustment/opname/initial). expiryDate nullable.
const addBatch = async (client, {
  productId,
  qtyBase,
  unitCost = 0,
  expiryDate = null,
  batchCode = null,
  source = 'purchase',
  purchaseItemId = null,
  note = null,
}) => {
  const qty = Math.round(Number(qtyBase) || 0);
  if (qty <= 0) return null;
  const result = await client.query(
    `INSERT INTO stock_batches
       (product_id, batch_code, expiry_date, qty_received, qty_remaining, unit_cost, source, purchase_item_id, note)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8) RETURNING *`,
    [
      productId,
      batchCode,
      expiryDate || null,
      qty,
      Math.round(Number(unitCost) || 0),
      source,
      purchaseItemId,
      note,
    ]
  );
  return result.rows[0];
};

// Cari batch legacy (tanpa expiry) sebagai fallback data lama tanpa jejak batch.
const findLegacyBatch = async (client, { productId }) => {
  const result = await client.query(
    `SELECT id FROM stock_batches
     WHERE product_id = $1 AND source = 'legacy'
     ORDER BY id LIMIT 1`,
    [productId]
  );
  return result.rows[0]?.id || null;
};

// Ambil jejak alokasi batch untuk sebuah sale_item.
const listSaleItemBatches = async (client, saleItemId) => {
  const result = await client.query(
    'SELECT * FROM sale_item_batches WHERE sale_item_id = $1 ORDER BY id',
    [saleItemId]
  );
  return result.rows;
};

// Catat alokasi batch untuk sebuah sale_item.
const recordSaleItemBatch = async (client, { saleItemId, batchId, qty, costPrice }) => {
  await client.query(
    `INSERT INTO sale_item_batches (sale_item_id, batch_id, qty, cost_price)
     VALUES ($1, $2, $3, $4)`,
    [saleItemId, batchId, qty, Math.round(Number(costPrice) || 0)]
  );
};

// Catat kekurangan alokasi batch (shortfall) sebagai satu baris batch sintetis
// dengan qty_remaining negatif, sehingga invariant SUM(qty_remaining) == stock_qty
// tetap terjaga meski stok minus diizinkan. qtyShortfall > 0 = defisit sebesar itu.
const recordShortfall = async (client, { productId, qtyShortfall, unitCost = 0, note = null }) => {
  const deficit = Math.round(Number(qtyShortfall) || 0);
  if (deficit <= 0) return null;

  const existing = await client.query(
    `SELECT id, qty_remaining FROM stock_batches
     WHERE product_id = $1 AND source = 'shortfall'
     ORDER BY id LIMIT 1 FOR UPDATE`,
    [productId]
  );

  if (existing.rows[0]) {
    const updated = await client.query(
      `UPDATE stock_batches SET qty_remaining = qty_remaining - $1 WHERE id = $2 RETURNING *`,
      [deficit, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const result = await client.query(
    `INSERT INTO stock_batches
       (product_id, qty_received, qty_remaining, unit_cost, source, note)
     VALUES ($1, 0, $2, $3, 'shortfall', $4) RETURNING *`,
    [productId, -deficit, Math.round(Number(unitCost) || 0), note]
  );
  return result.rows[0];
};

// Kembalikan qty ke batch asal sebuah sale_item (retur/void), proporsional
// terhadap porsi tiap batch. Bila tidak ada jejak (data lama), fallback ke batch
// legacy. `qty` dalam satuan jual; alokasi tersimpan dalam satuan dasar.
// Dipakai bersama oleh routes/returns.js (retur) dan routes/sales.js (void).
const restoreSaleItemBatches = async (client, item, qty) => {
  const allocations = await listSaleItemBatches(client, item.id);
  if (allocations.length > 0) {
    const soldUnits = Number(item.qty) || 0;
    if (soldUnits <= 0) return;

    const allocTotal = allocations.reduce((sum, a) => sum + Number(a.qty), 0);
    if (allocTotal <= 0) return;

    let remaining = Math.round((allocTotal * qty) / soldUnits);
    if (remaining <= 0) return;
    const totalToRestore = remaining;

    for (let i = 0; i < allocations.length && remaining > 0; i += 1) {
      const alloc = allocations[i];
      const isLast = i === allocations.length - 1;
      const share = isLast
        ? remaining
        : Math.round((Number(alloc.qty) / allocTotal) * totalToRestore);
      const take = Math.min(remaining, Math.max(0, share));
      if (take > 0) {
        await restoreToBatch(client, { batchId: alloc.batch_id, qty: take });
        remaining -= take;
      }
    }
    return;
  }

  // Fallback data lama: batch legacy tiap produk terkait (satuan dasar).
  if (item.bundle_id) {
    const components = await client.query(
      'SELECT product_id, qty FROM bundle_items WHERE bundle_id = $1',
      [item.bundle_id]
    );
    for (const component of components.rows) {
      const legacyId = await findLegacyBatch(client, { productId: component.product_id });
      if (legacyId) {
        await restoreToBatch(client, { batchId: legacyId, qty: Math.round(component.qty * qty) });
      }
    }
    return;
  }

  const conversionFactor = item.qty > 0 ? item.base_qty / item.qty : 1;
  const legacyId = await findLegacyBatch(client, { productId: item.product_id });
  if (legacyId) {
    await restoreToBatch(client, { batchId: legacyId, qty: Math.round(conversionFactor * qty) });
  }
};

// Kembalikan stok seluruh item sebuah penjualan saat void (produk & paket).
// Dipakai bersama oleh void penjualan (sales.js) dan void invoice kredit
// (invoices.js) agar logika restock/HPP tidak menyimpang antar jalur.
// Hanya qty yang belum pernah diretur yang dikembalikan (retur sudah menambah stok).
const restoreSaleStock = async (client, sale, { userId = null, type = 'void' } = {}) => {
  const { applyStockMovement } = require('./stock');
  const note = `Void ${sale.invoice_no}`;
  const items = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);

  for (const item of items.rows) {
    const unreturnedQty = item.qty - item.returned_qty;
    if (unreturnedQty <= 0) continue;

    await restoreSaleItemBatches(client, item, unreturnedQty);

    if (item.bundle_id) {
      const components = await client.query(
        `SELECT bi.product_id, bi.qty, p.cost_price, p.name
         FROM bundle_items bi
         JOIN products p ON p.id = bi.product_id
         WHERE bi.bundle_id = $1`,
        [item.bundle_id]
      );
      for (const component of components.rows) {
        await applyStockMovement(client, {
          productId: component.product_id,
          qtyChange: component.qty * unreturnedQty,
          type,
          refType: 'sale',
          refId: sale.id,
          unitCost: Number(component.cost_price),
          note,
          userId,
          allowNegative: true,
        });
      }
      continue;
    }

    const unreturnedBaseQty = Math.round((item.base_qty / item.qty) * unreturnedQty);
    await applyStockMovement(client, {
      productId: item.product_id,
      qtyChange: unreturnedBaseQty,
      type,
      refType: 'sale',
      refId: sale.id,
      // cost_price tersimpan per satuan jual; kartu stok memakai satuan dasar.
      unitCost: Math.round(item.cost_price / (item.base_qty / item.qty)),
      note,
      userId,
      allowNegative: true,
    });
  }
};

module.exports = {
  allocateFefo,
  restoreToBatch,
  addBatch,
  findLegacyBatch,
  listSaleItemBatches,
  recordSaleItemBatch,
  recordShortfall,
  restoreSaleItemBatches,
  restoreSaleStock,
};

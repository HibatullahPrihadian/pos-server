const { HttpError } = require('../middleware/error');

// Terapkan perubahan stok secara atomik. WAJIB dipanggil dengan client transaksi.
// Melakukan SELECT ... FOR UPDATE pada baris produk sehingga dua kasir tidak bisa
// menjual unit terakhir secara bersamaan.
//
// Pembagian tanggung jawab agregat vs batch:
// - Fungsi ini HANYA mengubah agregat `products.stock_qty` + `stock_movements`.
//   Signature sengaja tidak diubah agar 10 call site tetap aman.
// - Perubahan batch (FEFO) dilakukan TERPISAH oleh pemanggil yang relevan lewat
//   `utils/batches.js` (allocateFefo/addBatch/restoreToBatch), dalam transaksi
//   yang sama. Invariant: SUM(stock_batches.qty_remaining) == products.stock_qty
//   (kecuali kasus stok minus / selisih penyesuaian).
const applyStockMovement = async (client, {
  productId,
  qtyChange,
  type,
  refType = null,
  refId = null,
  unitCost = null,
  note = null,
  userId = null,
  allowNegative = false,
  newCostPrice = undefined,
  business = null,
}) => {
  const locked = await client.query(
    'SELECT id, stock_qty, cost_price, name FROM products WHERE id = $1 FOR UPDATE',
    [productId]
  );
  const product = locked.rows[0];
  if (!product) throw new HttpError(404, `Produk #${productId} tidak ditemukan`);

  const balance = product.stock_qty + qtyChange;
  if (balance < 0 && !allowNegative) {
    throw new HttpError(400, `Stok ${product.name} tidak mencukupi (tersedia ${product.stock_qty})`);
  }

  if (newCostPrice === undefined) {
    await client.query('UPDATE products SET stock_qty = $1, updated_at = NOW() WHERE id = $2', [balance, productId]);
  } else {
    await client.query(
      'UPDATE products SET stock_qty = $1, cost_price = $2, updated_at = NOW() WHERE id = $3',
      [balance, newCostPrice, productId]
    );
  }

  // business: diisi pemanggil bila diketahui; jika null, DB memakai default
  // 'minimarket' (kompatibel dengan pemanggil lama). COALESCE menjaga NOT NULL.
  await client.query(
    `INSERT INTO stock_movements
      (product_id, qty_change, balance_after, type, ref_type, ref_id, unit_cost, note, user_id, business)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'minimarket'))`,
    [productId, qtyChange, balance, type, refType, refId, unitCost, note, userId, business]
  );

  return { balance, previousQty: product.stock_qty, previousCost: product.cost_price };
};

module.exports = { applyStockMovement };

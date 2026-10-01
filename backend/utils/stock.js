const { HttpError } = require('../middleware/error');

// Terapkan perubahan stok secara atomik. WAJIB dipanggil dengan client transaksi.
// Melakukan SELECT ... FOR UPDATE pada baris produk sehingga dua kasir tidak bisa
// menjual unit terakhir secara bersamaan.
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

  await client.query(
    `INSERT INTO stock_movements
      (product_id, qty_change, balance_after, type, ref_type, ref_id, unit_cost, note, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [productId, qtyChange, balance, type, refType, refId, unitCost, note, userId]
  );

  return { balance, previousQty: product.stock_qty, previousCost: product.cost_price };
};

module.exports = { applyStockMovement };

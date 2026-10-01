// Resolusi harga jual.
// Kandidat harga untuk satu baris item: harga normal, harga member, harga tier qty,
// dan harga promo. Prinsip: server memilih harga efektif TERENDAH dari kandidat
// yang valid (otomatis termurah). Tier/promo hanya boleh menurunkan harga.

const resolveUnit = async (client, { productId, unitId }) => {
  if (!unitId) return { unit: null, conversionFactor: 1 };
  const result = await client.query(
    'SELECT * FROM product_units WHERE id = $1 AND product_id = $2',
    [unitId, productId]
  );
  if (!result.rows[0]) return null;
  return { unit: result.rows[0], conversionFactor: result.rows[0].conversion_factor };
};

// Harga normal/member (tanpa tier & promo). Dipertahankan dengan signature lama
// agar pemanggil yang tidak butuh tier/promo tidak ikut berubah.
const resolvePrice = (product, unit, isMember) => {
  const normal = unit ? Number(unit.sell_price) : Number(product.sell_price);
  const member = unit ? unit.member_price : product.member_price;
  if (isMember && member !== null && member !== undefined) return Number(member);
  return normal;
};

// Versi batch: ambil semua tier untuk sekumpulan produk sekaligus (menghindari N+1),
// lalu pilih tier termurah yang berlaku per baris. Mengembalikan Map baris -> { price, tier }.
const resolveTierPricesForProducts = async (client, { productIds }) => {
  const ids = [...new Set((productIds || []).filter(Boolean).map(Number))];
  if (ids.length === 0) return new Map();
  const result = await client.query(
    `SELECT id, product_id, unit_id, min_qty, price
     FROM price_tiers
     WHERE product_id = ANY($1::int[])
     ORDER BY price ASC, min_qty DESC`,
    [ids]
  );
  const byProduct = new Map();
  for (const row of result.rows) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push(row);
  }
  return byProduct;
};

// Pilih tier termurah untuk satu baris dari daftar tier produk (hasil batch).
const pickTierForLine = ({ tiers, unitId, qty, normalPrice }) => {
  const q = Math.max(1, Math.round(Number(qty) || 1));
  let best = null;
  for (const row of tiers || []) {
    const rowUnit = row.unit_id === null || row.unit_id === undefined ? null : Number(row.unit_id);
    const lineUnit = unitId === null || unitId === undefined ? null : Number(unitId);
    if (rowUnit !== lineUnit) continue;
    if (Number(row.min_qty) > q) continue;
    const price = Number(row.price);
    if (normalPrice !== undefined && price >= normalPrice) continue;
    if (best === null || price < best.price) {
      best = { price, tier: { id: row.id, min_qty: row.min_qty, price } };
    }
  }
  return best;
};

// Harga efektif = min dari seluruh kandidat valid (normal, member, tier, promo).
// `candidates` boleh berisi null/undefined dan diabaikan.
const resolveEffectivePrice = ({ basePrice, tierPrice, promoPrice }) => {
  const values = [basePrice, tierPrice, promoPrice]
    .map((v) => (v === null || v === undefined ? null : Number(v)))
    .filter((v) => v !== null && Number.isFinite(v) && v >= 0);
  if (values.length === 0) return Number(basePrice);
  return Math.min(...values);
};

module.exports = { resolveUnit, resolvePrice, resolveTierPricesForProducts, pickTierForLine, resolveEffectivePrice };

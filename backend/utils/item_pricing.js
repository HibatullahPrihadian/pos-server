// Resolusi harga efektif untuk sekumpulan baris item dengan jumlah query tetap
// (menghindari N+1). Dipakai bersama oleh checkout (sales.js) dan pratinjau
// tampilan POS (/products/quote) agar hasilnya identik dan tidak menyimpang.

const { resolveUnit, resolvePrice, resolveTierPricesForProducts, pickTierForLine, resolveEffectivePrice } = require('./pricing');
const { findPromotionsForProducts, promoMatchesLine, resolveBestPromo } = require('./promotions');

// items: [{ product_id, unit_id, qty }]
// Mengembalikan array dengan bentuk yang sama + hasil resolusi:
// { product, unit, unitName, basePrice, effectivePrice, promoId, tierId, tierMinQty, promoName }
const resolveItemsEffectivePricing = async (client, { items, isMember }) => {
  const normalized = items.map((raw) => ({
    productId: Number(raw?.product_id) || 0,
    unitId: raw?.unit_id ? Number(raw.unit_id) : null,
    qty: Math.max(1, Math.round(Number(raw?.qty) || 1)),
  }));

  const productIds = normalized.map((i) => i.productId).filter((id) => id > 0);
  const productsResult = await client.query(
    'SELECT * FROM products WHERE id = ANY($1::int[])',
    [productIds.length ? productIds : [0]]
  );
  const productMap = new Map(productsResult.rows.map((p) => [p.id, p]));

  const categoryIds = [...new Set(productsResult.rows.map((p) => p.category_id).filter(Boolean))];

  const [tierMap, promos] = await Promise.all([
    resolveTierPricesForProducts(client, { productIds }),
    findPromotionsForProducts(client, { productIds, categoryIds }),
  ]);

  const results = [];
  for (const line of normalized) {
    const product = productMap.get(line.productId);
    if (!product) {
      results.push({ ...line, product: null });
      continue;
    }

    const resolved = await resolveUnit(client, { productId: line.productId, unitId: line.unitId });
    if (!resolved) {
      results.push({ ...line, product, unit: null, unitMissing: true });
      continue;
    }

    const basePrice = resolvePrice(product, resolved.unit, isMember);

    const tier = pickTierForLine({
      tiers: tierMap.get(line.productId),
      unitId: line.unitId,
      qty: line.qty,
      normalPrice: basePrice,
    });

    // Promo yang cocok: promo produk + promo kategori produk tersebut.
    const candidates = [
      ...(promos.byProduct.get(line.productId) || []),
      ...(promos.byCategory.get(product.category_id) || []),
    ].filter((promo) => promoMatchesLine(promo, { qty: line.qty, unitId: line.unitId }));

    const bestPromo = resolveBestPromo({ basePrice, promotions: candidates, qty: line.qty });

    const effectivePrice = resolveEffectivePrice({
      basePrice,
      tierPrice: tier ? tier.price : null,
      promoPrice: bestPromo ? bestPromo.price : null,
    });

    const promoId = bestPromo && bestPromo.price === effectivePrice && effectivePrice < basePrice
      ? bestPromo.promo.id
      : null;
    const tierId = !promoId && tier && tier.price === effectivePrice && effectivePrice < basePrice
      ? tier.tier.id
      : null;

    results.push({
      ...line,
      product,
      unit: resolved.unit,
      conversionFactor: resolved.conversionFactor,
      unitName: resolved.unit ? resolved.unit.unit_name : product.base_unit,
      basePrice,
      effectivePrice,
      promoId,
      tierId,
      promoName: promoId ? bestPromo.promo.name : null,
      tierMinQty: tierId ? tier.tier.min_qty : null,
    });
  }
  return results;
};

module.exports = { resolveItemsEffectivePricing };

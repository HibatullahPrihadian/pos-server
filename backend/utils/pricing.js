// Resolusi harga jual: harga member bila ada, fallback ke harga normal.
// Berlaku untuk satuan dasar maupun satuan tambahan (dus/karton).

const resolveUnit = async (client, { productId, unitId }) => {
  if (!unitId) return { unit: null, conversionFactor: 1 };
  const result = await client.query(
    'SELECT * FROM product_units WHERE id = $1 AND product_id = $2',
    [unitId, productId]
  );
  if (!result.rows[0]) return null;
  return { unit: result.rows[0], conversionFactor: result.rows[0].conversion_factor };
};

const resolvePrice = (product, unit, isMember) => {
  const normal = unit ? Number(unit.sell_price) : Number(product.sell_price);
  const member = unit ? unit.member_price : product.member_price;
  if (isMember && member !== null && member !== undefined) return Number(member);
  return normal;
};

module.exports = { resolveUnit, resolvePrice };

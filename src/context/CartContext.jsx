import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const CartContext = createContext();

// Item keranjang: { product_id, unit_id, unit_name, name, sku, price, qty, discount, stock_available, conversion_factor }
// Item paket: { bundle_id, name, sku, price, qty, discount, is_bundle: true }
const CartProvider = ({ children }) => {
  const [items, setItems] = useState([]);
  const [member, setMember] = useState(null);
  const [txnDiscount, setTxnDiscount] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(0);

  const keyOf = (item) =>
    item.bundle_id ? `bundle:${item.bundle_id}` : `${item.product_id}:${item.unit_id || 'base'}`;

  const addItem = useCallback((product, unit, price, qty = 1) => {
    const line = {
      product_id: product.id,
      unit_id: unit ? unit.id : null,
      unit_name: unit ? unit.unit_name : product.base_unit,
      name: product.name,
      sku: product.sku,
      price: Number(price),
      qty,
      discount: 0,
      stock_available: Number(product.stock_qty),
      conversion_factor: unit ? unit.conversion_factor : 1,
    };

    setItems((prev) => {
      const key = keyOf(line);
      const existing = prev.find((i) => keyOf(i) === key);
      if (existing) {
        return prev.map((i) => (keyOf(i) === key ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, line];
    });
  }, []);

  // Tambah paket ke keranjang. Harga paket tetap (tidak lewat resolver tier/promo).
  const addBundle = useCallback((bundle, qty = 1) => {
    const line = {
      bundle_id: bundle.id,
      is_bundle: true,
      name: bundle.name,
      sku: bundle.sku,
      price: Number(bundle.price),
      qty,
      discount: 0,
    };

    setItems((prev) => {
      const key = keyOf(line);
      const existing = prev.find((i) => keyOf(i) === key);
      if (existing) {
        return prev.map((i) => (keyOf(i) === key ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, line];
    });
  }, []);

  const updateQty = useCallback((productId, unitId, qty) => {
    const key = `${productId}:${unitId || 'base'}`;
    setItems((prev) =>
      prev
        .map((i) => (keyOf(i) === key ? { ...i, qty: Math.max(0, qty) } : i))
        .filter((i) => i.qty > 0)
    );
  }, []);

  // Update qty berdasarkan key kanonik (mendukung produk & paket).
  const updateQtyByKey = useCallback((key, qty) => {
    setItems((prev) =>
      prev
        .map((i) => (keyOf(i) === key ? { ...i, qty: Math.max(0, qty) } : i))
        .filter((i) => i.qty > 0)
    );
  }, []);

  const updateDiscount = useCallback((productId, unitId, discount) => {
    const key = `${productId}:${unitId || 'base'}`;
    setItems((prev) => prev.map((i) => (keyOf(i) === key ? { ...i, discount: Math.max(0, discount) } : i)));
  }, []);

  const updateDiscountByKey = useCallback((key, discount) => {
    setItems((prev) => prev.map((i) => (keyOf(i) === key ? { ...i, discount: Math.max(0, discount) } : i)));
  }, []);

  // Perbarui harga satuan + info promo/tier berdasarkan hasil kalkulasi server.
  // Server tetap penentu akhir saat checkout; ini hanya sinkronisasi tampilan.
  const applyQuotes = useCallback((quotes) => {
    if (!Array.isArray(quotes) || quotes.length === 0) return;
    const map = new Map(quotes.map((q) => [`${q.product_id}:${q.unit_id || 'base'}`, q]));
    setItems((prev) =>
      prev.map((i) => {
        if (i.bundle_id) return i;
        const q = map.get(keyOf(i));
        if (!q || !Number.isFinite(Number(q.effective_price))) return i;
        return {
          ...i,
          price: Number(q.effective_price),
          promo_name: q.promo_name || null,
          tier_min_qty: q.tier_min_qty || null,
        };
      })
    );
  }, []);

  const removeItem = useCallback((productId, unitId) => {
    const key = `${productId}:${unitId || 'base'}`;
    setItems((prev) => prev.filter((i) => keyOf(i) !== key));
  }, []);

  const removeItemByKey = useCallback((key) => {
    setItems((prev) => prev.filter((i) => keyOf(i) !== key));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setMember(null);
    setTxnDiscount(0);
    setRedeemPoints(0);
  }, []);

  // Hidrasi ulang keranjang dari snapshot hold/resume. Item di-deep-copy agar
  // tidak berbagi referensi dengan state lama. Harga dianggap display-only —
  // quote effect + checkout server tetap penentu akhir.
  const restore = useCallback((snapshot) => {
    const nextItems = Array.isArray(snapshot?.items)
      ? snapshot.items.map((i) => ({ ...i }))
      : [];
    setItems(nextItems);
    setMember(snapshot?.member || null);
    setTxnDiscount(Math.max(0, Number(snapshot?.txnDiscount) || 0));
    setRedeemPoints(Math.max(0, Math.round(Number(snapshot?.redeemPoints) || 0)));
  }, []);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const itemDiscount = items.reduce((sum, i) => sum + i.discount, 0);
    const afterItem = subtotal - itemDiscount;
    const afterTxn = Math.max(0, afterItem - txnDiscount);
    return { subtotal, itemDiscount, afterItem, afterTxn };
  }, [items, txnDiscount]);

  const value = {
    items,
    member,
    setMember,
    txnDiscount,
    setTxnDiscount,
    redeemPoints,
    setRedeemPoints,
    addItem,
    addBundle,
    updateQty,
    updateQtyByKey,
    updateDiscount,
    updateDiscountByKey,
    applyQuotes,
    removeItem,
    removeItemByKey,
    keyOf,
    clear,
    restore,
    totals,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart harus dipakai di dalam CartProvider');
  return context;
};

export default CartProvider;

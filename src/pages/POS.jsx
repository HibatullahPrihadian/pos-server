import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Plus, Minus, Trash2, ScanLine, ShoppingCart, UserPlus, X,
  Banknote, QrCode, CreditCard, Landmark, Printer, CheckCircle2, Coins,
  Percent,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import { useToastContext } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Receipt from '../components/receipt/Receipt';
import BarcodeScannerModal from '../components/scanner/BarcodeScannerModal';
import CameraScanButton from '../components/scanner/CameraScanButton';
import useDebounce from '../hooks/useDebounce';
import useHotkeys from '../hooks/useHotkeys';
import { formatCurrency, parseMoney, parseQty } from '../utils/formatters';
import { resolveBarcode as lookupBarcode } from '../utils/barcode';

const PAY_METHODS = [
  { key: 'cash', label: 'Tunai', icon: Banknote },
  { key: 'qris', label: 'QRIS', icon: QrCode },
  { key: 'debit', label: 'Debit/Kredit', icon: CreditCard },
  { key: 'transfer', label: 'Transfer', icon: Landmark },
];

const POS = () => {
  const toast = useToastContext();
  const { user, can } = useAuth();
  const canCreateMember = can('member.manage');
  const { settings } = useSettings();
  const cart = useCart();

  const [shift, setShift] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [openCash, setOpenCash] = useState('');

  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [expiringProducts, setExpiringProducts] = useState({});
  const [bundles, setBundles] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const barcodeRef = useRef(null);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const [dropdownRect, setDropdownRect] = useState(null);

  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberModal, setMemberModal] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', phone: '' });

  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState([{ method: 'cash', amount: '', reference: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [receiptSale, setReceiptSale] = useState(null);
  const [receiptChange, setReceiptChange] = useState(0);
  const [unitPicker, setUnitPicker] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [discountEditorKey, setDiscountEditorKey] = useState(null);

  const debouncedSearch = useDebounce(search, 300);
  const debouncedMemberSearch = useDebounce(memberSearch, 300);

  const dropdownVisible = searchOpen && debouncedSearch.trim().length > 0;

  // Dropdown hasil dirender lewat portal ke document.body agar lolos dari
  // stacking context `backdrop-filter` pada Card bar atas. Posisinya dihitung
  // dari rect kolom pencarian dan diperbarui saat scroll/resize.
  const updateDropdownRect = useCallback(() => {
    const el = searchRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    setDropdownRect({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + gap,
      bottom: openUp ? window.innerHeight - r.top + gap : undefined,
      maxHeight: Math.max(160, (openUp ? spaceAbove : spaceBelow) - gap - 8),
    });
  }, []);

  useLayoutEffect(() => {
    if (!dropdownVisible) { setDropdownRect(null); return; }
    updateDropdownRect();
    window.addEventListener('scroll', updateDropdownRect, true);
    window.addEventListener('resize', updateDropdownRect);
    return () => {
      window.removeEventListener('scroll', updateDropdownRect, true);
      window.removeEventListener('resize', updateDropdownRect);
    };
  }, [dropdownVisible, updateDropdownRect]);

  // Klik di luar dropdown/kolom pencarian menutup dropdown.
  useEffect(() => {
    if (!dropdownVisible) return;
    const onMouseDown = (event) => {
      const target = event.target;
      if (dropdownRef.current?.contains(target)) return;
      if (searchRef.current?.contains(target)) return;
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [dropdownVisible]);

  const loadShift = useCallback(async () => {
    setShiftLoading(true);
    try {
      const result = await api.get('/api/shifts/current');
      setShift(result.shift);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setShiftLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadShift(); }, [loadShift]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const [result, bundleResult] = await Promise.all([
        api.get('/api/products', {
          search: debouncedSearch,
          limit: 40,
        }),
        api.get('/api/bundles', { is_active: true, limit: 100 }).catch(() => ({ data: [] })),
      ]);
      setProducts(result.data);
      setBundles(bundleResult.data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingProducts(false);
    }
  }, [debouncedSearch, toast]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Petunjuk visual batch mendekati/melewati kadaluarsa (server tetap penentu saat checkout).
  useEffect(() => {
    api.get('/api/stock/expiring')
      .then((res) => {
        const map = {};
        (res.expiring || []).forEach((b) => { map[b.product_id] = b.is_expired ? 'expired' : 'soon'; });
        (res.expired || []).forEach((b) => { map[b.product_id] = 'expired'; });
        setExpiringProducts(map);
      })
      .catch(() => {});
  }, []);

  // Sinkronkan harga efektif (tier/promo/member) dan info promo/tier dari server.
  // Server tetap menghitung ulang saat checkout. Di-debounce + dibatalkan agar
  // perubahan qty cepat tidak membanjiri API.
  const quoteKey = JSON.stringify(cart.items.map((i) => [i.product_id, i.unit_id, i.qty]));
  useEffect(() => {
    if (cart.items.length === 0) return undefined;
    // Paket tidak di-quote (harga tetap); cukup produk biasa.
    const productItems = cart.items.filter((i) => !i.bundle_id);
    if (productItems.length === 0) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      const items = productItems.map((i) => ({
        product_id: i.product_id,
        unit_id: i.unit_id,
        qty: i.qty,
      }));
      api.post('/api/products/quote', { member_id: cart.member?.id || null, items })
        .then((quote) => { if (active) cart.applyQuotes(quote); })
        .catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
    // applyQuotes stabil (useCallback), sengaja tidak dimasukkan ke deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, cart.member?.id]);

  useEffect(() => {
    if (!debouncedMemberSearch) { setMemberResults([]); return; }
    api.get('/api/members', { search: debouncedMemberSearch, limit: 10 })
      .then((res) => setMemberResults(res.data))
      .catch(() => {});
  }, [debouncedMemberSearch]);

  // Bersihkan editor diskon bila item hilang (mis. qty turun ke 0) atau keranjang kosong.
  useEffect(() => {
    if (cart.items.length === 0) { setDiscountEditorKey(null); return; }
    if (discountEditorKey && !cart.items.some((i) => cart.keyOf(i) === discountEditorKey)) {
      setDiscountEditorKey(null);
    }
    // keyOf stabil; sengaja hanya bergantung pada daftar item & key editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.items, discountEditorKey]);

  const focusBarcode = useCallback(() => barcodeRef.current?.focus(), []);

  useEffect(() => {
    if (shift) focusBarcode();
  }, [shift, focusBarcode]);

  const addProduct = useCallback(
    (product, unit = null) => {
      const price = unit
        ? (cart.member && unit.member_price != null ? unit.member_price : unit.sell_price)
        : (cart.member && product.member_price != null ? product.member_price : product.sell_price);
      cart.addItem(product, unit, price, 1);
      focusBarcode();
    },
    [cart, focusBarcode]
  );

  const addBundleToCart = useCallback(
    (bundle) => {
      cart.addBundle(bundle, 1);
      toast.success(`${bundle.name} ditambahkan`);
      focusBarcode();
    },
    [cart, focusBarcode, toast]
  );

  // Resolusi satu kode barcode: produk dulu, lalu paket. Dipakai bersama oleh
  // scanner USB (tombol Enter) dan kamera, agar perilakunya identik. Pencarian
  // produk memakai util bersama (resolveBarcode) agar konsisten dengan halaman
  // lain; fallback paket khusus POS.
  const handleResolveBarcode = useCallback(async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) return;
    try {
      const { product, matchedUnit } = await lookupBarcode(code);
      if (matchedUnit) {
        addProduct(product, matchedUnit);
      } else {
        addProduct(product);
      }
      toast.success(`${product.name} ditambahkan`);
    } catch (err) {
      // Bukan produk: coba sebagai barcode paket.
      try {
        const bundleResult = await api.get(`/api/bundles/barcode/${encodeURIComponent(code)}`);
        addBundleToCart(bundleResult.bundle);
      } catch {
        toast.error(err.message);
      }
    }
  }, [addProduct, addBundleToCart, toast]);

  const handleBarcode = (event) => {
    if (event.key !== 'Enter') return;
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    handleResolveBarcode(code);
  };

  // Hasil kamera: jalur yang sama dengan USB, lalu fokus kembali ke kolom barcode.
  const handleCameraScan = useCallback((code) => {
    handleResolveBarcode(code);
    setScanOpen(false);
    focusBarcode();
  }, [handleResolveBarcode, focusBarcode]);

  const selectProduct = async (product) => {
    if (product.stock_qty <= 0) {
      toast.warning(`${product.name} stok habis`);
      return;
    }
    setSearch('');
    setSearchOpen(false);
    try {
      const units = await api.get(`/api/products/${product.id}/units`);
      if (units.length > 0) {
        // Produk multi-satuan: biarkan kasir memilih satuan via modal.
        setUnitPicker({ product, units });
      } else {
        addProduct(product);
      }
    } catch {
      addProduct(product);
    }
  };

  const selectBundle = (bundle) => {
    setSearch('');
    setSearchOpen(false);
    addBundleToCart(bundle);
  };

  const openPayment = () => {
    if (cart.items.length === 0) return toast.warning('Keranjang masih kosong');
    const total = estimatedTotal;
    setPayments([{ method: 'cash', amount: String(total), reference: '' }]);
    setPayOpen(true);
  };

  const openShift = async () => {
    try {
      const result = await api.post('/api/shifts/open', { opening_cash: parseMoney(openCash) });
      setShift(result);
      setOpenCash('');
      toast.success('Shift dibuka');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addNewMember = async () => {
    try {
      const member = await api.post('/api/members', newMember);
      cart.setMember(member);
      setNewMember({ name: '', phone: '' });
      setMemberModal(false);
      toast.success(`Member ${member.name} terdaftar`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const checkout = async () => {
    setSubmitting(true);
    try {
      const payload = {
        shift_id: shift.id,
        member_id: cart.member?.id || null,
        items: cart.items.map((item) => (
          item.bundle_id
            ? { bundle_id: item.bundle_id, qty: item.qty, discount: item.discount }
            : {
              product_id: item.product_id,
              unit_id: item.unit_id,
              qty: item.qty,
              discount: item.discount,
            }
        )),
        txn_discount: cart.txnDiscount,
        redeem_points: cart.redeemPoints,
        payments: payments
          .filter((p) => parseMoney(p.amount) > 0)
          .map((p) => ({ method: p.method, amount: parseMoney(p.amount), reference: p.reference })),
      };

      const result = await api.post('/api/sales', payload);
      const full = await api.get(`/api/sales/${result.sale.id}`);

      setReceiptSale(full);
      setReceiptChange(result.change);
      setPayOpen(false);
      cart.clear();
      setDiscountEditorKey(null);
      loadProducts();
      toast.success(`Transaksi ${result.sale.invoice_no} berhasil`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const printReceipt = () => window.print();

  useHotkeys({
    F2: () => searchRef.current?.focus(),
    F4: () => openPayment(),
    F8: () => { setPayments([{ method: 'cash', amount: String(estimatedTotal), reference: '' }]); setPayOpen(true); },
    Escape: () => {
      if (payOpen) setPayOpen(false);
      else if (unitPicker) setUnitPicker(null);
      else if (searchOpen) { setSearchOpen(false); setSearch(''); }
    },
  });

  // Perkiraan total di sisi klien (server tetap menghitung ulang saat checkout).
  const taxRate = Number(settings?.tax_rate || 0);
  const taxIncluded = settings?.tax_included !== false;
  const pointsValue = cart.redeemPoints * Number(settings?.point_value_rupiah || 0);
  const afterTxn = Math.max(0, cart.totals.afterTxn - Math.min(pointsValue, cart.totals.afterTxn));
  const estimatedTotal = taxIncluded
    ? afterTxn
    : Math.round(afterTxn + (afterTxn * taxRate) / 100);
  const estimatedTax = taxIncluded
    ? Math.round(afterTxn - afterTxn / (1 + taxRate / 100))
    : Math.round((afterTxn * taxRate) / 100);

  const paidTotal = payments.reduce((sum, p) => sum + parseMoney(p.amount), 0);
  const change = paidTotal - estimatedTotal;
  const maxRedeemable = Math.min(
    cart.member?.points || 0,
    Math.floor(cart.totals.afterTxn / Number(settings?.point_value_rupiah || 1))
  );

  if (shiftLoading) {
    return <div className="py-20 text-center text-slate-400">Memuat shift...</div>;
  }

  if (!shift) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <Card title="Buka Shift">
          <p className="text-sm text-slate-400 mb-4">
            Halo {user?.full_name}, masukkan kas awal untuk memulai shift sebelum bertransaksi.
          </p>
          <Input label="Kas Awal (Rp)" type="number" value={openCash} onChange={(e) => setOpenCash(e.target.value)} autoFocus />
          <Button className="w-full mt-4" onClick={openShift} size="lg">
            Buka Shift
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-140px)]">
      {/* Bar atas: scan + kamera + pencarian (dropdown hasil) */}
      <Card padded={false} className="shrink-0">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-green" />
              <input
                ref={barcodeRef}
                className="w-full bg-slate-950/60 border border-ios-green/40 rounded-ios-sm pl-10 pr-3 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-ios-green"
                placeholder="Scan barcode lalu Enter..."
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={handleBarcode}
              />
            </div>
            <CameraScanButton
              onClick={() => setScanOpen(true)}
              label="Kamera"
              className="shrink-0 px-3"
              size="lg"
            />
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                ref={searchRef}
                className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-10 pr-3 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
                placeholder="Cari produk (F2)..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => { if (search.trim()) setSearchOpen(true); }}
              />
              {searchOpen && debouncedSearch.trim().length > 0 && (
                <SearchResults
                  anchorRect={dropdownRect}
                  containerRef={dropdownRef}
                  loading={loadingProducts}
                  products={products}
                  bundles={bundles}
                  query={debouncedSearch}
                  member={cart.member}
                  expiringProducts={expiringProducts}
                  onSelectProduct={selectProduct}
                  onSelectBundle={selectBundle}
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Keranjang: mengisi penuh sisa tinggi 1 kolom */}
      <Card
        padded={false}
        className="flex flex-col overflow-hidden flex-1 min-h-0"
        bodyClassName="flex flex-col flex-1 min-h-0 overflow-hidden"
      >
        <div className="p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <ShoppingCart size={18} /> Keranjang ({cart.items.length})
            </h3>
            {cart.items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setDiscountEditorKey(null); cart.clear(); }}>
                <Trash2 size={14} /> Kosongkan
              </Button>
            )}
          </div>

          {cart.member ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-ios-sm bg-ios-purple/10 border border-ios-purple/30">
              <div>
                <div className="text-sm text-white">{cart.member.name}</div>
                <div className="text-xs text-ios-yellow flex items-center gap-1">
                  <Coins size={12} /> {cart.member.points} poin
                </div>
              </div>
              <button onClick={() => { cart.setMember(null); cart.setRedeemPoints(0); }} className="p-1 hover:bg-white/10 rounded">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="neutral" size="sm" className="flex-1" onClick={() => setMemberModal(true)}>
                <UserPlus size={14} /> Pilih Member
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
          {cart.items.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Scan barcode atau cari produk untuk memulai
            </div>
          ) : (
            cart.items.map((item) => {
              const key = cart.keyOf(item);
              const editorOpen = discountEditorKey === key;
              return (
                <div key={key} className="bg-white/5 rounded-ios-sm px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{item.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 truncate">
                        <span className="shrink-0">{formatCurrency(item.price)} / {item.bundle_id ? 'paket' : item.unit_name}</span>
                        {item.bundle_id && <span className="shrink-0 text-ios-purple font-medium">PAKET</span>}
                        {item.promo_name && <span className="truncate text-ios-red font-medium">PROMO: {item.promo_name}</span>}
                        {item.tier_min_qty && <span className="shrink-0 text-ios-green font-medium">Grosir (min {item.tier_min_qty})</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => cart.updateQtyByKey(key, item.qty - 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-white"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        className="w-10 text-center bg-slate-950/60 border border-white/10 rounded py-1 text-sm text-white"
                        value={item.qty}
                        onChange={(e) => cart.updateQtyByKey(key, parseQty(e.target.value))}
                      />
                      <button
                        onClick={() => cart.updateQtyByKey(key, item.qty + 1)}
                        className="w-7 h-7 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-white"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="text-right shrink-0 w-24">
                      <div className="text-sm text-white font-medium">
                        {formatCurrency(item.price * item.qty - item.discount)}
                      </div>
                      {item.discount > 0 && (
                        <div className="text-[10px] text-ios-orange">-{formatCurrency(item.discount)}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setDiscountEditorKey(editorOpen ? null : key)}
                      title="Diskon item"
                      className={`p-1 rounded shrink-0 ${item.discount > 0 ? 'text-ios-orange bg-ios-orange/15' : 'text-slate-400 hover:bg-white/10'}`}
                    >
                      <Percent size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (discountEditorKey === key) setDiscountEditorKey(null);
                        cart.removeItemByKey(key);
                      }}
                      className="p-1 hover:bg-white/10 rounded text-ios-red shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {editorOpen && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">Diskon item</span>
                      <input
                        type="number"
                        className="w-24 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-white text-right"
                        value={item.discount || ''}
                        placeholder="0"
                        onChange={(e) => cart.updateDiscountByKey(key, parseMoney(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Bar ringkasan total sticky di bawah, selalu terlihat */}
      <Card
        className="shrink-0"
        bodyClassName="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Subtotal</span>
            <span className="text-white">{formatCurrency(cart.totals.subtotal)}</span>
          </div>
          {cart.totals.itemDiscount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Diskon Item</span>
              <span className="text-ios-orange">-{formatCurrency(cart.totals.itemDiscount)}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Diskon Transaksi</span>
            <input
              type="number"
              className="w-28 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-sm text-white text-right"
              value={cart.txnDiscount || ''}
              placeholder="0"
              onChange={(e) => cart.setTxnDiscount(parseMoney(e.target.value))}
            />
          </div>
          {cart.member && maxRedeemable > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Tukar Poin (maks {maxRedeemable})</span>
              <input
                type="number"
                className="w-28 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-sm text-white text-right"
                value={cart.redeemPoints || ''}
                placeholder="0"
                max={maxRedeemable}
                onChange={(e) => cart.setRedeemPoints(Math.min(maxRedeemable, parseQty(e.target.value)))}
              />
            </div>
          )}
          {cart.redeemPoints > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Nilai Poin</span>
              <span className="text-ios-purple">-{formatCurrency(Math.min(pointsValue, cart.totals.afterTxn))}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">PPN {taxIncluded ? '(incl.)' : ''}</span>
            <span className="text-white">{formatCurrency(estimatedTax)}</span>
          </div>
        </div>

        <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span className="text-white font-semibold">TOTAL</span>
            <span className="text-3xl font-bold text-ios-green">{formatCurrency(estimatedTotal)}</span>
          </div>
          <Button size="lg" variant="success" onClick={openPayment} disabled={cart.items.length === 0}>
            <Banknote size={18} /> Bayar (F4)
          </Button>
        </div>
      </Card>

      {/* Modal pemindai kamera */}
      <BarcodeScannerModal
        isOpen={scanOpen}
        onClose={() => { setScanOpen(false); focusBarcode(); }}
        onDetect={handleCameraScan}
      />

      {/* Modal pilih satuan */}
      <Modal isOpen={Boolean(unitPicker)} onClose={() => setUnitPicker(null)} title={unitPicker?.product?.name} size="sm">
        <div className="space-y-2">
          <button
            onClick={() => { addProduct(unitPicker.product); setUnitPicker(null); }}
            className="w-full flex justify-between items-center px-4 py-3 bg-white/5 rounded-ios-sm hover:bg-white/10"
          >
            <span className="text-white">1 {unitPicker?.product?.base_unit}</span>
            <span className="text-ios-green">
              {formatCurrency(cart.member && unitPicker?.product?.member_price != null ? unitPicker.product.member_price : unitPicker?.product?.sell_price)}
            </span>
          </button>
          {unitPicker?.units.map((unit) => (
            <button
              key={unit.id}
              onClick={() => { addProduct(unitPicker.product, unit); setUnitPicker(null); }}
              className="w-full flex justify-between items-center px-4 py-3 bg-white/5 rounded-ios-sm hover:bg-white/10"
            >
              <span className="text-white">1 {unit.unit_name} (x{unit.conversion_factor})</span>
              <span className="text-ios-green">
                {formatCurrency(cart.member && unit.member_price != null ? unit.member_price : unit.sell_price)}
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Modal pilih member */}
      <Modal isOpen={memberModal} onClose={() => setMemberModal(false)} title="Member" size="sm">
        <Input label="Cari Member" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Nama / kode / telepon..." autoFocus />
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {memberResults.map((member) => (
            <button
              key={member.id}
              onClick={() => { cart.setMember(member); setMemberModal(false); setMemberSearch(''); }}
              className="w-full flex justify-between items-center px-3 py-2 bg-white/5 rounded-ios-sm hover:bg-white/10"
            >
              <div className="text-left">
                <div className="text-sm text-white">{member.name}</div>
                <div className="text-xs text-slate-500 font-mono">{member.code}</div>
              </div>
              <span className="text-xs text-ios-yellow flex items-center gap-1">
                <Coins size={12} /> {member.points}
              </span>
            </button>
          ))}
          {memberSearch && memberResults.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Member tidak ditemukan</p>
          )}
        </div>

        {canCreateMember && (
          <div className="border-t border-white/10 mt-4 pt-4">
            <p className="text-sm font-medium text-white mb-2">Daftar Member Baru</p>
            <div className="space-y-2">
              <Input label="Nama" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} />
              <Input label="Telepon" value={newMember.phone} onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })} />
              <Button className="w-full" onClick={addNewMember} disabled={!newMember.name}>
                <UserPlus size={16} /> Daftarkan
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal pembayaran */}
      <Modal
        isOpen={payOpen}
        onClose={() => setPayOpen(false)}
        title="Pembayaran"
        size="md"
        footer={
          <div className="flex justify-between items-center">
            <div className="text-sm">
              <div className="text-slate-400">Total</div>
              <div className="text-xl font-bold text-white">{formatCurrency(estimatedTotal)}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={() => setPayOpen(false)}>Batal</Button>
              <Button variant="success" onClick={checkout} disabled={submitting || paidTotal < estimatedTotal}>
                <CheckCircle2 size={16} /> {submitting ? 'Memproses...' : 'Bayar & Simpan'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {PAY_METHODS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setPayments([{ method: key, amount: String(estimatedTotal), reference: '' }])}
                className={`flex flex-col items-center gap-1 py-3 rounded-ios-sm text-xs transition-colors ${payments.length === 1 && payments[0].method === key ? 'bg-ios-blue text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {payments.map((payment, index) => (
              <div key={index} className="flex gap-2 items-end">
                <Input
                  as="select"
                  label={index === 0 ? 'Metode' : ''}
                  className="w-32"
                  value={payment.method}
                  onChange={(e) => setPayments(payments.map((p, i) => (i === index ? { ...p, method: e.target.value } : p)))}
                >
                  {PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </Input>
                <Input
                  label={index === 0 ? 'Jumlah' : ''}
                  type="number"
                  className="flex-1"
                  value={payment.amount}
                  onChange={(e) => setPayments(payments.map((p, i) => (i === index ? { ...p, amount: e.target.value } : p)))}
                />
                {payments.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setPayments(payments.filter((_, i) => i !== index))}>
                    <Trash2 size={14} className="text-ios-red" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center">
            <Button
              variant="neutral"
              size="sm"
              onClick={() => setPayments([...payments, { method: 'qris', amount: '', reference: '' }])}
            >
              <Plus size={14} /> Split Pembayaran
            </Button>
            {['cash', 'qris', 'debit', 'transfer'].includes(payments[0]?.method) && payments.length === 1 && (
              <div className="flex gap-1">
                {[50000, 100000, 150000, 200000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setPayments([{ ...payments[0], amount: String(amount) }])}
                    className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-slate-300"
                  >
                    {amount / 1000}rb
                  </button>
                ))}
              </div>
            )}
          </div>

          {payments.some((p) => p.method === 'qris') && settings?.qris_image_path && (
            <div className="flex flex-col items-center p-3 bg-white rounded-ios-sm">
              <img src={settings.qris_image_path} alt="QRIS" className="w-48 h-48 object-contain" />
              <p className="text-xs text-slate-700 mt-2">Scan QRIS lalu konfirmasi pembayaran diterima</p>
            </div>
          )}

          <div className="p-3 rounded-ios-sm bg-white/5 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Dibayar</span>
              <span className="text-white">{formatCurrency(paidTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{change >= 0 ? 'Kembalian' : 'Kurang'}</span>
              <span className={change >= 0 ? 'text-ios-green font-semibold' : 'text-ios-red font-semibold'}>
                {formatCurrency(Math.abs(change))}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal struk setelah transaksi */}
      <Modal
        isOpen={Boolean(receiptSale)}
        onClose={() => setReceiptSale(null)}
        title="Transaksi Berhasil"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setReceiptSale(null)}>Tutup</Button>
            <Button onClick={printReceipt}><Printer size={16} /> Cetak Struk</Button>
          </div>
        }
      >
        {receiptSale && (
          <>
            <div className="flex items-center gap-2 mb-4 text-ios-green">
              <CheckCircle2 size={20} />
              <span className="font-medium">{receiptSale.invoice_no}</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto bg-white rounded-ios-sm p-2">
              <Receipt sale={receiptSale} settings={settings} change={receiptChange} />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

// Dropdown hasil pencarian: produk + paket. Muncul saat kasir mengetik dan
// menggantikan grid katalog yang dihapus. Produk multi-satuan tetap lewat
// selectProduct (unit picker), produk stok 0 tidak bisa ditambahkan.
const SearchResults = ({ anchorRect, containerRef, loading, products, bundles, query, member, expiringProducts, onSelectProduct, onSelectBundle }) => {
  const q = String(query || '').trim().toLowerCase();
  const shownBundles = loading
    ? []
    : bundles.filter((b) => !q || b.name?.toLowerCase().includes(q) || b.sku?.toLowerCase().includes(q));
  const shownProducts = products;
  const hasResults = shownProducts.length > 0 || shownBundles.length > 0;
  if (!anchorRect) return null;
  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: anchorRect.left,
        width: anchorRect.width,
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        maxHeight: anchorRect.maxHeight,
      }}
      className="z-50 overflow-y-auto bg-slate-900 border border-white/15 rounded-ios-sm shadow-xl backdrop-blur-glass"
    >
      {loading && !hasResults && (
        <div className="px-4 py-6 text-center text-sm text-slate-400">Mencari...</div>
      )}
      {!loading && !hasResults && (
        <div className="px-4 py-6 text-center text-sm text-slate-500">Produk tidak ditemukan</div>
      )}

      {shownBundles.length > 0 && (
        <div>
          <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-ios-purple">Paket</div>
          {shownBundles.map((bundle) => (
            <button
              key={`bundle-${bundle.id}`}
              onClick={() => onSelectBundle(bundle)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/10"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate flex items-center gap-2">
                  {bundle.name}
                  <Badge tone="purple">PAKET</Badge>
                </div>
                <div className="text-xs text-slate-500 font-mono">{bundle.sku}</div>
              </div>
              <span className="text-ios-green font-semibold text-sm">{formatCurrency(bundle.price)}</span>
            </button>
          ))}
        </div>
      )}

      {shownProducts.length > 0 && (
        <div>
          <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-ios-blue">Produk</div>
          {shownProducts.map((product) => {
            const price = member && product.member_price != null ? product.member_price : product.sell_price;
            const out = product.stock_qty <= 0;
            const expiryFlag = expiringProducts[product.id];
            return (
              <button
                key={`product-${product.id}`}
                onClick={() => onSelectProduct(product)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {product.name}
                    {expiryFlag === 'expired' && <Badge tone="red">Kadaluarsa</Badge>}
                    {expiryFlag === 'soon' && <Badge tone="orange">Segera</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
                    {product.sku}
                    <span className={out ? 'text-ios-red' : 'text-slate-500'}>
                      {out ? 'stok habis' : `stok ${product.stock_qty}`}
                    </span>
                  </div>
                </div>
                <span className="text-ios-green font-semibold text-sm">{formatCurrency(price)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  );
};

export default POS;

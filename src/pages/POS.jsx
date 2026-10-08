import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Plus, Minus, Trash2, ScanLine, ShoppingCart, UserPlus, X,
  Banknote, QrCode, CreditCard, Landmark, Printer, CheckCircle2, Coins,
  Percent, Building2, PauseCircle, ListChecks,
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
import ConfirmDialog from '../components/ui/ConfirmDialog';
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

const TERM_OPTIONS = [0, 7, 14, 30, 60];

const POS = () => {
  const toast = useToastContext();
  const { user, can } = useAuth();
  const canCreateMember = can('member.manage');
  const canCredit = can('invoice.manage');
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
  const unitPickerRef = useRef(null);
  const payRef = useRef(null);
  const [dropdownRect, setDropdownRect] = useState(null);

  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberModal, setMemberModal] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', phone: '' });

  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState([{ method: 'cash', amount: '', reference: '' }]);
  const [creditMode, setCreditMode] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [payTerm, setPayTerm] = useState('30');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receiptSale, setReceiptSale] = useState(null);
  const [receiptChange, setReceiptChange] = useState(0);
  const [unitPicker, setUnitPicker] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [discountEditorKey, setDiscountEditorKey] = useState(null);
  const [selectedItemKey, setSelectedItemKey] = useState(null);

  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [unitActiveIndex, setUnitActiveIndex] = useState(0);
  const [memberActiveIndex, setMemberActiveIndex] = useState(0);
  const [clearCartOpen, setClearCartOpen] = useState(false);

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdsOpen, setHoldsOpen] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [holdNote, setHoldNote] = useState('');
  const [holdSaving, setHoldSaving] = useState(false);
  const [holdsList, setHoldsList] = useState([]);
  const [holdsLoading, setHoldsLoading] = useState(false);
  const [holdsError, setHoldsError] = useState(null);
  const [resumeHolding, setResumeHolding] = useState(null);
  const [confirmResume, setConfirmResume] = useState(null);

  const debouncedSearch = useDebounce(search, 300);
  const debouncedMemberSearch = useDebounce(memberSearch, 300);

  const dropdownVisible = searchOpen && debouncedSearch.trim().length > 0;

  // Hasil dropdown untuk navigasi keyboard: urut = paket dulu, lalu produk
  // (identik dengan urutan render di SearchResults).
  const searchQuery = debouncedSearch.trim().toLowerCase();
  const visibleBundles = loadingProducts
    ? []
    : bundles.filter((b) => !searchQuery || b.name?.toLowerCase().includes(searchQuery) || b.sku?.toLowerCase().includes(searchQuery));
  const visibleProducts = products;
  const searchFlat = [
    ...visibleBundles.map((b) => ({ kind: 'bundle', item: b })),
    ...visibleProducts.map((p) => ({ kind: 'product', item: p })),
  ];

  useEffect(() => {
    setSearchActiveIndex(searchFlat.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, products, bundles, loadingProducts]);

  useEffect(() => {
    setMemberActiveIndex(0);
  }, [debouncedMemberSearch, memberResults]);

  useEffect(() => {
    if (unitPicker) {
      setUnitActiveIndex(0);
      // Fokus ke wrapper modal agar handler ↑/↓/Enter/1–9 menerima event
      // keyboard tanpa perlu klik dulu (event bubble dari elemen yang fokus).
      unitPickerRef.current?.focus();
    }
  }, [unitPicker]);

  useEffect(() => {
    // Sama seperti modal satuan: shortcut 1–4 payment butuh fokus di dalam
    // modal; guard isField di handlePaymentKeyDown tetap melindungi ketikan
    // saat fokus pindah ke input nominal.
    if (payOpen) payRef.current?.focus();
  }, [payOpen]);

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

  // Pelanggan grosir (dropdown) hanya dimuat saat mode kredit aktif.
  useEffect(() => {
    if (!creditMode) return;
    api.get('/api/customers', { is_active: true, limit: 200 })
      .then((res) => setCustomers(res.data))
      .catch(() => {});
  }, [creditMode]);

  // Bersihkan editor diskon bila item hilang (mis. qty turun ke 0) atau keranjang kosong.
  useEffect(() => {
    if (cart.items.length === 0) {
      setDiscountEditorKey(null);
      setSelectedItemKey(null);
      return;
    }
    if (discountEditorKey && !cart.items.some((i) => cart.keyOf(i) === discountEditorKey)) {
      setDiscountEditorKey(null);
    }
    if (selectedItemKey && !cart.items.some((i) => cart.keyOf(i) === selectedItemKey)) {
      setSelectedItemKey(null);
    }
    // keyOf stabil; sengaja hanya bergantung pada daftar item & key editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.items, discountEditorKey, selectedItemKey]);

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
    // Jangan tambah produk di balik modal terbuka (Tab bisa mencapai kolom
    // barcode yang tidak ter-trap; scanner tetap aman karena butuh Enter).
    if (holdOpen || holdsOpen || receiptSale || memberModal || payOpen
      || unitPicker || scanOpen || clearCartOpen || confirmResume) return;
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
    if (!shift) return;
    if (cart.items.length === 0) return toast.warning('Keranjang masih kosong');
    // Jangan tumpuk modal: biarkan Esc mengurai overlay yang sudah terbuka.
    if (cartOverlaysOpen) return;
    const total = estimatedTotal;
    setPayments([{ method: 'cash', amount: String(total), reference: '' }]);
    setCreditMode(false);
    setCustomerId('');
    setPayTerm('30');
    setDueDate('');
    setPayOpen(true);
  };

  const selectCreditCustomer = (id) => {
    setCustomerId(id);
    const selected = customers.find((c) => String(c.id) === String(id));
    if (selected) setPayTerm(String(selected.payment_term_days ?? 0));
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

  // Ref anti double-submit: state `submitting` belum ter-update pada
  // klik/Enter kedua yang datang sebelum re-render berikutnya.
  const submittingRef = useRef(false);

  const checkout = async () => {
    if (submittingRef.current) return;
    if (creditMode && !customerId) return toast.warning('Pilih pelanggan grosir untuk penjualan kredit');
    submittingRef.current = true;
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
        is_credit: creditMode,
        customer_id: creditMode ? Number(customerId) : null,
        due_date: creditMode && dueDate ? dueDate : undefined,
        payment_term_days: creditMode && !dueDate ? Number(payTerm) || 0 : undefined,
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
      setSelectedItemKey(null);
      setCreditMode(false);
      setCustomerId('');
      setDueDate('');
      loadProducts();
      toast.success(`Transaksi ${result.sale.invoice_no} berhasil`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const printReceipt = () => window.print();

  // ---------- Navigasi keyboard dropdown pencarian ----------
  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      if (searchFlat.length === 0) return;
      event.preventDefault();
      setSearchActiveIndex((i) => (i + 1) % searchFlat.length);
    } else if (event.key === 'ArrowUp') {
      if (searchFlat.length === 0) return;
      event.preventDefault();
      setSearchActiveIndex((i) => (i - 1 + searchFlat.length) % searchFlat.length);
    } else if (event.key === 'Enter') {
      if (!dropdownVisible || searchActiveIndex < 0) return;
      const entry = searchFlat[searchActiveIndex];
      if (!entry) return;
      event.preventDefault();
      if (entry.kind === 'bundle') selectBundle(entry.item);
      else selectProduct(entry.item);
    }
  };

  // ---------- Unit picker ----------
  const unitOptions = unitPicker
    ? [{ kind: 'base' }, ...(unitPicker.units || []).map((unit) => ({ kind: 'unit', unit }))]
    : [];

  const chooseUnitOption = (option) => {
    if (!unitPicker || !option) return;
    if (option.kind === 'base') addProduct(unitPicker.product);
    else addProduct(unitPicker.product, option.unit);
    setUnitPicker(null);
  };

  const handleUnitKeyDown = (event) => {
    if (!unitPicker) return;
    const count = unitOptions.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setUnitActiveIndex((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setUnitActiveIndex((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      // Enter pada tombol yang fokus (Tab) sudah memicu klik native — biarkan
      // klik yang menang agar tidak double-add dengan opsi highlight.
      if (event.target instanceof Element && event.target.closest('button')) return;
      const option = unitOptions[unitActiveIndex];
      if (option) {
        event.preventDefault();
        chooseUnitOption(option);
      }
    } else if (/^[1-9]$/.test(event.key)) {
      const idx = Number(event.key) - 1;
      if (idx < count) {
        event.preventDefault();
        chooseUnitOption(unitOptions[idx]);
      }
    }
  };

  // ---------- Member modal ----------
  const chooseMember = (member) => {
    cart.setMember(member);
    setMemberModal(false);
    setMemberSearch('');
  };

  const handleMemberKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      if (memberResults.length === 0) return;
      event.preventDefault();
      setMemberActiveIndex((i) => (i + 1) % memberResults.length);
    } else if (event.key === 'ArrowUp') {
      if (memberResults.length === 0) return;
      event.preventDefault();
      setMemberActiveIndex((i) => (i - 1 + memberResults.length) % memberResults.length);
    } else if (event.key === 'Enter') {
      const member = memberResults[memberActiveIndex];
      if (!member) return;
      event.preventDefault();
      chooseMember(member);
    }
  };

  // ---------- Pembayaran: metode cepat + konfirmasi ----------
  // Digit 1–4 hanya mengganti metode bila satu baris pembayaran; saat split,
  // ganti metode baris pertama saja agar baris lain tidak hilang.
  const selectPayMethod = (methodKey) => {
    if (payments.length > 1) {
      setPayments(payments.map((p, i) => (i === 0 ? { ...p, method: methodKey } : p)));
      return;
    }
    setPayments([{ method: methodKey, amount: String(estimatedTotal), reference: '' }]);
  };

  // Dihitung inline saat keydown: estimatedTotal/paidTotal dideklarasikan
  // lebih bawah di scope render yang sama (closure aman dipanggil setelah render).
  const isPayConfirmDisabled = () => submitting
    || (creditMode
      ? (!customerId || paidTotal > estimatedTotal)
      : paidTotal < estimatedTotal);

  const handlePaymentKeyDown = (event) => {
    if (!payOpen) return;
    const tag = event.target?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
    // Enter pada tombol yang fokus (Batal/metode/split) memicu klik native —
    // biarkan klik yang menang agar Batal tidak berubah menjadi Bayar.
    const isButton = tag === 'BUTTON'
      || (event.target instanceof Element && Boolean(event.target.closest('button')));
    if (/^[1-4]$/.test(event.key) && !isInput && !isButton) {
      event.preventDefault();
      const method = PAY_METHODS[Number(event.key) - 1];
      if (method) selectPayMethod(method.key);
    } else if (event.key === 'Enter' && !isInput && !isButton && !isPayConfirmDisabled()) {
      event.preventDefault();
      checkout();
    }
  };

  // ---------- Hold / resume ----------
  const loadHolds = useCallback(async () => {
    setHoldsLoading(true);
    setHoldsError(null);
    try {
      const result = await api.get('/api/holds', { status: 'active', limit: 50 });
      setHoldsList(result.data || []);
    } catch (err) {
      setHoldsError(err.message);
    } finally {
      setHoldsLoading(false);
    }
  }, []);

  const openHoldModal = () => {
    if (!shift) return;
    if (cart.items.length === 0) return toast.warning('Keranjang masih kosong');
    if (cartOverlaysOpen) return;
    setHoldName('');
    setHoldNote('');
    setHoldOpen(true);
  };

  const openHoldsList = () => {
    if (!shift) return;
    if (cartOverlaysOpen) return;
    setHoldsOpen(true);
    loadHolds();
  };

  const submitHold = async () => {
    if (cart.items.length === 0) return toast.warning('Keranjang masih kosong');
    setHoldSaving(true);
    try {
      const payload = {
        shift_id: shift?.id || null,
        hold_name: holdName,
        note: holdNote,
        member_id: cart.member?.id || null,
        txn_discount: cart.txnDiscount,
        redeem_points: cart.redeemPoints,
        estimated_total: estimatedTotal,
        items: cart.items.map((item) => (
          item.bundle_id
            ? {
              bundle_id: item.bundle_id,
              qty: item.qty,
              discount: item.discount,
              name: item.name,
              sku: item.sku,
              price: item.price,
            }
            : {
              product_id: item.product_id,
              unit_id: item.unit_id,
              qty: item.qty,
              discount: item.discount,
              name: item.name,
              unit_name: item.unit_name,
              sku: item.sku,
              price: item.price,
            }
        )),
      };
      const result = await api.post('/api/holds', payload);
      cart.clear();
      setDiscountEditorKey(null);
      setSelectedItemKey(null);
      setHoldOpen(false);
      toast.success(`Hold ${result.hold.hold_code} tersimpan`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setHoldSaving(false);
    }
  };

  const resumeHold = async (hold) => {
    setResumeHolding(hold.id);
    try {
      const detail = await api.get(`/api/holds/${hold.id}`);
      const rawItems = Array.isArray(detail.items) ? detail.items : [];
      const usable = rawItems.filter((i) => !i.is_gone);
      const goneCount = rawItems.length - usable.length;
      if (usable.length === 0) {
        toast.error('Semua item pada hold tidak lagi tersedia');
        await api.del(`/api/holds/${hold.id}?reason=resume`).catch(() => {});
        setHoldsOpen(false);
        setConfirmResume(null);
        return;
      }

      // Hidrasi cart dari snapshot hold (referensi + qty + discount).
      // Harga di-requote oleh quote effect; server tetap otoritatif di checkout.
      const items = usable.map((i) => (
        i.bundle_id
          ? {
            bundle_id: i.bundle_id,
            is_bundle: true,
            name: i.name || `Paket #${i.bundle_id}`,
            sku: i.sku || '',
            price: Number(i.price) || 0,
            qty: i.qty,
            discount: i.discount || 0,
          }
          : {
            product_id: i.product_id,
            unit_id: i.unit_id || null,
            unit_name: i.unit_name || null,
            name: i.name || `Produk #${i.product_id}`,
            sku: i.sku || '',
            price: Number(i.price) || 0,
            qty: i.qty,
            discount: i.discount || 0,
            stock_available: 0,
            conversion_factor: 1,
          }
      ));

      let member = null;
      if (detail.member_id) {
        try {
          const memberDetail = await api.get(`/api/members/${detail.member_id}`);
          if (memberDetail && memberDetail.is_active !== false) member = memberDetail;
        } catch {
          member = null;
        }
      }

      cart.restore({
        items,
        member,
        txnDiscount: Number(detail.txn_discount) || 0,
        redeemPoints: Number(detail.redeem_points) || 0,
      });
      setDiscountEditorKey(null);

      await api.del(`/api/holds/${hold.id}?reason=resume`);
      setHoldsOpen(false);
      setConfirmResume(null);
      if (goneCount > 0) toast.warning(`${goneCount} item hold tidak lagi tersedia dan dilewati`);
      toast.success(`Hold ${detail.hold_code} dimuat ke keranjang`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResumeHolding(null);
    }
  };

  const requestResumeHold = (hold) => {
    if (cart.items.length > 0) {
      setConfirmResume(hold);
      return;
    }
    resumeHold(hold);
  };

  const cancelHold = async (hold) => {
    try {
      await api.del(`/api/holds/${hold.id}`);
      toast.success(`Hold ${hold.hold_code} dibatalkan`);
      loadHolds();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmClearCart = () => {
    setDiscountEditorKey(null);
    setSelectedItemKey(null);
    cart.clear();
    setClearCartOpen(false);
    toast.success('Keranjang dikosongkan');
  };

  // ---------- Seleksi baris keranjang ----------
  // Guard modal: penyesuaian qty keyboard tidak boleh mengubah cart di balik modal.
  const cartOverlaysOpen = Boolean(
    payOpen || memberModal || unitPicker || scanOpen
    || holdOpen || holdsOpen || receiptSale || clearCartOpen || confirmResume
  );

  const selectCartItem = (key) => {
    setSelectedItemKey((prev) => (prev === key ? null : key));
  };

  const adjustSelectedQty = (delta) => {
    if (!selectedItemKey || cartOverlaysOpen) return;
    const item = cart.items.find((i) => cart.keyOf(i) === selectedItemKey);
    if (!item) {
      setSelectedItemKey(null);
      return;
    }
    cart.updateQtyByKey(selectedItemKey, item.qty + delta);
  };

  useHotkeys({
    F2: () => searchRef.current?.focus(),
    F4: () => openPayment(),
    F6: openHoldModal,
    F7: openHoldsList,
    F8: () => {
      if (!shift) return;
      if (cart.items.length === 0) return toast.warning('Keranjang masih kosong');
      if (cartOverlaysOpen) return;
      setPayments([{ method: 'cash', amount: String(estimatedTotal), reference: '' }]);
      setCreditMode(false);
      setCustomerId('');
      setPayTerm('30');
      setDueDate('');
      setPayOpen(true);
    },
    H: openHoldModal,
    A: openHoldsList,
    M: () => { if (shift && !cartOverlaysOpen) setMemberModal(true); },
    C: () => { if (shift && cart.items.length > 0) setClearCartOpen(true); },
    K: () => { if (shift && !cartOverlaysOpen) setScanOpen(true); },
    'Alt+H': openHoldModal,
    'Alt+A': openHoldsList,
    'Alt+M': () => { if (shift && !cartOverlaysOpen) setMemberModal(true); },
    'Alt+C': () => { if (shift && cart.items.length > 0 && !cartOverlaysOpen) setClearCartOpen(true); },
    'Alt+K': () => { if (shift && !cartOverlaysOpen) setScanOpen(true); },
    '+': () => adjustSelectedQty(1),
    '=': () => adjustSelectedQty(1),
    '-': () => adjustSelectedQty(-1),
    Escape: () => {
      if (confirmResume) setConfirmResume(null);
      else if (clearCartOpen) setClearCartOpen(false);
      else if (holdOpen) setHoldOpen(false);
      else if (holdsOpen) setHoldsOpen(false);
      else if (receiptSale) setReceiptSale(null);
      else if (memberModal) setMemberModal(false);
      else if (payOpen) setPayOpen(false);
      else if (unitPicker) setUnitPicker(null);
      else if (scanOpen) setScanOpen(false);
      else if (searchOpen) { setSearchOpen(false); setSearch(''); }
      else if (selectedItemKey) setSelectedItemKey(null);
    },
  });

  // Shortcut lokal modal struk: P cetak, Enter tutup (Esc ditangani cascade).
  useHotkeys({
    P: () => printReceipt(),
    'Alt+P': () => printReceipt(),
    Enter: () => setReceiptSale(null),
  }, { enabled: Boolean(receiptSale) });

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
          <Input
            label="Kas Awal (Rp)"
            type="number"
            value={openCash}
            onChange={(e) => setOpenCash(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); openShift(); } }}
            autoFocus
          />
          <Button className="w-full mt-4" onClick={openShift} size="lg">
            Buka Shift (Enter)
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
              label="Kamera (Alt+K)"
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
                onKeyDown={handleSearchKeyDown}
              />
              {searchOpen && debouncedSearch.trim().length > 0 && (
                <SearchResults
                  anchorRect={dropdownRect}
                  containerRef={dropdownRef}
                  loading={loadingProducts}
                  products={visibleProducts}
                  bundles={visibleBundles}
                  query={debouncedSearch}
                  member={cart.member}
                  expiringProducts={expiringProducts}
                  activeIndex={searchActiveIndex}
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
            <div className="flex items-center gap-2">
              <Button variant="neutral" size="sm" onClick={openHoldsList}>
                <ListChecks size={14} /> Hold (Alt+A)
              </Button>
              {cart.items.length > 0 && (
                <>
                  <Button variant="neutral" size="sm" onClick={openHoldModal}>
                    <PauseCircle size={14} /> Tahan (Alt+H)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setClearCartOpen(true)}>
                    <Trash2 size={14} /> Kosongkan (Alt+C)
                  </Button>
                </>
              )}
            </div>
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
                <UserPlus size={14} /> Pilih Member (Alt+M)
              </Button>
            </div>
          )}
          {cart.items.length > 0 && (
            <p className="mt-2 text-[10px] text-slate-500">Klik baris lalu tekan + / − untuk ubah jumlah</p>
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
              const selected = selectedItemKey === key;
              return (
                <div
                  key={key}
                  onClick={(e) => {
                    if (e.target instanceof Element && e.target.closest('button,input')) return;
                    selectCartItem(key);
                  }}
                  aria-pressed={selected}
                  className={`${selected ? 'bg-ios-blue/10 ring-2 ring-ios-blue/60' : 'bg-white/5'} rounded-ios-sm px-3 py-2 cursor-pointer`}
                >
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
        <div ref={unitPickerRef} tabIndex={-1} className="space-y-2 outline-none" onKeyDown={handleUnitKeyDown}>
          <button
            onClick={() => chooseUnitOption(unitOptions[0])}
            className={`w-full flex justify-between items-center px-4 py-3 rounded-ios-sm ${unitActiveIndex === 0 ? 'bg-ios-blue/25 border border-ios-blue/50' : 'bg-white/5 hover:bg-white/10'}`}
          >
            <span className="text-white">1 {unitPicker?.product?.base_unit} <span className="text-xs text-slate-500">(1)</span></span>
            <span className="text-ios-green">
              {formatCurrency(cart.member && unitPicker?.product?.member_price != null ? unitPicker.product.member_price : unitPicker?.product?.sell_price)}
            </span>
          </button>
          {unitPicker?.units.map((unit, idx) => (
            <button
              key={unit.id}
              onClick={() => chooseUnitOption(unitOptions[idx + 1])}
              className={`w-full flex justify-between items-center px-4 py-3 rounded-ios-sm ${unitActiveIndex === idx + 1 ? 'bg-ios-blue/25 border border-ios-blue/50' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <span className="text-white">
                {idx + 2} {unit.unit_name} (x{unit.conversion_factor}) <span className="text-xs text-slate-500">({idx + 2})</span>
              </span>
              <span className="text-ios-green">
                {formatCurrency(cart.member && unit.member_price != null ? unit.member_price : unit.sell_price)}
              </span>
            </button>
          ))}
          <p className="text-[10px] text-slate-500 pt-1">↑/↓ lalu Enter, atau tekan angka sesuai urutan</p>
        </div>
      </Modal>

      {/* Modal pilih member */}
      <Modal isOpen={memberModal} onClose={() => setMemberModal(false)} title="Member" size="sm">
        <Input
          label="Cari Member"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
          onKeyDown={handleMemberKeyDown}
          placeholder="Nama / kode / telepon..."
          autoFocus
        />
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {memberResults.map((member, idx) => (
            <button
              key={member.id}
              onClick={() => chooseMember(member)}
              className={`w-full flex justify-between items-center px-3 py-2 rounded-ios-sm ${memberActiveIndex === idx ? 'bg-ios-blue/25 border border-ios-blue/50' : 'bg-white/5 hover:bg-white/10'}`}
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
          {memberResults.length > 0 && (
            <p className="text-[10px] text-slate-500">↑/↓ lalu Enter untuk memilih</p>
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
              <Button
                variant={creditMode ? 'warning' : 'success'}
                onClick={checkout}
                disabled={
                  submitting
                  || (creditMode
                    ? (!customerId || paidTotal > estimatedTotal)
                    : paidTotal < estimatedTotal)
                }
              >
                <CheckCircle2 size={16} />
                {submitting ? 'Memproses...' : creditMode ? 'Terbitkan Kredit' : 'Bayar & Simpan'}
              </Button>
            </div>
          </div>
        }
      >
        <div ref={payRef} tabIndex={-1} className="space-y-4 outline-none" onKeyDown={handlePaymentKeyDown}>
          {canCredit && (
            <button
              type="button"
              onClick={() => {
                const next = !creditMode;
                setCreditMode(next);
                if (next) {
                  setPayments([{ method: 'cash', amount: '', reference: '' }]);
                } else {
                  setPayments([{ method: 'cash', amount: String(estimatedTotal), reference: '' }]);
                }
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-ios-sm border transition-colors ${creditMode ? 'bg-ios-orange/15 border-ios-orange/50 text-ios-orange' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Building2 size={16} /> Jual Kredit (Grosir)
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${creditMode ? 'border-ios-orange/50 bg-ios-orange/20' : 'border-white/15 bg-white/5'}`}>
                {creditMode ? 'AKTIF' : 'Nonaktif'}
              </span>
            </button>
          )}

          {creditMode && (
            <div className="space-y-3 p-3 rounded-ios-sm bg-slate-950/40 border border-ios-orange/30">
              <Input
                as="select"
                label="Pelanggan Grosir *"
                value={customerId}
                onChange={(e) => selectCreditCustomer(e.target.value)}
              >
                <option value="">-- Pilih pelanggan --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code}){c.payment_term_days > 0 ? ` · Net ${c.payment_term_days}` : ''}
                  </option>
                ))}
              </Input>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  as="select"
                  label="Termin"
                  value={payTerm}
                  onChange={(e) => { setPayTerm(e.target.value); setDueDate(''); }}
                  disabled={Boolean(dueDate)}
                >
                  {TERM_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d === 0 ? 'Tunai (0 hari)' : `Net ${d} hari`}</option>
                  ))}
                </Input>
                <Input
                  label="Atau Tanggal Jatuh Tempo"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <p className="text-xs text-slate-500">
                Pembayaran di bawah ini opsional (uang muka). Sisa tagihan tercatat sebagai piutang dan tidak menambah kas shift.
              </p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2">
            {PAY_METHODS.map(({ key, label, icon: Icon }, idx) => (
              <button
                key={key}
                onClick={() => selectPayMethod(key)}
                className={`flex flex-col items-center gap-1 py-3 rounded-ios-sm text-xs transition-colors ${payments.length === 1 && payments[0].method === key ? 'bg-ios-blue text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                <Icon size={20} />
                {label}
                <span className="text-[10px] opacity-70">({idx + 1})</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 -mt-2">Tekan 1–4 untuk pilih metode, Enter untuk konfirmasi bayar</p>

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
                  label={index === 0 ? (creditMode ? 'Uang Muka' : 'Jumlah') : ''}
                  type="number"
                  className="flex-1"
                  value={payment.amount}
                  onChange={(e) => setPayments(payments.map((p, i) => (i === index ? { ...p, amount: e.target.value } : p)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isPayConfirmDisabled()) {
                      e.preventDefault();
                      checkout();
                    }
                  }}
                />
                {payments.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setPayments(payments.filter((_, i) => i !== index))}>
                    <Trash2 size={14} className="text-ios-red" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {!creditMode && (
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
          )}

          {payments.some((p) => p.method === 'qris') && settings?.qris_image_path && (
            <div className="flex flex-col items-center p-3 bg-white rounded-ios-sm">
              <img src={settings.qris_image_path} alt="QRIS" className="w-48 h-48 object-contain" />
              <p className="text-xs text-slate-700 mt-2">Scan QRIS lalu konfirmasi pembayaran diterima</p>
            </div>
          )}

          <div className="p-3 rounded-ios-sm bg-white/5 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">{creditMode ? 'Uang Muka' : 'Dibayar'}</span>
              <span className="text-white">{formatCurrency(paidTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{creditMode ? 'Sisa Piutang' : (change >= 0 ? 'Kembalian' : 'Kurang')}</span>
              <span className={
                creditMode
                  ? 'text-ios-orange font-semibold'
                  : (change >= 0 ? 'text-ios-green font-semibold' : 'text-ios-red font-semibold')
              }>
                {creditMode ? formatCurrency(Math.max(0, estimatedTotal - paidTotal)) : formatCurrency(Math.abs(change))}
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
            <Button variant="neutral" onClick={() => setReceiptSale(null)}>Tutup (Enter)</Button>
            <Button onClick={printReceipt}><Printer size={16} /> Cetak Struk (Alt+P)</Button>
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

      {/* Modal tahan (hold) keranjang */}
      <Modal
        isOpen={holdOpen}
        onClose={() => setHoldOpen(false)}
        title="Tahan Keranjang"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setHoldOpen(false)} disabled={holdSaving}>Batal</Button>
            <Button onClick={submitHold} disabled={holdSaving || cart.items.length === 0}>
              {holdSaving ? 'Menyimpan...' : 'Simpan Hold (Enter)'}
            </Button>
          </div>
        }
      >
        <div
          className="space-y-3"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Enter pada tombol footer (Batal/Simpan) memicu klik native —
            // biarkan klik yang menang agar Batal tidak ikut menyimpan hold.
            if (e.target instanceof Element && e.target.closest('button')) return;
            e.preventDefault();
            submitHold();
          }}
        >
          <p className="text-sm text-slate-400">
            Keranjang disimpan sementara tanpa mengunci stok. Tekan <span className="text-white">Alt+A</span> (atau F7) untuk mengambilnya kembali.
          </p>
          <Input
            label="Nama Hold (opsional)"
            value={holdName}
            onChange={(e) => setHoldName(e.target.value)}
            placeholder="Mis.: Pak Bu Sari / Meja 2"
            autoFocus
          />
          <Input
            label="Catatan (opsional)"
            value={holdNote}
            onChange={(e) => setHoldNote(e.target.value)}
            placeholder="Catatan singkat..."
          />
          <div className="text-xs text-slate-500">
            {cart.items.length} item · total ± {formatCurrency(estimatedTotal)}
          </div>
        </div>
      </Modal>

      {/* Modal daftar hold aktif */}
      <Modal
        isOpen={holdsOpen}
        onClose={() => setHoldsOpen(false)}
        title="Hold Aktif"
        size="md"
        footer={
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">↑/↓ lalu Enter untuk mengambil hold</span>
            <Button variant="neutral" onClick={() => setHoldsOpen(false)}>Tutup</Button>
          </div>
        }
      >
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {holdsLoading && <p className="text-sm text-slate-400 text-center py-6">Memuat hold...</p>}
          {holdsError && <p className="text-sm text-ios-red text-center py-6">{holdsError}</p>}
          {!holdsLoading && !holdsError && holdsList.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">Belum ada hold aktif</p>
          )}
          {holdsList.map((hold) => (
            <div
              key={hold.id}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-ios-sm ${resumeHolding === hold.id ? 'bg-ios-blue/20 border border-ios-blue/40' : 'bg-white/5'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white font-mono">{hold.hold_code}</div>
                <div className="text-xs text-slate-400 truncate">
                  {hold.hold_name || 'Tanpa nama'} · {hold.item_count} item · {formatCurrency(hold.estimated_total)}
                  {hold.member_name ? ` · ${hold.member_name}` : ''}
                </div>
                <div className="text-[10px] text-slate-500">
                  {hold.cashier_name} · {new Date(hold.created_at).toLocaleString('id-ID')}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={() => requestResumeHold(hold)}
                  disabled={resumeHolding === hold.id}
                >
                  {resumeHolding === hold.id ? 'Memuat...' : 'Ambil'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancelHold(hold)}
                  disabled={resumeHolding === hold.id}
                  title="Batalkan hold"
                >
                  <Trash2 size={14} className="text-ios-red" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Konfirmasi kosongkan cart */}
      <ConfirmDialog
        isOpen={clearCartOpen}
        onClose={() => setClearCartOpen(false)}
        onConfirm={confirmClearCart}
        title="Kosongkan Keranjang?"
        message={`Hapus semua ${cart.items.length} item dari keranjang? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Ya, Kosongkan"
      />

      {/* Konfirmasi resume hold saat cart terisi */}
      <ConfirmDialog
        isOpen={Boolean(confirmResume)}
        onClose={() => setConfirmResume(null)}
        onConfirm={() => { if (confirmResume) resumeHold(confirmResume); }}
        title="Ganti Keranjang?"
        message={`Keranjang berisi item. Muat hold ${confirmResume?.hold_code || ''} akan mengganti isi keranjang saat ini.`}
        confirmLabel="Ya, Muat Hold"
        variant="warning"
        loading={Boolean(resumeHolding)}
      />
    </div>
  );
};

// Dropdown hasil pencarian: produk + paket. Muncul saat kasir mengetik dan
// menggantikan grid katalog yang dihapus. Produk multi-satuan tetap lewat
// selectProduct (unit picker), produk stok 0 tidak bisa ditambahkan.
// Navigasi keyboard (↑/↓/Enter) ditangani di input pencarian; activeIndex
// menentukan baris yang di-highlight (0..bundles-1, lalu products).
const SearchResults = ({ anchorRect, containerRef, loading, products, bundles, query, member, expiringProducts, activeIndex = -1, onSelectProduct, onSelectBundle }) => {
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
          {shownBundles.map((bundle, idx) => (
            <button
              key={`bundle-${bundle.id}`}
              onClick={() => onSelectBundle(bundle)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left ${activeIndex === idx ? 'bg-ios-blue/25' : 'hover:bg-white/10'}`}
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
          {shownProducts.map((product, idx) => {
            const price = member && product.member_price != null ? product.member_price : product.sell_price;
            const out = product.stock_qty <= 0;
            const expiryFlag = expiringProducts[product.id];
            const flatIdx = shownBundles.length + idx;
            return (
              <button
                key={`product-${product.id}`}
                onClick={() => onSelectProduct(product)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left disabled:opacity-40 ${activeIndex === flatIdx ? 'bg-ios-blue/25' : 'hover:bg-white/10'}`}
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

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Plus, Trash2, Save, ArrowLeft, CheckCircle2, Printer } from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';
import { formatCurrency } from '../utils/formatters';

// Cerminan kalkulator server (backend/routes/print_orders.js). Server tetap
// sumber kebenaran; versi ini hanya untuk pratinjau total saat mengetik.
const computeLine = (service, item) => {
  const pages = Math.max(1, Math.round(Number(item.pages) || 1));
  const copies = Math.max(1, Math.round(Number(item.copies) || 1));
  const sheets = Math.ceil(pages / (item.sides === 'double' ? 2 : 1)) * copies;

  const pricePerSheet = Number(service.price_per_sheet) || 0;
  const pricePerPage = Number(service.price_per_page) || 0;
  const perSheet = pricePerSheet > 0 ? pricePerSheet : pricePerPage;
  const bundlePrice = service.bundle_price === null || service.bundle_price === undefined
    ? null : Number(service.bundle_price);
  const bundleQty = service.bundle_qty === null || service.bundle_qty === undefined
    ? null : Number(service.bundle_qty);

  let total;
  // Cermin PERSIS computeLine server (backend/routes/print_orders.js): mode paket
  // aktif selama bundlePrice ada, termasuk saat sheets < bundleQty (minimal 1 paket).
  if (bundlePrice !== null && bundleQty && bundleQty > 0) {
    const packs = Math.floor(sheets / bundleQty);
    const remainder = sheets % bundleQty;
    const remainderTotal = remainder * perSheet;
    total = packs * bundlePrice
      + (remainder > 0
        ? (perSheet > 0 ? remainderTotal : bundlePrice)
        : 0);
    if (packs === 0 && perSheet === 0 && sheets > 0) total = bundlePrice;
  } else if (pricePerSheet > 0) {
    total = sheets * pricePerSheet;
  } else {
    total = pages * copies * pricePerPage;
  }

  const minQty = Number(service.min_qty) || 1;
  return { sheets, total, minQty, belowMin: sheets < minQty };
};

const emptyServiceItem = () => ({
  kind: 'service',
  service_id: '',
  pages: 1,
  copies: 1,
  sides: 'single',
  paper_size: '',
  color_mode: '',
  description: '',
});

const emptyProductItem = () => ({
  kind: 'product',
  product_id: '',
  unit_id: '',
  qty: 1,
  discount: 0,
  description: '',
});

const PrintOrderForm = () => {
  const toast = useToastContext();
  const navigate = useNavigate();
  const { id } = useParams();
  const { settings } = useSettings();
  const editing = Boolean(id);

  const [services, setServices] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [useManualName, setUseManualName] = useState(false);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState([emptyServiceItem()]);

  useEffect(() => {
    const init = async () => {
      try {
        const [serviceRows, productPage, customerPage] = await Promise.all([
          api.get('/api/print-services'),
          api.get('/api/products', { is_active: true, limit: 500 }).catch(() => ({ data: [] })),
          api.get('/api/customers', { is_active: true, limit: 200 }).catch(() => ({ data: [] })),
        ]);
        setServices(serviceRows);
        setProducts(productPage?.data || []);
        setCustomers(customerPage?.data || []);
        if (editing) {
          const order = await api.get(`/api/print-orders/${id}`);
          setCustomerId(order.customer_id ? String(order.customer_id) : '');
          setCustomerName(order.customer_name || '');
          setUseManualName(!order.customer_id);
          setNotes(order.notes || '');
          setDiscount(String(order.discount || 0));
          setItems(order.items.map((it) => (it.product_id
            ? {
              kind: 'product',
              product_id: String(it.product_id),
              unit_id: it.unit_id ? String(it.unit_id) : '',
              qty: it.qty,
              discount: 0,
              description: it.description || '',
            }
            : {
              kind: 'service',
              service_id: String(it.service_id || ''),
              pages: it.pages,
              copies: it.copies,
              sides: it.sides,
              paper_size: it.paper_size || '',
              color_mode: it.color_mode || '',
              description: it.description || '',
            })));
        }
      } catch (err) {
        toast.error(err.message);
        if (editing) navigate('/print-orders', { replace: true });
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [editing, id, toast, navigate]);

  const serviceById = useMemo(() => {
    const map = new Map();
    (services || []).forEach((s) => map.set(String(s.id), s));
    return map;
  }, [services]);

  const productById = useMemo(() => {
    const map = new Map();
    (products || []).forEach((p) => map.set(String(p.id), p));
    return map;
  }, [products]);

  // Satuan produk diambil lazily saat baris produk dipilih (produk multi-satuan).
  const [unitsByProduct, setUnitsByProduct] = useState({});
  useEffect(() => {
    const missing = [...new Set(items
      .filter((it) => it.kind === 'product' && it.product_id && !(it.product_id in unitsByProduct))
      .map((it) => it.product_id))];
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = {};
      for (const pid of missing) {
        try {
          fetched[pid] = await api.get(`/api/products/${pid}/units`);
        } catch {
          fetched[pid] = [];
        }
      }
      if (!cancelled) setUnitsByProduct((prev) => ({ ...prev, ...fetched }));
    })();
    return () => { cancelled = true; };
  }, [items, unitsByProduct]);

  // Pratinjau harga produk di klien. Server tetap sumber kebenaran (memakai
  // resolver member/tier/promo); di sini hanya harga normal agar ringkasan
  // mendekati total final. Diskon per baris ikut dikurangi.
  const lines = useMemo(() => items.map((item) => {
    if (item.kind === 'product') {
      const product = productById.get(item.product_id);
      const units = unitsByProduct[item.product_id] || [];
      const unit = item.unit_id ? units.find((u) => String(u.id) === String(item.unit_id)) : null;
      const unitPrice = product ? (Number(unit ? unit.sell_price : product.sell_price) || 0) : 0;
      const unitName = unit ? unit.unit_name : (product?.base_unit || '');
      const qty = Math.max(1, Math.round(Number(item.qty) || 1));
      const lineDiscount = Math.max(0, Math.round(Number(item.discount) || 0));
      const total = Math.max(0, unitPrice * qty - lineDiscount);
      return { item, total, unitPrice, unitName, qty, product };
    }
    const service = serviceById.get(item.service_id);
    if (!service) return { item, sheets: 0, total: 0, belowMin: false };
    return { item, ...computeLine(service, item) };
  }), [items, serviceById, productById, unitsByProduct]);

  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const discountValue = Math.max(0, Math.round(Number(discount) || 0));
  const payable = Math.max(0, subtotal - discountValue);
  const taxRate = Number(settings?.tax_rate) || 0;
  const taxIncluded = settings?.tax_included !== false;
  const taxTotal = taxRate > 0
    ? (taxIncluded
      ? Math.round(payable - payable / (1 + taxRate / 100))
      : Math.round((payable * taxRate) / 100))
    : 0;
  const grandTotal = taxIncluded ? payable : payable + taxTotal;

  const hasMissingItem = lines.some((line) => (line.item.kind === 'product'
    ? !line.item.product_id
    : !line.item.service_id));
  const hasBelowMin = lines.some((line) => line.belowMin);
  const canSave = !saving && lines.length > 0 && !hasMissingItem && !hasBelowMin
    && (useManualName ? customerName.trim().length > 0 : true);

  const updateItem = (index, patch) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        customer_id: useManualName ? null : (customerId ? Number(customerId) : null),
        customer_name: customerName.trim() || null,
        notes: notes.trim() || null,
        discount: discountValue,
        items: items.map((item) => (item.kind === 'product'
          ? {
            product_id: Number(item.product_id),
            unit_id: item.unit_id ? Number(item.unit_id) : null,
            qty: Math.max(1, Math.round(Number(item.qty) || 1)),
            discount: Math.max(0, Math.round(Number(item.discount) || 0)),
            description: item.description || null,
          }
          : {
            service_id: Number(item.service_id),
            pages: Math.max(1, Math.round(Number(item.pages) || 1)),
            copies: Math.max(1, Math.round(Number(item.copies) || 1)),
            sides: item.sides,
            paper_size: item.paper_size || null,
            color_mode: item.color_mode || null,
            description: item.description || null,
          })),
      };
      if (editing) {
        await api.put(`/api/print-orders/${id}`, payload);
        toast.success('Pesanan diperbarui');
        navigate('/print-orders');
      } else {
        const order = await api.post('/api/print-orders', payload);
        setCreated(order);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Memuat data pesanan..." />;

  if (created) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <div className="text-center py-6">
            <CheckCircle2 size={48} className="mx-auto text-ios-green mb-4" />
            <h2 className="text-xl font-bold text-white">Pesanan dibuat</h2>
            <p className="text-sm text-slate-400 mt-1">{created.code}</p>
            <div className="mt-6 p-6 rounded-ios bg-ios-blue/10 border border-ios-blue/30">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Nomor Antrian</p>
              <p className="text-5xl font-bold text-ios-blue mt-1">#{created.queue_no}</p>
              <p className="text-sm text-slate-300 mt-3">{created.customer_name}</p>
              <p className="text-lg font-semibold text-white mt-1">{formatCurrency(created.grand_total)}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              <Button onClick={() => navigate('/print-orders/new')}>
                <Plus size={16} /> Pesanan Baru
              </Button>
              <Button variant="neutral" onClick={() => navigate('/print-orders')}>
                Lihat Antrian
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={editing ? 'Ubah Pesanan' : 'Buat Pesanan Fotokopi'}
        subtitle="Harga dihitung otomatis dari master jasa (server menghitung ulang saat disimpan)"
        actions={(
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => navigate('/print-orders')}>
              <ArrowLeft size={16} /> Kembali
            </Button>
            <Button onClick={save} disabled={!canSave}>
              <Save size={16} /> {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan Pesanan'}
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Pelanggan">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                as="select"
                label="Pelanggan (master)"
                value={useManualName ? '' : customerId}
                disabled={useManualName}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— Pilih pelanggan —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>
                ))}
              </Input>
              <Input
                label="Nama pelanggan (tanpa master)"
                value={customerName}
                disabled={!useManualName && Boolean(customerId)}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nama umum / walk-in"
              />
              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useManualName}
                    onChange={(e) => {
                      setUseManualName(e.target.checked);
                      if (e.target.checked) {
                        setCustomerId('');
                        const chosen = customers.find((c) => String(c.id) === customerId);
                        if (chosen) setCustomerName(chosen.name);
                      }
                    }}
                    className="rounded border-white/20 bg-slate-950"
                  />
                  Tulis nama manual (tanpa memilih master pelanggan)
                </label>
              </div>
            </div>
          </Card>

          <Card
            title="Item Pesanan"
            action={(
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setItems((prev) => [...prev, emptyServiceItem()])}>
                  <Plus size={14} /> Jasa
                </Button>
                <Button
                  size="sm"
                  variant="neutral"
                  onClick={() => setItems((prev) => [...prev, emptyProductItem()])}
                >
                  <Plus size={14} /> Produk (ATK)
                </Button>
              </div>
            )}
          >
            <div className="space-y-4">
              {lines.map((line, index) => {
                const item = line.item;
                if (item.kind === 'product') {
                  const units = unitsByProduct[item.product_id] || [];
                  return (
                    <div key={index} className="p-4 rounded-ios border border-white/10 bg-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-ios-purple uppercase tracking-wide">Produk / ATK</span>
                        {lines.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <Trash2 size={14} className="text-ios-red" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                        <div className="col-span-2 sm:col-span-3">
                          <Input
                            as="select"
                            label="Produk"
                            value={item.product_id}
                            onChange={(e) => updateItem(index, { product_id: e.target.value, unit_id: '' })}
                          >
                            <option value="">— Pilih produk —</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>{p.name} · stok {p.stock_qty}</option>
                            ))}
                          </Input>
                        </div>
                        <div>
                          <Input
                            as="select"
                            label="Satuan"
                            value={item.unit_id}
                            disabled={units.length === 0}
                            onChange={(e) => updateItem(index, { unit_id: e.target.value })}
                          >
                            <option value="">{line.product?.base_unit || 'satuan dasar'}</option>
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>{u.unit_name}</option>
                            ))}
                          </Input>
                        </div>
                        <div>
                          <Input
                            label="Qty"
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={(e) => updateItem(index, { qty: e.target.value })}
                          />
                        </div>
                        <div>
                          <Input
                            label="Diskon (Rp)"
                            type="number"
                            min="0"
                            value={item.discount}
                            onChange={(e) => updateItem(index, { discount: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                        <div className="text-xs text-slate-400">
                          {item.product_id ? (
                            <span className="text-ios-purple font-medium">
                              {formatCurrency(line.unitPrice)} / {line.unitName || 'satuan'} × {line.qty}
                            </span>
                          ) : (
                            <span>Pilih produk untuk menghitung harga</span>
                          )}
                        </div>
                        <span className="text-sm text-white font-semibold">{formatCurrency(line.total)}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={index} className="p-4 rounded-ios border border-white/10 bg-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-ios-blue uppercase tracking-wide">Jasa</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                      <div className="col-span-2 sm:col-span-3">
                        <Input
                          as="select"
                          label="Jasa"
                          value={item.service_id}
                          onChange={(e) => updateItem(index, { service_id: e.target.value })}
                        >
                          <option value="">— Pilih jasa —</option>
                          {(services || []).map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </Input>
                      </div>
                      <div>
                        <Input
                          label="Halaman"
                          type="number"
                          min="1"
                          value={item.pages}
                          onChange={(e) => updateItem(index, { pages: e.target.value })}
                        />
                      </div>
                      <div>
                        <Input
                          label="Rangkap"
                          type="number"
                          min="1"
                          value={item.copies}
                          onChange={(e) => updateItem(index, { copies: e.target.value })}
                        />
                      </div>
                      <div>
                        <Input
                          as="select"
                          label="Sisi"
                          value={item.sides}
                          onChange={(e) => updateItem(index, { sides: e.target.value })}
                        >
                          <option value="single">Satu sisi</option>
                          <option value="double">Bolak-balik</option>
                        </Input>
                      </div>
                      <div>
                        <Input
                          label="Kertas"
                          value={item.paper_size}
                          onChange={(e) => updateItem(index, { paper_size: e.target.value })}
                          placeholder="A4"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                      <div className="text-xs text-slate-400">
                        {line.item.service_id ? (
                          <>
                            <span className="text-ios-blue font-medium">{line.sheets} lembar</span>
                            {line.belowMin && (
                              <span className="text-ios-red ml-2">minimal {line.minQty} lembar</span>
                            )}
                          </>
                        ) : (
                          <span>Pilih jasa untuk menghitung harga</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-white font-semibold">{formatCurrency(line.total)}</span>
                        {lines.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <Trash2 size={14} className="text-ios-red" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Ringkasan">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span className="text-white">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Diskon</span>
                <span className="text-white">-{formatCurrency(discountValue)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>PPN {taxIncluded ? '(termasuk)' : ''}</span>
                <span className="text-white">{formatCurrency(taxTotal)}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-3 text-base">
                <span className="text-white font-medium">Total</span>
                <span className="text-ios-blue font-bold">{formatCurrency(grandTotal)}</span>
              </div>
            </div>
            <div className="mt-4">
              <Input
                label="Diskon (Rp)"
                type="number"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </Card>

          <Card title="Catatan">
            <Input
              as="textarea"
              label="Catatan pesanan"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mis. bolak-balik, jilid staples, ambil sore"
            />
            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={save} disabled={!canSave} className="flex-1">
                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
              {!editing && (
                <Button variant="neutral" onClick={() => navigate('/print-orders')}>
                  Batal
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
              <Printer size={12} /> Nomor antrian dibuat otomatis saat disimpan.
              <Link to="/print-services" className="text-ios-blue hover:underline ml-auto">Kelola jasa</Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PrintOrderForm;

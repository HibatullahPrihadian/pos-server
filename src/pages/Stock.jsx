import { useState, useEffect, useCallback } from 'react';
import { Search, ArrowLeftRight, TrendingDown, BookOpen } from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import useDebounce from '../hooks/useDebounce';
import { formatDateTime, todayIso, firstOfMonthIso } from '../utils/formatters';
import { STOCK_TYPE_LABELS } from '../utils/labels';

const TABS = [
  { key: 'movements', label: 'Kartu Stok', icon: BookOpen },
  { key: 'low', label: 'Stok Minimum', icon: TrendingDown },
  { key: 'adjust', label: 'Penyesuaian', icon: ArrowLeftRight },
];

const Stock = () => {
  const toast = useToastContext();
  const [tab, setTab] = useState('movements');

  const [movements, setMovements] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });

  const [lowStock, setLowStock] = useState([]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ product_id: '', qty_change: '', note: '' });

  const debouncedSearch = useDebounce(productSearch, 350);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      setMovements(
        await api.get('/api/stock/movements', {
          page,
          limit: 50,
          product_id: selectedProduct,
          from: range.from,
          to: range.to,
        })
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, selectedProduct, range, toast]);

  const loadLow = useCallback(async () => {
    setLoading(true);
    try {
      setLowStock(await api.get('/api/stock/low'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'movements') loadMovements();
    if (tab === 'low') loadLow();
  }, [tab, loadMovements, loadLow]);

  useEffect(() => {
    api
      .get('/api/products', { search: debouncedSearch, limit: 20 })
      .then((res) => setProducts(res.data))
      .catch(() => {});
  }, [debouncedSearch]);

  const submitAdjust = async () => {
    try {
      const result = await api.post('/api/stock/adjustments', adjustForm);
      toast.success(`Stok disesuaikan. Saldo baru: ${result.balance_after}`);
      setAdjustOpen(false);
      setAdjustForm({ product_id: '', qty_change: '', note: '' });
      if (tab === 'movements') loadMovements();
      if (tab === 'low') loadLow();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const movementColumns = [
    { key: 'time', label: 'Waktu' },
    { key: 'product', label: 'Produk' },
    { key: 'type', label: 'Jenis', align: 'center' },
    { key: 'change', label: 'Perubahan', align: 'right' },
    { key: 'balance', label: 'Saldo', align: 'right' },
    { key: 'note', label: 'Keterangan' },
  ];

  const lowColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Produk' },
    { key: 'category', label: 'Kategori' },
    { key: 'stock', label: 'Stok', align: 'right' },
    { key: 'min', label: 'Minimum', align: 'right' },
    { key: 'action', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Stok"
        subtitle="Kartu stok, peringatan stok minimum, dan penyesuaian manual"
        actions={<Button onClick={() => setAdjustOpen(true)}><ArrowLeftRight size={16} /> Penyesuaian</Button>}
      />

      <div className="flex gap-2 mb-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-ios-sm text-sm transition-colors ${tab === key ? 'bg-ios-blue text-white shadow-glow-blue' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === 'movements' && (
        <Card padded={false}>
          <div className="p-4 flex flex-wrap gap-3 border-b border-white/10">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
                placeholder="Cari produk..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <select
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
              value={selectedProduct}
              onChange={(e) => { setSelectedProduct(e.target.value); setPage(1); }}
            >
              <option value="">Semua Produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="date"
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
            <input
              type="date"
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <div className="p-4">
            <Table columns={movementColumns} loading={loading} empty="Belum ada mutasi stok">
              {movements.data.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-sm text-slate-400">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{row.product_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{row.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={row.qty_change > 0 ? 'green' : 'red'}>
                      {STOCK_TYPE_LABELS[row.type] || row.type}
                    </Badge>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${row.qty_change > 0 ? 'text-ios-green' : 'text-ios-red'}`}>
                    {row.qty_change > 0 ? '+' : ''}{row.qty_change}
                  </td>
                  <td className="px-4 py-3 text-right text-white">{row.balance_after}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{row.note || '-'}</td>
                </tr>
              ))}
            </Table>
            <Pagination pagination={movements.pagination} onChange={setPage} />
          </div>
        </Card>
      )}

      {tab === 'low' && (
        <Card padded={false}>
          <div className="p-4">
            <Table columns={lowColumns} loading={loading} empty="Semua stok aman">
              {lowStock.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.sku}</td>
                  <td className="px-4 py-3 text-white">{row.name}</td>
                  <td className="px-4 py-3 text-slate-400">{row.category_name || '-'}</td>
                  <td className="px-4 py-3 text-right text-ios-orange font-medium">{row.stock_qty}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{row.min_stock}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setAdjustForm({ product_id: row.id, qty_change: '', note: '' }); setAdjustOpen(true); }}
                    >
                      Sesuaikan
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}

      {tab === 'adjust' && (
        <Card title="Penyesuaian Stok Manual">
          <p className="text-sm text-slate-400 mb-4">
            Gunakan tombol <strong>Penyesuaian</strong> di kanan atas untuk mencatat barang rusak, hilang, atau koreksi stok.
            Setiap penyesuaian tercatat di kartu stok.
          </p>
          <Button onClick={() => setAdjustOpen(true)}><ArrowLeftRight size={16} /> Buat Penyesuaian</Button>
        </Card>
      )}

      <Modal
        isOpen={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Penyesuaian Stok"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setAdjustOpen(false)}>Batal</Button>
            <Button onClick={submitAdjust} disabled={!adjustForm.product_id || !adjustForm.qty_change}>Simpan</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input as="select" label="Produk *" value={adjustForm.product_id} onChange={(e) => setAdjustForm({ ...adjustForm, product_id: e.target.value })}>
            <option value="">- Pilih Produk -</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (stok {p.stock_qty})</option>
            ))}
          </Input>
          <Input
            label="Perubahan Stok * (contoh: -3 untuk barang rusak, 5 untuk koreksi tambah)"
            type="number"
            value={adjustForm.qty_change}
            onChange={(e) => setAdjustForm({ ...adjustForm, qty_change: e.target.value })}
          />
          <Input label="Catatan" value={adjustForm.note} onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })} placeholder="Barang rusak" />
        </div>
      </Modal>
    </div>
  );
};

export default Stock;

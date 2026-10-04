import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Power, PackagePlus, Wand2, RefreshCw, LayoutList, Barcode } from 'lucide-react';
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
import ConfirmDialog from '../components/ui/ConfirmDialog';
import BundleBarcodeTab from '../components/bundles/BundleBarcodeTab';
import { formatCurrency } from '../utils/formatters';

const EMPTY = { sku: '', name: '', barcode: '', price: '', is_active: true, items: [] };

const TABS = [
  { key: 'list', label: 'Daftar Paket', icon: LayoutList },
  { key: 'barcode', label: 'Barcode', icon: Barcode },
];

const Bundles = () => {
  const toast = useToastContext();
  const [tab, setTab] = useState('list');
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/bundles', { page, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/products', { limit: 200 }).then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, items: [{ product_id: '', qty: 1 }] });
    setModalOpen(true);
  };

  const openEdit = async (bundle) => {
    setEditing(bundle);
    try {
      const full = await api.get(`/api/bundles/${bundle.id}`);
      setForm({
        sku: full.sku,
        name: full.name,
        barcode: full.barcode || '',
        price: full.price,
        is_active: full.is_active,
        items: full.items.map((i) => ({ product_id: String(i.product_id), qty: i.qty })),
      });
      setModalOpen(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateItem = (index, patch) => {
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const addItemRow = () => setForm((f) => ({ ...f, items: [...f.items, { product_id: '', qty: 1 }] }));
  const removeItemRow = (index) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));

  const componentCost = form.items.reduce((sum, it) => {
    const p = products.find((x) => String(x.id) === String(it.product_id));
    return sum + (p ? Number(p.cost_price) * Number(it.qty || 0) : 0);
  }, 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        sku: form.sku,
        name: form.name,
        barcode: form.barcode || null,
        price: form.price,
        is_active: form.is_active,
        items: form.items
          .filter((it) => it.product_id)
          .map((it) => ({ product_id: Number(it.product_id), qty: Number(it.qty) })),
      };
      if (editing) {
        await api.put(`/api/bundles/${editing.id}`, payload);
        toast.success('Paket diperbarui');
      } else {
        await api.post('/api/bundles', payload);
        toast.success('Paket ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await api.del(`/api/bundles/${confirm.id}`);
      toast.success(res?.message || 'Paket dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (bundle) => {
    try {
      await api.put(`/api/bundles/${bundle.id}`, { is_active: !bundle.is_active });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const viewDetail = async (bundle) => {
    try {
      setDetail(await api.get(`/api/bundles/${bundle.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const generateBarcode = async () => {
    setGenerating(true);
    try {
      const res = await api.get('/api/bundles/barcode/generate');
      setForm((f) => ({ ...f, barcode: res.barcode }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Nama Paket' },
    { key: 'price', label: 'Harga Paket', align: 'right' },
    { key: 'items', label: 'Komponen', align: 'center' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Paket Bundling"
        subtitle="Paket produk dengan harga tetap; stok komponen berkurang saat terjual"
        actions={<Button onClick={openCreate}><PackagePlus size={16} /> Paket Baru</Button>}
      />

      <div className="flex flex-wrap gap-2 mb-5">
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

      {tab === 'barcode' ? (
        <BundleBarcodeTab />
      ) : (
      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada paket">
            {data.data.map((bundle) => (
              <tr key={bundle.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{bundle.sku}</td>
                <td className="px-4 py-3 text-white">
                  <button className="hover:text-ios-blue text-left" onClick={() => viewDetail(bundle)}>{bundle.name}</button>
                  {bundle.barcode && <div className="text-xs text-slate-500 font-mono">{bundle.barcode}</div>}
                </td>
                <td className="px-4 py-3 text-right text-ios-green">{formatCurrency(bundle.price)}</td>
                <td className="px-4 py-3 text-center text-slate-300">{bundle.item_count} item</td>
                <td className="px-4 py-3 text-center">
                  {bundle.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(bundle)} title={bundle.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
                      <Power size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(bundle)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(bundle)}><Trash2 size={14} className="text-ios-red" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Paket' : 'Paket Baru'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label="SKU *" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <div>
            <Input
              label="Barcode (EAN-13 internal)"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              title="Kode EAN-13; gunakan Generate untuk membuat kode internal otomatis"
            />
            <div className="flex gap-2 mt-1.5">
              <Button variant="neutral" size="sm" onClick={generateBarcode} disabled={generating}>
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />}
                Generate
              </Button>
            </div>
          </div>
          <Input label="Nama Paket *" className="col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Harga Paket (Rp) *" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
          </Input>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">Komponen Paket *</span>
            <Button variant="neutral" size="sm" onClick={addItemRow}><Plus size={14} /> Tambah Komponen</Button>
          </div>
          <div className="space-y-2">
            {form.items.map((item, index) => (
              <div key={index} className="flex gap-2 items-end">
                <Input
                  as="select"
                  label={index === 0 ? 'Produk' : ''}
                  className="flex-1"
                  value={item.product_id}
                  onChange={(e) => updateItem(index, { product_id: e.target.value })}
                >
                  <option value="">- Pilih Produk -</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock_qty} {p.base_unit})</option>)}
                </Input>
                <Input
                  label={index === 0 ? 'Qty' : ''}
                  type="number"
                  className="w-24"
                  value={item.qty}
                  onChange={(e) => updateItem(index, { qty: e.target.value })}
                />
                <Button variant="ghost" size="sm" onClick={() => removeItemRow(index)} disabled={form.items.length === 1}>
                  <Trash2 size={14} className="text-ios-red" />
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            HPP total komponen: {formatCurrency(componentCost)}. Paket dijual dengan harga tetap di atas, tanpa tier/promo item.
          </p>
        </div>
      </Modal>

      <Modal isOpen={Boolean(detail)} onClose={() => setDetail(null)} title={`Detail Paket - ${detail?.name || ''}`} size="md">
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Harga Paket</div>
                <div className="text-ios-green">{formatCurrency(detail.price)}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">SKU / Barcode</div>
                <div className="text-white font-mono text-xs">{detail.sku} {detail.barcode ? `• ${detail.barcode}` : ''}</div>
              </div>
            </div>
            <div className="space-y-1">
              {detail.items.map((i) => (
                <div key={i.id} className="flex justify-between px-3 py-2 bg-white/5 rounded-ios-sm text-sm">
                  <span className="text-white">{i.product_name}</span>
                  <span className="text-slate-400">{i.qty} {i.base_unit} • sisa {i.stock_qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={handleDelete}
        title="Hapus Paket"
        message={`Hapus paket "${confirm?.name}"? Paket yang sudah dipakai transaksi akan dinonaktifkan, bukan dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Bundles;

import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Wallet, Users, Package, BarChart3 } from 'lucide-react';
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
import { formatCurrency, formatDateTime, todayIso, firstOfMonthIso } from '../utils/formatters';

const TABS = [
  { key: 'consignors', label: 'Penitip', icon: Users },
  { key: 'products', label: 'Barang Titipan', icon: Package },
  { key: 'sales', label: 'Penjualan', icon: BarChart3 },
  { key: 'payables', label: 'Hutang & Pembayaran', icon: Wallet },
];

const EMPTY_CONSIGNOR = { name: '', phone: '', address: '', note: '' };

const Consignment = () => {
  const toast = useToastContext();
  const [tab, setTab] = useState('consignors');

  const [consignors, setConsignors] = useState({ data: [], pagination: null });
  const [consignorPage, setConsignorPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CONSIGNOR);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [products, setProducts] = useState({ data: [], pagination: null });
  const [productPage, setProductPage] = useState(1);

  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [salesReport, setSalesReport] = useState(null);

  const [payables, setPayables] = useState([]);
  const [payouts, setPayouts] = useState({ data: [], pagination: null });
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState(null);
  const [payoutForm, setPayoutForm] = useState({ amount: '', period_from: '', period_to: '', note: '' });

  const loadConsignors = useCallback(async () => {
    setLoading(true);
    try {
      setConsignors(await api.get('/api/consignment/consignors', { page: consignorPage, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [consignorPage, toast]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await api.get('/api/consignment/products', { page: productPage, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [productPage, toast]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      setSalesReport(await api.get('/api/consignment/sales', range));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [range, toast]);

  const loadPayables = useCallback(async () => {
    setLoading(true);
    try {
      const [p, pay] = await Promise.all([
        api.get('/api/consignment/payables'),
        api.get('/api/consignment/payouts', { page: payoutPage, limit: 25 }),
      ]);
      setPayables(p.rows);
      setPayouts(pay);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [payoutPage, toast]);

  useEffect(() => {
    if (tab === 'consignors') loadConsignors();
    else if (tab === 'products') loadProducts();
    else if (tab === 'sales') loadSales();
    else if (tab === 'payables') loadPayables();
  }, [tab, loadConsignors, loadProducts, loadSales, loadPayables]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_CONSIGNOR);
    setModalOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.consignor_name, phone: c.phone || '', address: c.address || '', note: c.note || '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/consignment/consignors/${editing.consignor_id}`, form);
        toast.success('Penitip diperbarui');
      } else {
        await api.post('/api/consignment/consignors', form);
        toast.success('Penitip ditambahkan');
      }
      setModalOpen(false);
      loadConsignors();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await api.del(`/api/consignment/consignors/${confirm.consignor_id}`);
      toast.success(res?.message || 'Penitip dihapus');
      setConfirm(null);
      loadConsignors();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openPayout = (row) => {
    setPayoutTarget(row);
    setPayoutForm({ amount: String(row.payable), period_from: range.from, period_to: range.to, note: '' });
    setPayoutOpen(true);
  };

  const submitPayout = async () => {
    setSaving(true);
    try {
      await api.post('/api/consignment/payouts', {
        consignor_id: payoutTarget.consignor_id,
        amount: payoutForm.amount,
        period_from: payoutForm.period_from || null,
        period_to: payoutForm.period_to || null,
        note: payoutForm.note || null,
      });
      toast.success('Pembayaran dicatat');
      setPayoutOpen(false);
      loadPayables();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Konsinyasi" subtitle="Kelola barang titipan, penjualan, dan pembayaran ke penitip" />

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-ios-sm text-sm transition-colors ${tab === key ? 'bg-ios-blue text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === 'consignors' && (
        <Card padded={false}>
          <div className="p-4 flex justify-end border-b border-white/10">
            <Button onClick={openCreate}><Plus size={16} /> Penitip Baru</Button>
          </div>
          <div className="p-4">
            <Table
              columns={[
                { key: 'name', label: 'Nama' },
                { key: 'phone', label: 'Telepon' },
                { key: 'hutang', label: 'Hutang', align: 'right' },
                { key: 'status', label: 'Status', align: 'center' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              loading={loading}
              empty="Belum ada penitip"
            >
              {consignors.data.map((c) => (
                <tr key={c.consignor_id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{c.consignor_name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.phone || '-'}</td>
                  <td className="px-4 py-3 text-right text-ios-orange">{formatCurrency(c.payable)}</td>
                  <td className="px-4 py-3 text-center">
                    {c.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirm(c)}><Trash2 size={14} className="text-ios-red" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination pagination={consignors.pagination} onChange={setConsignorPage} />
          </div>
        </Card>
      )}

      {tab === 'products' && (
        <Card padded={false}>
          <div className="p-4">
            <p className="text-xs text-slate-400 mb-3">
              Produk konsinyasi ditandai dari halaman Produk (toggle &quot;Barang Titipan&quot;). Barang masuk stok melalui Pembelian/Penerimaan.
            </p>
            <Table
              columns={[
                { key: 'sku', label: 'SKU' },
                { key: 'name', label: 'Produk' },
                { key: 'consignor', label: 'Penitip' },
                { key: 'cost', label: 'Harga Setor', align: 'right' },
                { key: 'stock', label: 'Sisa Stok', align: 'right' },
              ]}
              loading={loading}
              empty="Belum ada produk konsinyasi"
            >
              {products.data.map((p) => (
                <tr key={p.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.sku}</td>
                  <td className="px-4 py-3 text-white">{p.name}</td>
                  <td className="px-4 py-3 text-slate-400">{p.consignor_name || '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(p.cost_price)}</td>
                  <td className="px-4 py-3 text-right text-white">{p.stock_qty} {p.base_unit}</td>
                </tr>
              ))}
            </Table>
            <Pagination pagination={products.pagination} onChange={setProductPage} />
          </div>
        </Card>
      )}

      {tab === 'sales' && (
        <Card padded={false}>
          <div className="p-4 flex flex-wrap gap-3 border-b border-white/10">
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
            <Table
              columns={[
                { key: 'consignor', label: 'Penitip' },
                { key: 'qty', label: 'Qty Terjual', align: 'right' },
                { key: 'setor', label: 'Nilai Setor', align: 'right' },
                { key: 'jual', label: 'Nilai Jual', align: 'right' },
              ]}
              loading={loading}
              empty="Tidak ada penjualan konsinyasi pada periode ini"
            >
              {(salesReport?.summary || []).map((r) => (
                <tr key={r.consignor_id ?? 'none'} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{r.consignor_name}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{r.qty_sold}</td>
                  <td className="px-4 py-3 text-right text-ios-orange">{formatCurrency(r.payable_value)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(r.sale_value)}</td>
                </tr>
              ))}
            </Table>

            {(salesReport?.detail || []).length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-medium text-white mb-2">Rincian per Produk</p>
                <Table
                  columns={[
                    { key: 'sku', label: 'SKU' },
                    { key: 'name', label: 'Produk' },
                    { key: 'consignor', label: 'Penitip' },
                    { key: 'qty', label: 'Qty', align: 'right' },
                    { key: 'setor', label: 'Nilai Setor', align: 'right' },
                  ]}
                  empty=""
                >
                  {salesReport.detail.map((r) => (
                    <tr key={r.product_id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{r.sku}</td>
                      <td className="px-4 py-3 text-white">{r.product_name}</td>
                      <td className="px-4 py-3 text-slate-400">{r.consignor_name}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{r.qty_sold}</td>
                      <td className="px-4 py-3 text-right text-ios-orange">{formatCurrency(r.payable_value)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === 'payables' && (
        <>
          <Card padded={false} className="mb-5">
            <div className="p-4">
              <p className="text-sm font-medium text-white mb-3">Hutang Berjalan per Penitip</p>
              <Table
                columns={[
                  { key: 'name', label: 'Penitip' },
                  { key: 'qty', label: 'Qty Terjual', align: 'right' },
                  { key: 'sold', label: 'Nilai Setor', align: 'right' },
                  { key: 'paid', label: 'Sudah Dibayar', align: 'right' },
                  { key: 'payable', label: 'Hutang', align: 'right' },
                  { key: 'actions', label: '', align: 'right' },
                ]}
                loading={loading}
                empty="Belum ada hutang"
              >
                {payables.map((r) => (
                  <tr key={r.consignor_id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{r.consignor_name}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{r.qty_sold}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(r.sold_value)}</td>
                    <td className="px-4 py-3 text-right text-ios-green">{formatCurrency(r.paid_total)}</td>
                    <td className="px-4 py-3 text-right text-ios-orange font-medium">{formatCurrency(r.payable)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="neutral" size="sm" onClick={() => openPayout(r)} disabled={r.payable <= 0}>
                        <Wallet size={14} /> Bayar
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>

          <Card padded={false}>
            <div className="p-4">
              <p className="text-sm font-medium text-white mb-3">Riwayat Pembayaran</p>
              <Table
                columns={[
                  { key: 'date', label: 'Tanggal' },
                  { key: 'consignor', label: 'Penitip' },
                  { key: 'period', label: 'Periode' },
                  { key: 'amount', label: 'Jumlah', align: 'right' },
                  { key: 'note', label: 'Catatan' },
                ]}
                loading={loading}
                empty="Belum ada pembayaran"
              >
                {payouts.data.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-slate-400 text-sm">{formatDateTime(p.created_at)}</td>
                    <td className="px-4 py-3 text-white">{p.consignor_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {p.period_from || p.period_to ? `${p.period_from || '...'} s/d ${p.period_to || '...'}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-ios-green">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-slate-400">{p.note || '-'}</td>
                  </tr>
                ))}
              </Table>
              <Pagination pagination={payouts.pagination} onChange={setPayoutPage} />
            </div>
          </Card>
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Penitip' : 'Penitip Baru'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input label="Nama Penitip *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input as="textarea" label="Alamat" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input as="textarea" label="Catatan" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
      </Modal>

      <Modal
        isOpen={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        title={`Bayar ke ${payoutTarget?.consignor_name || ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setPayoutOpen(false)}>Batal</Button>
            <Button variant="success" onClick={submitPayout} disabled={saving}>{saving ? 'Menyimpan...' : 'Catat Pembayaran'}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="p-3 bg-white/5 rounded-ios-sm text-sm flex justify-between">
            <span className="text-slate-400">Hutang berjalan</span>
            <span className="text-ios-orange font-medium">{formatCurrency(payoutTarget?.payable)}</span>
          </div>
          <Input label="Jumlah Bayar (Rp) *" type="number" value={payoutForm.amount} onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Periode Dari" type="date" value={payoutForm.period_from} onChange={(e) => setPayoutForm({ ...payoutForm, period_from: e.target.value })} />
            <Input label="Periode Sampai" type="date" value={payoutForm.period_to} onChange={(e) => setPayoutForm({ ...payoutForm, period_to: e.target.value })} />
          </div>
          <Input label="Catatan" value={payoutForm.note} onChange={(e) => setPayoutForm({ ...payoutForm, note: e.target.value })} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={handleDelete}
        title="Hapus Penitip"
        message={`Hapus penitip "${confirm?.name}"? Penitip yang masih terkait produk akan dinonaktifkan, bukan dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Consignment;

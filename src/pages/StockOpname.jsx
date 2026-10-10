import { useState, useEffect, useCallback } from 'react';
import { Plus, Eye, CheckCircle2, Search } from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { formatDate, formatDateTime } from '../utils/formatters';

const StockOpname = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const canManage = can('stock.manage');
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ date: '', note: '' });
  const [detail, setDetail] = useState(null);
  const [counts, setCounts] = useState({});
  const [postConfirm, setPostConfirm] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/stock/opnames', { page, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { load(); }, [load]);

  const createOpname = async () => {
    try {
      const created = await api.post('/api/stock/opnames', createForm);
      toast.success(`Opname ${created.code} dibuat`);
      setCreateOpen(false);
      setCreateForm({ date: '', note: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openDetail = async (opname) => {
    try {
      const full = await api.get(`/api/stock/opnames/${opname.id}`);
      setDetail(full);
      const initial = {};
      full.items.forEach((item) => { initial[item.product_id] = item.counted_qty; });
      setCounts(initial);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveCounts = async () => {
    try {
      const items = Object.entries(counts).map(([productId, counted]) => ({
        product_id: Number(productId),
        counted_qty: Number(counted) || 0,
      }));
      await api.put(`/api/stock/opnames/${detail.id}/items`, { items });
      toast.success('Hitungan disimpan');
      openDetail(detail);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const postOpname = async () => {
    try {
      const result = await api.post(`/api/stock/opnames/${postConfirm.id}/post`, {});
      toast.success(`Opname diposting. ${result.adjusted} produk disesuaikan.`);
      setPostConfirm(null);
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setPostConfirm(null);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode' },
    { key: 'date', label: 'Tanggal' },
    { key: 'user', label: 'Petugas' },
    { key: 'items', label: 'Jumlah Item', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  const filteredItems = detail
    ? detail.items.filter(
        (item) =>
          !search ||
          item.product_name.toLowerCase().includes(search.toLowerCase()) ||
          item.sku.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  return (
    <div>
      <PageHeader
        title="Stok Opname"
        subtitle="Hitung fisik stok dan sesuaikan selisih"
        actions={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} /> Opname Baru</Button> : undefined}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada opname">
            {data.data.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-sm text-white">{row.code}</td>
                <td className="px-4 py-3 text-slate-300">{formatDate(row.date)}</td>
                <td className="px-4 py-3 text-slate-400">{row.user_name || '-'}</td>
                <td className="px-4 py-3 text-right text-slate-400">{row.item_count}</td>
                <td className="px-4 py-3 text-center">
                  {row.status === 'posted' ? <Badge tone="green">Posted</Badge> : <Badge tone="orange">Draft</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openDetail(row)}><Eye size={14} /></Button>
                    {canManage && row.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => setPostConfirm(row)} title="Posting">
                        <CheckCircle2 size={14} className="text-ios-green" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Opname Baru"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button onClick={createOpname}>Buat</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Tanggal" type="date" value={createForm.date} onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })} />
          <Input label="Catatan" value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} />
          <p className="text-xs text-slate-400">
            Opname akan memuat semua produk aktif dengan stok sistem. Anda mengisi jumlah fisik, lalu posting untuk menerapkan selisih.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={`Opname ${detail?.code || ''}`}
        size="xl"
        footer={
          detail?.status === 'draft' ? (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">Perubahan hanya diterapkan saat posting.</span>
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="neutral" onClick={saveCounts}>Simpan Hitungan</Button>
                  <Button variant="success" onClick={() => setPostConfirm(detail)}>
                    <CheckCircle2 size={16} /> Posting Opname
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-right text-sm text-slate-400">
              Diposting {detail?.posted_at ? formatDateTime(detail.posted_at) : ''}
            </div>
          )
        }
      >
        {detail && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Tanggal</div>
                <div className="text-white">{formatDate(detail.date)}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Petugas</div>
                <div className="text-white">{detail.user_name || '-'}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Status</div>
                <div className="text-white">{detail.status === 'posted' ? 'Posted' : 'Draft'}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Total Item</div>
                <div className="text-white">{detail.items.length}</div>
              </div>
            </div>

            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
                placeholder="Cari produk..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="max-h-[45vh] overflow-y-auto rounded-ios-sm border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs text-slate-400">Produk</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400">Sistem</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400">Fisik</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400">Selisih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredItems.map((item) => {
                    const counted = counts[item.product_id] ?? item.counted_qty;
                    const diff = Number(counted) - item.system_qty;
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2">
                          <div className="text-white">{item.product_name}</div>
                          <div className="text-xs text-slate-400 font-mono">{item.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">{item.system_qty}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="w-20 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-right text-white focus:outline-none focus:border-ios-blue/60 disabled:opacity-50"
                            value={counted}
                            disabled={detail.status === 'posted'}
                            onChange={(e) => setCounts({ ...counts, [item.product_id]: e.target.value })}
                          />
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${diff > 0 ? 'text-ios-green' : diff < 0 ? 'text-ios-red' : 'text-slate-400'}`}>
                          {diff > 0 ? '+' : ''}{diff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(postConfirm)}
        onClose={() => setPostConfirm(null)}
        onConfirm={postOpname}
        title="Posting Opname"
        message={`Posting opname ${postConfirm?.code}? Selisih stok akan diterapkan dan tidak dapat dibatalkan.`}
        confirmLabel="Posting"
        variant="success"
      />
    </div>
  );
};

export default StockOpname;

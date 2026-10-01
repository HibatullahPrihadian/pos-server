import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Power } from 'lucide-react';
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

const DAYS = [
  { value: 0, label: 'Min' },
  { value: 1, label: 'Sen' },
  { value: 2, label: 'Sel' },
  { value: 3, label: 'Rab' },
  { value: 4, label: 'Kam' },
  { value: 5, label: 'Jum' },
  { value: 6, label: 'Sab' },
];

const EMPTY = {
  name: '', scope: 'product', product_id: '', category_id: '', unit_id: '',
  discount_type: 'percent', discount_value: '', min_qty: '1',
  start_time: '', end_time: '', days_of_week: [],
  start_date: '', end_date: '', is_active: true,
};

const DISCOUNT_LABEL = { percent: 'Persen (%)', amount: 'Nominal (Rp)', batch_price: 'Harga Batch' };

const Promotions = () => {
  const toast = useToastContext();
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/promotions', { page, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/categories').then(setCategories).catch(() => {});
    api.get('/api/products', { limit: 200 }).then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (promo) => {
    setEditing(promo);
    setForm({
      name: promo.name,
      scope: promo.scope,
      product_id: promo.product_id || '',
      category_id: promo.category_id || '',
      unit_id: promo.unit_id || '',
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      min_qty: promo.min_qty,
      start_time: promo.start_time ? String(promo.start_time).slice(0, 5) : '',
      end_time: promo.end_time ? String(promo.end_time).slice(0, 5) : '',
      days_of_week: promo.days_of_week || [],
      start_date: promo.start_date ? String(promo.start_date).slice(0, 10) : '',
      end_date: promo.end_date ? String(promo.end_date).slice(0, 10) : '',
      is_active: promo.is_active,
    });
    setModalOpen(true);
  };

  const toggleDay = (day) => {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(day)
        ? f.days_of_week.filter((d) => d !== day)
        : [...f.days_of_week, day],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        product_id: form.scope === 'product' ? (form.product_id || null) : null,
        category_id: form.scope === 'category' ? (form.category_id || null) : null,
        unit_id: form.unit_id || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        days_of_week: form.days_of_week.length ? form.days_of_week : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (editing) {
        await api.put(`/api/promotions/${editing.id}`, payload);
        toast.success('Promo diperbarui');
      } else {
        await api.post('/api/promotions', payload);
        toast.success('Promo ditambahkan');
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
      const res = await api.del(`/api/promotions/${confirm.id}`);
      toast.success(res?.message || 'Promo dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (promo) => {
    try {
      await api.put(`/api/promotions/${promo.id}`, { is_active: !promo.is_active });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const target = (promo) => (promo.scope === 'product' ? promo.product_name : promo.category_name) || '-';

  const columns = [
    { key: 'name', label: 'Nama' },
    { key: 'target', label: 'Target' },
    { key: 'discount', label: 'Diskon' },
    { key: 'period', label: 'Periode' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Promo"
        subtitle="Diskon berbasis periode: produk/kategori, jam, hari, dan tanggal"
        actions={<Button onClick={openCreate}><Plus size={16} /> Promo Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada promo">
            {data.data.map((promo) => (
              <tr key={promo.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{promo.name}</td>
                <td className="px-4 py-3 text-slate-400">
                  <Badge tone={promo.scope === 'product' ? 'blue' : 'purple'}>{promo.scope === 'product' ? 'Produk' : 'Kategori'}</Badge>
                  <span className="ml-2">{target(promo)}</span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {promo.discount_type === 'percent' && `${Number(promo.discount_value)}%`}
                  {promo.discount_type === 'amount' && `Rp ${Number(promo.discount_value).toLocaleString('id-ID')}`}
                  {promo.discount_type === 'batch_price' && `Rp ${Number(promo.discount_value).toLocaleString('id-ID')} / ${promo.min_qty}`}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  <div>
                    {(promo.start_time ? String(promo.start_time).slice(0, 5) : '00:00')}
                    {' - '}
                    {(promo.end_time ? String(promo.end_time).slice(0, 5) : '23:59')}
                  </div>
                  <div>
                    {promo.days_of_week?.length
                      ? promo.days_of_week.map((d) => DAYS.find((x) => x.value === Number(d))?.label).join(', ')
                      : 'Tiap hari'}
                  </div>
                  {(promo.start_date || promo.end_date) && (
                    <div>
                      {promo.start_date ? String(promo.start_date).slice(0, 10) : '...'}
                      {' s/d '}
                      {promo.end_date ? String(promo.end_date).slice(0, 10) : '...'}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {promo.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(promo)} title={promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
                      <Power size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(promo)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(promo)}><Trash2 size={14} className="text-ios-red" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Promo' : 'Promo Baru'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nama Promo *" className="col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <Input as="select" label="Scope *" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="product">Per Produk</option>
            <option value="category">Per Kategori</option>
          </Input>
          {form.scope === 'product' ? (
            <Input as="select" label="Produk *" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              <option value="">- Pilih -</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Input>
          ) : (
            <Input as="select" label="Kategori *" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">- Pilih -</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Input>
          )}

          <Input as="select" label="Tipe Diskon *" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
            {Object.entries(DISCOUNT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Input>
          {form.discount_type === 'batch_price' ? (
            <Input label="Harga Total per Batch (Rp) *" type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} placeholder="mis. 10000" />
          ) : (
            <Input label={form.discount_type === 'percent' ? 'Diskon (%) *' : 'Diskon (Rp) *'} type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
          )}

          <Input label="Min Qty *" type="number" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} placeholder="1" />
          <Input label="Jam Mulai" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <Input label="Jam Selesai" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          <Input label="Tanggal Mulai" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <Input label="Tanggal Selesai" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />

          <div className="col-span-2">
            <span className="block mb-1.5 text-xs font-medium text-slate-400">Hari Berlaku (kosong = tiap hari)</span>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${form.days_of_week.includes(d.value) ? 'bg-ios-blue text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
          </Input>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Harga batch: `discount_value` adalah harga total untuk `min_qty` unit. Rentang jam boleh melewati tengah malam (mis. 22:00 - 02:00).
        </p>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={handleDelete}
        title="Hapus Promo"
        message={`Hapus promo "${confirm?.name}"? Promo yang sudah dipakai transaksi akan dinonaktifkan, bukan dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Promotions;

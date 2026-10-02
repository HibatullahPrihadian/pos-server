import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, CreditCard, Tags } from 'lucide-react';
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
import { formatCurrency, formatDate, parseMoney, todayIso } from '../utils/formatters';

const emptyForm = () => ({
  expense_category_id: '',
  date: todayIso(),
  amount: '',
  payment_status: 'paid',
  method: '',
  note: '',
});

const Expenses = () => {
  const toast = useToastContext();
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', is_active: true });
  const [editingCat, setEditingCat] = useState(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [catConfirm, setCatConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/expenses', {
        page,
        limit: 25,
        payment_status: statusFilter,
        category_id: categoryFilter,
      }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, categoryFilter, toast]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.get('/api/expenses/categories', { include_inactive: true }));
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setModalOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      expense_category_id: row.expense_category_id || '',
      date: String(row.date).slice(0, 10),
      amount: row.amount,
      payment_status: row.payment_status,
      method: row.method || '',
      note: row.note || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        expense_category_id: form.expense_category_id || null,
        date: form.date,
        amount: parseMoney(form.amount),
        payment_status: form.payment_status,
        method: form.method,
        note: form.note,
      };
      if (!payload.amount || payload.amount <= 0) return toast.warning('Jumlah beban harus lebih dari 0');
      if (editing) await api.put(`/api/expenses/${editing.id}`, payload);
      else await api.post('/api/expenses', payload);
      toast.success(editing ? 'Beban diperbarui' : 'Beban dicatat');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/expenses/${confirm.id}`);
      toast.success('Beban dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  };

  const openPayment = (row) => {
    setPaymentTarget(row);
    setPaymentAmount(String(Number(row.amount) - Number(row.paid_amount)));
    setPaymentOpen(true);
  };

  const submitPayment = async () => {
    try {
      const amount = parseMoney(paymentAmount);
      if (!amount || amount <= 0) return toast.warning('Jumlah bayar tidak valid');
      await api.post(`/api/expenses/${paymentTarget.id}/payment`, { amount });
      toast.success('Pembayaran dicatat');
      setPaymentOpen(false);
      setPaymentTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openCatCreate = () => { setEditingCat(null); setCatForm({ name: '', is_active: true }); setCatModalOpen(true); };
  const openCatEdit = (row) => { setEditingCat(row); setCatForm({ name: row.name, is_active: row.is_active }); setCatModalOpen(true); };

  const saveCategory = async () => {
    try {
      if (editingCat) await api.put(`/api/expenses/categories/${editingCat.id}`, catForm);
      else await api.post('/api/expenses/categories', catForm);
      toast.success(editingCat ? 'Kategori diperbarui' : 'Kategori ditambahkan');
      setCatModalOpen(false);
      loadCategories();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeCategory = async () => {
    try {
      await api.del(`/api/expenses/categories/${catConfirm.id}`);
      toast.success('Kategori dihapus');
      setCatConfirm(null);
      loadCategories();
    } catch (err) {
      toast.error(err.message);
      setCatConfirm(null);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode' },
    { key: 'date', label: 'Tanggal' },
    { key: 'category', label: 'Kategori' },
    { key: 'note', label: 'Keterangan' },
    { key: 'amount', label: 'Jumlah', align: 'right' },
    { key: 'status', label: 'Bayar', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Beban Operasional"
        subtitle="Catat biaya operasional toko (gaji, sewa, listrik, dll.) untuk laporan laba rugi"
        actions={
          <div className="flex gap-2">
            <Button variant="neutral" onClick={openCatCreate}><Tags size={16} /> Kategori</Button>
            <Button onClick={openCreate}><Plus size={16} /> Beban Baru</Button>
          </div>
        }
      />

      <Card padded={false}>
        <div className="p-4 border-b border-white/10 flex flex-wrap gap-3">
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          >
            <option value="">Semua Kategori</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Semua Status</option>
            <option value="paid">Lunas</option>
            <option value="unpaid">Belum Lunas</option>
          </select>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada beban">
            {data.data.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-sm text-white">{row.code}</td>
                <td className="px-4 py-3 text-slate-400">{formatDate(row.date)}</td>
                <td className="px-4 py-3 text-slate-300">{row.category_name || '-'}</td>
                <td className="px-4 py-3 text-slate-400">{row.note || '-'}</td>
                <td className="px-4 py-3 text-right text-white">{formatCurrency(row.amount)}</td>
                <td className="px-4 py-3 text-center">
                  {row.payment_status === 'paid' ? (
                    <Badge tone="green">Lunas</Badge>
                  ) : (
                    <Badge tone="orange">Belum Lunas</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {row.payment_status === 'unpaid' && (
                      <Button variant="ghost" size="sm" onClick={() => openPayment(row)} title="Bayar">
                        <CreditCard size={14} className="text-ios-blue" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title="Ubah"><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(row)} title="Hapus"><Trash2 size={14} className="text-ios-red" /></Button>
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
        title={editing ? `Ubah Beban ${editing.code}` : 'Beban Baru'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save}>Simpan</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input as="select" label="Kategori" value={form.expense_category_id} onChange={(e) => setForm({ ...form, expense_category_id: e.target.value })}>
            <option value="">- Tanpa Kategori -</option>
            {categories.filter((c) => c.is_active || String(c.id) === String(form.expense_category_id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Input>
          <Input label="Tanggal" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Jumlah (Rp) *" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
          <Input as="select" label="Status Bayar" value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
            <option value="paid">Lunas</option>
            <option value="unpaid">Belum Lunas</option>
          </Input>
          <Input label="Metode (opsional)" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} placeholder="cash / transfer" />
        </div>
        <div className="mt-3">
          <Input as="textarea" label="Keterangan" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
      </Modal>

      <Modal
        isOpen={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={`Pembayaran ${paymentTarget?.code || ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setPaymentOpen(false)}>Batal</Button>
            <Button onClick={submitPayment}><CreditCard size={16} /> Bayar</Button>
          </div>
        }
      >
        {paymentTarget && (
          <div className="space-y-4">
            <div className="text-sm text-slate-300">
              Jumlah Beban: <span className="text-white font-semibold">{formatCurrency(paymentTarget.amount)}</span><br />
              Sudah Dibayar: <span className="text-white font-semibold">{formatCurrency(paymentTarget.paid_amount)}</span><br />
              Sisa: <span className="text-ios-orange font-semibold">{formatCurrency(Number(paymentTarget.amount) - Number(paymentTarget.paid_amount))}</span>
            </div>
            <Input label="Jumlah Bayar" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} autoFocus />
          </div>
        )}
      </Modal>

      <Modal
        isOpen={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        title="Kategori Beban"
        size="md"
        footer={<Button variant="neutral" onClick={() => setCatModalOpen(false)}>Tutup</Button>}
      >
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <Input
              label={editingCat ? 'Ubah Nama Kategori' : 'Kategori Baru'}
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              placeholder="mis. Gaji"
            />
          </div>
          <Button onClick={saveCategory}>{editingCat ? 'Perbarui' : 'Tambah'}</Button>
          {editingCat && (
            <Button variant="neutral" onClick={openCatCreate}>Batal</Button>
          )}
        </div>
        <Table
          columns={[
            { key: 'name', label: 'Nama' },
            { key: 'expense_count', label: 'Dipakai', align: 'right' },
            { key: 'status', label: 'Status', align: 'center' },
            { key: 'actions', label: '', align: 'right' },
          ]}
          empty="Belum ada kategori"
        >
          {categories.map((c) => (
            <tr key={c.id} className="hover:bg-white/5">
              <td className="px-4 py-2 text-white">{c.name}</td>
              <td className="px-4 py-2 text-right text-slate-400">{c.expense_count}</td>
              <td className="px-4 py-2 text-center">
                {c.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
              </td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openCatEdit(c)}><Pencil size={14} /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setCatConfirm(c)}><Trash2 size={14} className="text-ios-red" /></Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Hapus Beban"
        message={`Hapus beban ${confirm?.code} sebesar ${formatCurrency(confirm?.amount)}? Tindakan ini tercatat di audit.`}
        confirmLabel="Hapus"
      />

      <ConfirmDialog
        isOpen={Boolean(catConfirm)}
        onClose={() => setCatConfirm(null)}
        onConfirm={removeCategory}
        title="Hapus Kategori Beban"
        message={`Hapus kategori "${catConfirm?.name}"? Kategori yang masih dipakai beban tidak dapat dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Expenses;

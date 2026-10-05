import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Search, Ban } from 'lucide-react';
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
import useDebounce from '../hooks/useDebounce';
import { formatCurrency, parseMoney } from '../utils/formatters';

const EMPTY = {
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  npwp: '',
  payment_term_days: '0',
  credit_limit: '0',
};

const TERM_OPTIONS = [0, 7, 14, 30, 60];

const Customers = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const canManage = can('customer.manage');
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/customers', { page, limit: 25, search: debouncedSearch }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (customer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      contact_name: customer.contact_name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      npwp: customer.npwp || '',
      payment_term_days: String(customer.payment_term_days ?? 0),
      credit_limit: String(customer.credit_limit ?? 0),
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        payment_term_days: Number(form.payment_term_days) || 0,
        credit_limit: parseMoney(form.credit_limit),
      };
      if (editing) await api.put(`/api/customers/${editing.id}`, payload);
      else await api.post('/api/customers', payload);
      toast.success(editing ? 'Pelanggan diperbarui' : 'Pelanggan ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (customer) => {
    if (!window.confirm(`Nonaktifkan pelanggan ${customer.name}?`)) return;
    try {
      await api.del(`/api/customers/${customer.id}`);
      toast.success('Pelanggan dinonaktifkan');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode' },
    { key: 'name', label: 'Pelanggan' },
    { key: 'contact', label: 'Kontak' },
    { key: 'term', label: 'Termin', align: 'center' },
    { key: 'limit', label: 'Limit Kredit', align: 'right' },
    { key: 'outstanding', label: 'Piutang', align: 'right' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Pelanggan Grosir"
        subtitle="Pelanggan B2B dengan termin & limit kredit"
        actions={canManage ? <Button onClick={openCreate}><Plus size={16} /> Pelanggan Baru</Button> : undefined}
      />

      <Card padded={false}>
        <div className="p-4 border-b border-white/10">
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
              placeholder="Cari nama / kode / kontak..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada pelanggan grosir">
            {data.data.map((customer) => (
              <tr key={customer.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{customer.code}</td>
                <td className="px-4 py-3">
                  <div className="text-white flex items-center gap-2">
                    {customer.name}
                    {!customer.is_active && <Badge tone="red">Nonaktif</Badge>}
                  </div>
                  {customer.npwp && <div className="text-xs text-slate-500">NPWP: {customer.npwp}</div>}
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">
                  <div>{customer.contact_name || '-'}</div>
                  <div className="text-xs text-slate-500">{customer.phone || ''}</div>
                </td>
                <td className="px-4 py-3 text-center text-slate-300 text-sm">
                  {customer.payment_term_days > 0 ? `Net ${customer.payment_term_days}` : 'Tunai'}
                </td>
                <td className="px-4 py-3 text-right text-slate-400 text-sm">
                  {customer.credit_limit > 0 ? formatCurrency(customer.credit_limit) : 'Tanpa batas'}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={customer.outstanding > 0 ? 'text-ios-orange font-medium' : 'text-slate-500'}>
                    {formatCurrency(customer.outstanding)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {canManage && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(customer)}><Pencil size={14} /></Button>
                        {customer.is_active && (
                          <Button variant="ghost" size="sm" onClick={() => deactivate(customer)} title="Nonaktifkan"><Ban size={14} /></Button>
                        )}
                      </>
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
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Pelanggan' : 'Pelanggan Grosir Baru'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Nama Perusahaan/Toko *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <Input label="Nama Kontak" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="NPWP" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} />
          <Input
            as="select"
            label="Termin Default"
            value={form.payment_term_days}
            onChange={(e) => setForm({ ...form, payment_term_days: e.target.value })}
          >
            {TERM_OPTIONS.map((d) => (
              <option key={d} value={d}>{d === 0 ? 'Tunai (0 hari)' : `Net ${d} hari`}</option>
            ))}
          </Input>
          <Input
            label="Limit Kredit (Rp)"
            type="number"
            value={form.credit_limit}
            onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Input as="textarea" label="Alamat" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <p className="sm:col-span-2 text-xs text-slate-500">Limit kredit 0 berarti tanpa batas. Kode pelanggan dibuat otomatis.</p>
        </div>
      </Modal>
    </div>
  );
};

export default Customers;

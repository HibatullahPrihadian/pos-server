import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { formatCurrency } from '../utils/formatters';

const CATEGORIES = [
  { value: 'fotokopi', label: 'Fotokopi' },
  { value: 'print', label: 'Print' },
  { value: 'scan', label: 'Scan' },
  { value: 'laminating', label: 'Laminating' },
  { value: 'jilid', label: 'Jilid' },
  { value: 'lainnya', label: 'Lainnya' },
];

const EMPTY_FORM = {
  name: '',
  category: 'fotokopi',
  paper_size: '',
  color_mode: 'bw',
  price_per_page: '0',
  price_per_sheet: '0',
  min_qty: '1',
  bundle_price: '',
  bundle_qty: '',
  is_active: true,
};

const PrintServices = () => {
  const toast = useToastContext();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get('/api/print-services', { include_inactive: true }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name,
      category: row.category || 'lainnya',
      paper_size: row.paper_size || '',
      color_mode: row.color_mode || 'bw',
      price_per_page: String(row.price_per_page ?? 0),
      price_per_sheet: String(row.price_per_sheet ?? 0),
      min_qty: String(row.min_qty ?? 1),
      bundle_price: row.bundle_price === null || row.bundle_price === undefined ? '' : String(row.bundle_price),
      bundle_qty: row.bundle_qty === null || row.bundle_qty === undefined ? '' : String(row.bundle_qty),
      is_active: row.is_active,
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        paper_size: form.paper_size || null,
        bundle_price: form.bundle_price === '' ? null : form.bundle_price,
        bundle_qty: form.bundle_qty === '' ? null : form.bundle_qty,
      };
      if (editing) await api.put(`/api/print-services/${editing.id}`, payload);
      else await api.post('/api/print-services', payload);
      toast.success(editing ? 'Jasa diperbarui' : 'Jasa ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/print-services/${confirm.id}`);
      toast.success('Jasa dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  };

  const priceLabel = (row) => {
    if (Number(row.price_per_sheet) > 0) return `${formatCurrency(row.price_per_sheet)}/lembar`;
    if (Number(row.price_per_page) > 0) return `${formatCurrency(row.price_per_page)}/halaman`;
    return '-';
  };

  const columns = [
    { key: 'name', label: 'Nama Jasa' },
    { key: 'category', label: 'Kategori' },
    { key: 'paper_size', label: 'Kertas' },
    { key: 'price', label: 'Harga', align: 'right' },
    { key: 'bundle', label: 'Paket', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Master Jasa Fotokopi"
        subtitle="Daftar jasa beserta harga per halaman/lembar dan harga paket"
        actions={<Button onClick={openCreate}><Plus size={16} /> Jasa Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada jasa. Buat jasa pertama untuk mulai menerima pesanan.">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{row.name}</td>
                <td className="px-4 py-3 text-slate-400 capitalize">{row.category || '-'}</td>
                <td className="px-4 py-3 text-slate-400">{row.paper_size || '-'}{row.color_mode === 'color' ? ' · Warna' : ''}</td>
                <td className="px-4 py-3 text-right text-slate-300">{priceLabel(row)}</td>
                <td className="px-4 py-3 text-right text-slate-400">
                  {row.bundle_price !== null && row.bundle_qty
                    ? `${row.bundle_qty} lembar = ${formatCurrency(row.bundle_price)}`
                    : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  {row.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(row)}><Trash2 size={14} className="text-ios-red" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Jasa' : 'Jasa Baru'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Input label="Nama Jasa *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fotokopi A4 Hitam Putih" autoFocus />
          </div>
          <Input as="select" label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Input>
          <Input as="select" label="Mode Warna" value={form.color_mode} onChange={(e) => setForm({ ...form, color_mode: e.target.value })}>
            <option value="bw">Hitam Putih</option>
            <option value="color">Warna</option>
          </Input>
          <Input label="Ukuran Kertas" value={form.paper_size} onChange={(e) => setForm({ ...form, paper_size: e.target.value })} placeholder="A4 / F4 / Legal" />
          <Input label="Minimal Qty (lembar)" type="number" min="1" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} />
          <Input label="Harga per Lembar (Rp)" type="number" min="0" value={form.price_per_sheet} onChange={(e) => setForm({ ...form, price_per_sheet: e.target.value })} />
          <Input label="Harga per Halaman (Rp)" type="number" min="0" value={form.price_per_page} onChange={(e) => setForm({ ...form, price_per_page: e.target.value })} />
          <Input label="Harga Paket (Rp)" type="number" min="0" value={form.bundle_price} onChange={(e) => setForm({ ...form, bundle_price: e.target.value })} placeholder="Opsional" />
          <Input label="Qty Paket (lembar)" type="number" min="1" value={form.bundle_qty} onChange={(e) => setForm({ ...form, bundle_qty: e.target.value })} placeholder="Opsional" />
          <div className="sm:col-span-2">
            <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </Input>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4">
          Kosongkan harga paket bila tidak memakai skema paket. Isi minimal salah satu harga.
        </p>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Hapus Jasa"
        message={`Hapus jasa "${confirm?.name}"? Jasa yang sudah dipakai pesanan tidak dapat dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default PrintServices;

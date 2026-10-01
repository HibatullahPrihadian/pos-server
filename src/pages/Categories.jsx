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

const Categories = () => {
  const toast = useToastContext();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', is_active: true });
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get('/api/categories', { include_inactive: true }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ name: '', is_active: true }); setModalOpen(true); };
  const openEdit = (row) => { setEditing(row); setForm({ name: row.name, is_active: row.is_active }); setModalOpen(true); };

  const save = async () => {
    try {
      if (editing) await api.put(`/api/categories/${editing.id}`, form);
      else await api.post('/api/categories', form);
      toast.success(editing ? 'Kategori diperbarui' : 'Kategori ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/categories/${confirm.id}`);
      toast.success('Kategori dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  };

  const columns = [
    { key: 'name', label: 'Nama Kategori' },
    { key: 'product_count', label: 'Jumlah Produk', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Kategori"
        subtitle="Kelompokkan produk untuk memudahkan pencarian di kasir"
        actions={<Button onClick={openCreate}><Plus size={16} /> Kategori Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada kategori">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{row.name}</td>
                <td className="px-4 py-3 text-right text-slate-400">{row.product_count}</td>
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
        title={editing ? 'Ubah Kategori' : 'Kategori Baru'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save}>Simpan</Button>
          </div>
        }
      >
        <Input label="Nama Kategori *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        <div className="mt-4">
          <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
          </Input>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Hapus Kategori"
        message={`Hapus kategori "${confirm?.name}"? Kategori yang masih dipakai produk tidak dapat dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Categories;

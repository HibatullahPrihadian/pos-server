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

const EMPTY = { name: '', phone: '', address: '', note: '', is_active: true };

const Suppliers = () => {
  const toast = useToastContext();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get('/api/suppliers', { include_inactive: true }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ name: row.name, phone: row.phone || '', address: row.address || '', note: row.note || '', is_active: row.is_active });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      if (editing) await api.put(`/api/suppliers/${editing.id}`, form);
      else await api.post('/api/suppliers', form);
      toast.success(editing ? 'Supplier diperbarui' : 'Supplier ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/suppliers/${confirm.id}`);
      toast.success('Supplier dihapus');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  };

  const columns = [
    { key: 'name', label: 'Nama Supplier' },
    { key: 'phone', label: 'Telepon' },
    { key: 'address', label: 'Alamat' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Supplier"
        subtitle="Data pemasok untuk pembelian barang"
        actions={<Button onClick={openCreate}><Plus size={16} /> Supplier Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada supplier">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{row.name}</td>
                <td className="px-4 py-3 text-slate-400">{row.phone || '-'}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{row.address || '-'}</td>
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
        title={editing ? 'Ubah Supplier' : 'Supplier Baru'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save}>Simpan</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Nama Supplier *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input as="textarea" label="Alamat" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input as="textarea" label="Catatan" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
        title="Hapus Supplier"
        message={`Hapus supplier "${confirm?.name}"? Supplier yang masih dipakai produk tidak dapat dihapus.`}
        confirmLabel="Hapus"
      />
    </div>
  );
};

export default Suppliers;

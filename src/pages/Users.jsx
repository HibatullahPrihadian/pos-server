import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, UserX } from 'lucide-react';
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
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { formatDate } from '../utils/formatters';

const EMPTY = { username: '', full_name: '', password: '', role: 'kasir', is_active: true };

const Users = () => {
  const toast = useToastContext();
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get('/api/users'));
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
    setForm({ username: row.username, full_name: row.full_name, password: '', role: row.role, is_active: row.is_active });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (editing) await api.put(`/api/users/${editing.id}`, payload);
      else await api.post('/api/users', payload);
      toast.success(editing ? 'Pengguna diperbarui' : 'Pengguna ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deactivate = async () => {
    try {
      await api.put(`/api/users/${confirm.id}/deactivate`, {});
      toast.success('Pengguna dinonaktifkan');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  };

  const columns = [
    { key: 'username', label: 'Username' },
    { key: 'full_name', label: 'Nama Lengkap' },
    { key: 'role', label: 'Role', align: 'center' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'created', label: 'Dibuat' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Pengguna"
        subtitle="Akun kasir dan administrator"
        actions={<Button onClick={openCreate}><Plus size={16} /> Pengguna Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada pengguna">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-sm text-white">{row.username}</td>
                <td className="px-4 py-3 text-white">{row.full_name}</td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={row.role === 'admin' ? 'purple' : 'blue'}>
                    {row.role === 'admin' ? 'Admin' : 'Kasir'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-center">
                  {row.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}><Pencil size={14} /></Button>
                    {row.id !== currentUser?.id && row.is_active && (
                      <Button variant="ghost" size="sm" onClick={() => setConfirm(row)} title="Nonaktifkan">
                        <UserX size={14} className="text-ios-red" />
                      </Button>
                    )}
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
        title={editing ? 'Ubah Pengguna' : 'Pengguna Baru'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save}>Simpan</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={Boolean(editing)} />
          <Input label="Nama Lengkap *" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input
            label={editing ? 'Password Baru (kosongkan bila tidak diubah)' : 'Password *'}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <Input as="select" label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="kasir">Kasir</option>
            <option value="admin">Admin</option>
          </Input>
          {editing && (
            <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </Input>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={deactivate}
        title="Nonaktifkan Pengguna"
        message={`Nonaktifkan akun "${confirm?.username}"? Pengguna tidak akan bisa login lagi.`}
        confirmLabel="Nonaktifkan"
      />
    </div>
  );
};

export default Users;

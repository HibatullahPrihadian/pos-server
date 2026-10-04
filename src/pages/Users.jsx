import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Pencil, UserX, ShieldCheck } from 'lucide-react';
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

const EMPTY = {
  username: '',
  full_name: '',
  password: '',
  role: 'kasir',
  is_active: true,
  permissions: null,
};

const ROLE_LABELS = { admin: 'Admin', kasir: 'Kasir', gudang: 'Gudang' };
const ROLE_TONES = { admin: 'purple', kasir: 'blue', gudang: 'orange' };

const Users = () => {
  const toast = useToastContext();
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState(null);
  const [permissionDefs, setPermissionDefs] = useState([]);
  const [presets, setPresets] = useState({});
  const [useCustomPermissions, setUseCustomPermissions] = useState(false);

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

  const loadPermissions = useCallback(async () => {
    try {
      const data = await api.get('/api/users/permissions');
      setPermissionDefs(data.permissions || []);
      setPresets(data.presets || {});
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  // Izin efektif yang sedang ditampilkan di panel (custom atau preset role).
  const effectivePermissions = useMemo(() => {
    if (!useCustomPermissions) return presets[form.role] || [];
    return Array.isArray(form.permissions) ? form.permissions : [];
  }, [useCustomPermissions, presets, form.role, form.permissions]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, permissions: [] });
    setUseCustomPermissions(false);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    const isCustom = Array.isArray(row.permissions);
    setForm({
      username: row.username,
      full_name: row.full_name,
      password: '',
      role: row.role,
      is_active: row.is_active,
      permissions: isCustom ? [...row.permissions] : [],
    });
    setUseCustomPermissions(isCustom);
    setModalOpen(true);
  };

  const togglePermission = (key) => {
    const current = Array.isArray(form.permissions) ? form.permissions : [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    setForm({ ...form, permissions: next });
  };

  const save = async () => {
    try {
      const payload = {
        username: form.username,
        full_name: form.full_name,
        role: form.role,
        is_active: form.is_active,
      };
      if (form.password) payload.password = form.password;
      if (useCustomPermissions) payload.permissions = form.permissions || [];
      else payload.permissions = null;

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
        subtitle="Akun kasir, gudang, dan administrator"
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
                  <Badge tone={ROLE_TONES[row.role] || 'blue'}>
                    {ROLE_LABELS[row.role] || row.role}
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
          <Input
            as="select"
            label="Role"
            value={form.role}
            onChange={(e) => {
              const nextRole = e.target.value;
              // Ganti role -> setel ulang izin custom ke preset role baru agar
              // tidak mewarisi izin role lama.
              setForm((f) => ({
                ...f,
                role: nextRole,
                permissions: useCustomPermissions ? [...(presets[nextRole] || [])] : f.permissions,
              }));
            }}
          >
            <option value="kasir">Kasir</option>
            <option value="gudang">Gudang</option>
            <option value="admin">Admin</option>
          </Input>
          {editing && (
            <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </Input>
          )}

          {form.role === 'admin' ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300 flex items-start gap-2">
              <ShieldCheck size={16} className="text-ios-blue mt-0.5 shrink-0" />
              <span>Administrator selalu memiliki semua izin dan tidak dapat dibatasi.</span>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">Izin Akses</p>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomPermissions}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseCustomPermissions(checked);
                      if (checked) {
                        setForm((f) => ({
                          ...f,
                          permissions: Array.isArray(f.permissions) && f.permissions.length
                            ? f.permissions
                            : (presets[f.role] || []),
                        }));
                      }
                    }}
                  />
                  Atur manual
                </label>
              </div>

              {!useCustomPermissions ? (
                <p className="text-xs text-slate-400">
                  Mengikuti preset role <span className="font-medium text-slate-200">{ROLE_LABELS[form.role] || form.role}</span>.{' '}
                  Centang &quot;Atur manual&quot; untuk menyesuaikan.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                  {permissionDefs.map((def) => (
                    <label key={def.key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effectivePermissions.includes(def.key)}
                        onChange={() => togglePermission(def.key)}
                      />
                      <span>{def.label}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1 pt-1">
                {permissionDefs
                  .filter((def) => effectivePermissions.includes(def.key))
                  .map((def) => (
                    <Badge key={def.key} tone="blue">{def.label}</Badge>
                  ))}
              </div>
            </div>
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

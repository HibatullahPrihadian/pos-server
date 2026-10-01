import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Search, Star, Coins } from 'lucide-react';
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
import { formatDate } from '../utils/formatters';

const EMPTY = { name: '', phone: '', email: '' };

const Members = () => {
  const toast = useToastContext();
  const { isAdmin } = useAuth();
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const [pointsMember, setPointsMember] = useState(null);
  const [pointsData, setPointsData] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ change: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/members', { page, limit: 25, search: debouncedSearch }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (member) => {
    setEditing(member);
    setForm({ name: member.name, phone: member.phone || '', email: member.email || '' });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      if (editing) await api.put(`/api/members/${editing.id}`, form);
      else await api.post('/api/members', form);
      toast.success(editing ? 'Member diperbarui' : 'Member ditambahkan');
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openPoints = async (member) => {
    setPointsMember(member);
    setAdjustForm({ change: '', note: '' });
    try {
      setPointsData(await api.get(`/api/members/${member.id}/points`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const adjustPoints = async () => {
    try {
      const updated = await api.post(`/api/members/${pointsMember.id}/points/adjust`, adjustForm);
      toast.success(`Poin diperbarui menjadi ${updated.points}`);
      setAdjustForm({ change: '', note: '' });
      setPointsData(await api.get(`/api/members/${pointsMember.id}/points`));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode' },
    { key: 'name', label: 'Nama' },
    { key: 'phone', label: 'Telepon' },
    { key: 'points', label: 'Poin', align: 'right' },
    { key: 'joined', label: 'Bergabung' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Member"
        subtitle="Pelanggan terdaftar dengan harga khusus dan poin"
        actions={<Button onClick={openCreate}><Plus size={16} /> Member Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4 border-b border-white/10">
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
              placeholder="Cari nama / kode / telepon..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada member">
            {data.data.map((member) => (
              <tr key={member.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{member.code}</td>
                <td className="px-4 py-3">
                  <div className="text-white flex items-center gap-2">
                    {member.name}
                    {!member.is_active && <Badge tone="red">Nonaktif</Badge>}
                  </div>
                  {member.email && <div className="text-xs text-slate-500">{member.email}</div>}
                </td>
                <td className="px-4 py-3 text-slate-400">{member.phone || '-'}</td>
                <td className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1 text-ios-yellow font-medium">
                    <Coins size={14} /> {member.points}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">{formatDate(member.joined_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openPoints(member)} title="Poin"><Star size={14} /></Button>
                    {isAdmin && <Button variant="ghost" size="sm" onClick={() => openEdit(member)}><Pencil size={14} /></Button>}
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
        title={editing ? 'Ubah Member' : 'Member Baru'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={save}>Simpan</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Nama *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <p className="text-xs text-slate-500">Kode member dibuat otomatis bila dikosongkan.</p>
        </div>
      </Modal>

      <Modal isOpen={Boolean(pointsMember)} onClose={() => setPointsMember(null)} title={`Poin - ${pointsMember?.name || ''}`} size="lg">
        {pointsData && (
          <>
            <div className="flex items-center justify-between p-4 rounded-ios-sm bg-ios-yellow/10 border border-ios-yellow/30 mb-4">
              <span className="text-sm text-slate-300">Saldo Poin</span>
              <span className="text-2xl font-bold text-ios-yellow">{pointsData.points}</span>
            </div>

            {isAdmin && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Input label="Perubahan (+/-)" type="number" value={adjustForm.change} onChange={(e) => setAdjustForm({ ...adjustForm, change: e.target.value })} placeholder="10" />
                <Input label="Catatan" className="col-span-2" value={adjustForm.note} onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })} />
                <Button className="col-span-3" onClick={adjustPoints} disabled={!adjustForm.change}>Sesuaikan Poin</Button>
              </div>
            )}

            <p className="text-sm font-medium text-white mb-2">Riwayat Poin</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pointsData.logs.length === 0 && <p className="text-sm text-slate-500">Belum ada riwayat.</p>}
              {pointsData.logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-ios-sm text-sm">
                  <div>
                    <span className={log.change > 0 ? 'text-ios-green' : 'text-ios-red'}>
                      {log.change > 0 ? '+' : ''}{log.change}
                    </span>
                    <span className="text-slate-400 ml-2">{log.note || log.type}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white">{log.balance_after}</div>
                    <div className="text-xs text-slate-500">{formatDate(log.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Members;

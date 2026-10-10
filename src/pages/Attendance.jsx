import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
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
import { formatDateTime, todayIso, firstOfMonthIso } from '../utils/formatters';

// Konversi nilai timestamptz dari server menjadi 'YYYY-MM-DDTHH:MM' waktu lokal
// untuk input datetime-local.
const toLocalInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDuration = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return '-';
  const ms = new Date(checkOut) - new Date(checkIn);
  if (ms <= 0) return '-';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}j ${minutes}m`;
};

const Attendance = () => {
  const toast = useToastContext();
  const { can, user } = useAuth();
  const canManage = can('user.manage');
  const [users, setUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('');
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [data, setData] = useState({ data: [], pagination: null });
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ user_id: '', work_date: todayIso(), check_in: '', check_out: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (canManage) {
      api.get('/api/users', { limit: 200 }).then((r) => setUsers(r.data || r)).catch(() => {});
    }
  }, [canManage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (canManage) {
        const [list, sum] = await Promise.all([
          api.get('/api/attendance', { page, limit: 25, user_id: userFilter, from: range.from, to: range.to }),
          api.get('/api/attendance/summary', { from: range.from, to: range.to }),
        ]);
        setData(list);
        setSummary(sum.rows || []);
      } else {
        // Kasir: hanya riwayat sendiri.
        const rows = await api.get('/api/attendance/me', { from: range.from, to: range.to });
        setData({ data: rows, pagination: null });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, userFilter, range, canManage, toast]);

  useEffect(() => { load(); }, [load]);

  const checkIn = async () => {
    setBusy(true);
    try {
      await api.post('/api/attendance/check-in', {});
      toast.success('Absen masuk tercatat');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async () => {
    setBusy(true);
    try {
      await api.post('/api/attendance/check-out', {});
      toast.success('Absen pulang tercatat');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const todayRow = data.data.find(
    (r) => Number(r.user_id) === Number(user?.id) && String(r.work_date).slice(0, 10) === todayIso()
  );

  const openManual = (row) => {
    setManualForm({
      user_id: row ? String(row.user_id) : '',
      work_date: row ? String(row.work_date).slice(0, 10) : todayIso(),
      check_in: row ? toLocalInput(row.check_in) : '',
      check_out: row ? toLocalInput(row.check_out) : '',
      note: row?.note || '',
    });
    setManualOpen(true);
  };

  const submitManual = async () => {
    setSaving(true);
    try {
      await api.post('/api/attendance/manual', {
        user_id: manualForm.user_id,
        work_date: manualForm.work_date,
        check_in: manualForm.check_in ? new Date(manualForm.check_in).toISOString() : null,
        check_out: manualForm.check_out ? new Date(manualForm.check_out).toISOString() : null,
        note: manualForm.note || null,
      });
      toast.success('Absensi disimpan');
      setManualOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Absensi Karyawan"
        subtitle={canManage ? 'Rekap kehadiran dan koreksi manual' : 'Riwayat kehadiran Anda'}
        actions={canManage ? <Button onClick={() => openManual(null)}><Plus size={16} /> Input Manual</Button> : null}
      />

      {!canManage && (
        <Card title="Absensi Hari Ini" className="mb-5">
          <div className="flex flex-wrap items-center gap-3">
            {todayRow?.check_in ? (
              <span className="text-sm text-slate-300">
                Masuk: {formatDateTime(todayRow.check_in)}
                {todayRow.check_out ? ` • Pulang: ${formatDateTime(todayRow.check_out)}` : ''}
              </span>
            ) : (
              <span className="text-sm text-slate-400">Belum absen masuk hari ini.</span>
            )}
            <div className="flex gap-2">
              <Button variant="success" onClick={checkIn} disabled={busy || Boolean(todayRow?.check_in)}>
                Absen Masuk
              </Button>
              <Button variant="warning" onClick={checkOut} disabled={busy || !todayRow?.check_in || Boolean(todayRow?.check_out)}>
                Absen Pulang
              </Button>
            </div>
          </div>
        </Card>
      )}

      {canManage && (
      <Card padded={false} className="mb-5">
        <div className="p-4 flex flex-wrap gap-3 border-b border-white/10 items-end">
          <Input as="select" label="Karyawan" className="w-56" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}>
            <option value="">Semua Karyawan</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Input>
          <Input label="Dari" type="date" className="w-44" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }} />
          <Input label="Sampai" type="date" className="w-44" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }} />
        </div>
        <div className="p-4">
          <p className="text-sm font-medium text-white mb-3">Rekap Periode</p>
          <Table
            columns={[
              { key: 'name', label: 'Karyawan' },
              { key: 'role', label: 'Peran' },
              { key: 'days', label: 'Hari Hadir', align: 'center' },
              { key: 'hours', label: 'Total Jam', align: 'right' },
              { key: 'incomplete', label: 'Belum Absen Pulang', align: 'center' },
            ]}
            loading={loading}
            empty="Belum ada data absensi"
          >
            {summary.map((s) => (
              <tr key={s.user_id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{s.user_name}</td>
                <td className="px-4 py-3 text-slate-400">{{ admin: 'Admin', kasir: 'Kasir', gudang: 'Gudang' }[s.role] || s.role}</td>
                <td className="px-4 py-3 text-center text-slate-300">{s.days_present}</td>
                <td className="px-4 py-3 text-right text-slate-300">{s.worked_hours} jam</td>
                <td className="px-4 py-3 text-center">
                  {s.incomplete_days > 0 ? <Badge tone="orange">{s.incomplete_days}</Badge> : <span className="text-slate-400">0</span>}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
      )}

      <Card padded={false}>
        <div className="p-4">
          <Table
            columns={[
              { key: 'date', label: 'Tanggal' },
              { key: 'user', label: 'Karyawan' },
              { key: 'in', label: 'Masuk' },
              { key: 'out', label: 'Pulang' },
              { key: 'dur', label: 'Durasi' },
              { key: 'note', label: 'Catatan' },
              ...(canManage ? [{ key: 'actions', label: '', align: 'right' }] : []),
            ]}
            loading={loading}
            empty="Belum ada absensi"
          >
            {data.data.map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-slate-300">{String(row.work_date).slice(0, 10)}</td>
                <td className="px-4 py-3 text-white">{row.user_name || '-'}</td>
                <td className="px-4 py-3 text-slate-400 text-sm">{row.check_in ? formatDateTime(row.check_in) : '-'}</td>
                <td className="px-4 py-3 text-slate-400 text-sm">{row.check_out ? formatDateTime(row.check_out) : <Badge tone="orange">Belum</Badge>}</td>
                <td className="px-4 py-3 text-slate-300">{formatDuration(row.check_in, row.check_out)}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{row.note || '-'}</td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openManual(row)}>Koreksi</Button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Input / Koreksi Absensi"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setManualOpen(false)}>Batal</Button>
            <Button onClick={submitManual} disabled={saving || !manualForm.user_id}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input as="select" label="Karyawan *" className="col-span-2" value={manualForm.user_id} onChange={(e) => setManualForm({ ...manualForm, user_id: e.target.value })}>
            <option value="">- Pilih -</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Input>
          <Input label="Tanggal Kerja *" type="date" value={manualForm.work_date} onChange={(e) => setManualForm({ ...manualForm, work_date: e.target.value })} />
          <Input label="Catatan" value={manualForm.note} onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })} />
          <Input label="Absen Masuk" type="datetime-local" value={manualForm.check_in} onChange={(e) => setManualForm({ ...manualForm, check_in: e.target.value })} />
          <Input label="Absen Pulang" type="datetime-local" value={manualForm.check_out} onChange={(e) => setManualForm({ ...manualForm, check_out: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
};

export default Attendance;

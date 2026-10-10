import { useState, useEffect, useCallback } from 'react';
import { Clock, Eye, Lock, Unlock } from 'lucide-react';
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
import { formatDateTime, formatCurrency, parseMoney, todayIso, firstOfMonthIso } from '../utils/formatters';
import { PAYMENT_LABELS } from '../utils/labels';

const Shifts = () => {
  const toast = useToastContext();

  const [current, setCurrent] = useState(null);
  const [currentLoading, setCurrentLoading] = useState(true);
  const [openCash, setOpenCash] = useState('');

  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });

  const [summary, setSummary] = useState(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const loadCurrent = useCallback(async () => {
    setCurrentLoading(true);
    try {
      const result = await api.get('/api/shifts/current');
      setCurrent(result.shift ? result : null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCurrentLoading(false);
    }
  }, [toast]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/shifts', { page, limit: 25, from: range.from, to: range.to }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, range, toast]);

  useEffect(() => { loadCurrent(); }, [loadCurrent]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const openShift = async () => {
    try {
      await api.post('/api/shifts/open', { opening_cash: parseMoney(openCash) });
      toast.success('Shift dibuka');
      setOpenCash('');
      loadCurrent();
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openClose = () => {
    setCountedCash(String(current?.expected_cash ?? ''));
    setCloseNote('');
    setCloseOpen(true);
  };

  const closeShift = async () => {
    try {
      const result = await api.post('/api/shifts/close', { counted_cash: parseMoney(countedCash), note: closeNote });
      toast.success(`Shift ditutup. Selisih: ${formatCurrency(result.difference)}`);
      setCloseOpen(false);
      loadCurrent();
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const viewSummary = async (shift) => {
    try {
      setSummary(await api.get(`/api/shifts/${shift.id}/summary`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'user', label: 'Kasir' },
    { key: 'opened', label: 'Dibuka' },
    { key: 'closed', label: 'Ditutup' },
    { key: 'opening', label: 'Kas Awal', align: 'right' },
    { key: 'expected', label: 'Kas Seharusnya', align: 'right' },
    { key: 'counted', label: 'Kas Fisik', align: 'right' },
    { key: 'diff', label: 'Selisih', align: 'right' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader title="Shift" subtitle="Buka/tutup shift kasir dan rekap kas" />

      <div className="grid grid-cols-1 desk:grid-cols-2 gap-5 mb-6">
        {currentLoading ? (
          <Card><p className="text-slate-400 text-sm">Memuat shift...</p></Card>
        ) : current ? (
          <Card title="Shift Aktif">
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Kas Awal</div>
                <div className="text-white">{formatCurrency(current.shift.opening_cash)}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Dibuka</div>
                <div className="text-white">{formatDateTime(current.shift.opened_at)}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Penjualan</div>
                <div className="text-white">{formatCurrency(current.sales_total)} ({current.sales_count} trx)</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Kas Seharusnya</div>
                <div className="text-ios-green font-semibold">{formatCurrency(current.expected_cash)}</div>
              </div>
            </div>

            {current.by_method?.length > 0 && (
              <div className="mb-4 space-y-1 text-sm">
                <p className="text-slate-400 text-xs mb-1">Rincian Metode Bayar</p>
                {current.by_method.map((m) => (
                  <div key={m.method} className="flex justify-between">
                    <span className="text-slate-400">{PAYMENT_LABELS[m.method] || m.method} ({m.count})</span>
                    <span className="text-white">{formatCurrency(m.total)}</span>
                  </div>
                ))}
                {current.cash_refund > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Retur Tunai</span>
                    <span className="text-ios-orange">-{formatCurrency(current.cash_refund)}</span>
                  </div>
                )}
              </div>
            )}

            <Button variant="danger" className="w-full" onClick={openClose}><Lock size={16} /> Tutup Shift</Button>
          </Card>
        ) : (
          <Card title="Buka Shift">
            <p className="text-sm text-slate-400 mb-4">Masukkan kas awal di laci kasir untuk memulai shift.</p>
            <Input label="Kas Awal (Rp)" type="number" value={openCash} onChange={(e) => setOpenCash(e.target.value)} />
            <Button className="w-full mt-4" onClick={openShift}><Unlock size={16} /> Buka Shift</Button>
          </Card>
        )}

        <Card title="Ringkasan" className="desk:row-span-1">
          <div className="flex items-center gap-3 text-slate-400 text-sm">
            <Clock size={18} />
            <span>
              Satu kasir hanya dapat memiliki satu shift terbuka. Transaksi kasir wajib terhubung ke shift aktif.
            </span>
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 flex flex-wrap gap-3 border-b border-white/10">
          <input
            type="date"
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={range.from}
            onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }}
          />
          <input
            type="date"
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={range.to}
            onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }}
          />
        </div>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada riwayat shift">
            {data.data.map((shift) => (
              <tr key={shift.id} className="hover:bg-white/5">
                <td className="px-4 py-3 text-white">{shift.user_name || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-400">{formatDateTime(shift.opened_at)}</td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {shift.closed_at ? formatDateTime(shift.closed_at) : <Badge tone="green">Terbuka</Badge>}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(shift.opening_cash)}</td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {shift.expected_cash != null ? formatCurrency(shift.expected_cash) : '-'}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {shift.counted_cash != null ? formatCurrency(shift.counted_cash) : '-'}
                </td>
                <td className={`px-4 py-3 text-right font-medium ${shift.difference > 0 ? 'text-ios-green' : shift.difference < 0 ? 'text-ios-red' : 'text-slate-400'}`}>
                  {shift.difference != null ? formatCurrency(shift.difference) : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => viewSummary(shift)}><Eye size={14} /></Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal
        isOpen={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Tutup Shift"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setCloseOpen(false)}>Batal</Button>
            <Button variant="danger" onClick={closeShift}><Lock size={16} /> Tutup Shift</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 rounded-ios-sm bg-white/5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Kas Seharusnya</span>
              <span className="text-white font-semibold">{formatCurrency(current?.expected_cash)}</span>
            </div>
          </div>
          <Input label="Kas Fisik Dihitung (Rp)" type="number" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} autoFocus />
          {countedCash !== '' && (
            <div className={`text-sm ${parseMoney(countedCash) - (current?.expected_cash || 0) >= 0 ? 'text-ios-green' : 'text-ios-red'}`}>
              Selisih: {formatCurrency(parseMoney(countedCash) - (current?.expected_cash || 0))}
            </div>
          )}
          <Input label="Catatan" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
        </div>
      </Modal>

      <Modal isOpen={Boolean(summary)} onClose={() => setSummary(null)} title={`Ringkasan Shift - ${summary?.shift?.id || ''}`} size="md">
        {summary && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Kasir</div>
                <div className="text-white">{summary.user_name || '-'}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Periode</div>
                <div className="text-white text-xs">
                  {formatDateTime(summary.shift.opened_at)} → {summary.shift.closed_at ? formatDateTime(summary.shift.closed_at) : 'Terbuka'}
                </div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Total Penjualan</div>
                <div className="text-white">{formatCurrency(summary.sales_total)} ({summary.sales_count} trx)</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Transaksi Void</div>
                <div className="text-white">{summary.void_count}</div>
              </div>
            </div>

            <div className="space-y-1 pt-2 border-t border-white/10">
              <div className="flex justify-between"><span className="text-slate-400">Kas Awal</span><span className="text-white">{formatCurrency(summary.shift.opening_cash)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Tunai Masuk</span><span className="text-white">{formatCurrency(summary.cash_in)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Retur Tunai</span><span className="text-ios-orange">-{formatCurrency(summary.cash_refund)}</span></div>
              <div className="flex justify-between pt-1 border-t border-white/10"><span className="text-white font-semibold">Kas Seharusnya</span><span className="text-ios-green font-semibold">{formatCurrency(summary.expected_cash)}</span></div>
              {summary.shift.counted_cash != null && (
                <>
                  <div className="flex justify-between"><span className="text-slate-400">Kas Fisik</span><span className="text-white">{formatCurrency(summary.shift.counted_cash)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Selisih</span><span className={summary.shift.difference >= 0 ? 'text-ios-green' : 'text-ios-red'}>{formatCurrency(summary.shift.difference)}</span></div>
                </>
              )}
            </div>

            <div className="pt-2 border-t border-white/10 space-y-1">
              <p className="text-slate-400 text-xs mb-1">Metode Bayar</p>
              {summary.by_method?.map((m) => (
                <div key={m.method} className="flex justify-between">
                  <span className="text-slate-400">{PAYMENT_LABELS[m.method] || m.method}</span>
                  <span className="text-white">{formatCurrency(m.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Shifts;

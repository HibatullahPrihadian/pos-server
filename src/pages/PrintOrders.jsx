import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';import {
  Plus, Eye, Printer, Pencil, Play, CheckCheck, XCircle, Wallet, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import useDebounce from '../hooks/useDebounce';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import PrintReceipt, { PRINT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../components/print/PrintReceipt';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { printReceipt } from '../utils/printReceipt';

const STATUS_TONES = {
  queued: 'orange',
  processing: 'blue',
  ready: 'green',
  picked_up: 'neutral',
  cancelled: 'red',
};

const PAYMENT_TONES = { paid: 'green', partial: 'orange', unpaid: 'red' };

// Transisi tombol cepat di daftar (sama dengan aturan backend).
const NEXT_STEP = {
  queued: { to: 'processing', label: 'Proses', icon: Play },
  processing: { to: 'ready', label: 'Siap', icon: CheckCheck },
  ready: { to: 'picked_up', label: 'Diambil', icon: CheckCheck },
};

const EMPTY_FILTERS = { status: '', payment_status: '', search: '', from: '', to: '' };

const PrintOrders = () => {
  const toast = useToastContext();
  const navigate = useNavigate();
  const { settings } = useSettings();

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const debouncedSearch = useDebounce(filters.search, 350);

  const [detail, setDetail] = useState(null);
  const [paying, setPaying] = useState(null);
  const [shift, setShift] = useState(undefined);
  const [payForm, setPayForm] = useState({ method: 'cash', amount: '', reference: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/print-orders', {
        page,
        status: filters.status,
        payment_status: filters.payment_status,
        search: debouncedSearch,
        from: filters.from,
        to: filters.to,
      });
      setRows(result.data || []);
      setPagination(result.pagination);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  // search diketik mentah di input, query memakai versi debounce.
  }, [page, filters.status, filters.payment_status, filters.from, filters.to, debouncedSearch, toast]);

  useEffect(() => { load(); }, [load]);

  // Shift aktif dibutuhkan untuk pembayaran; diambil sekali saat halaman dibuka.
  useEffect(() => {
    api.get('/api/shifts/current')
      .then((res) => setShift(res?.shift || null))
      .catch(() => setShift(null));
  }, []);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const openDetail = async (row) => {
    try {
      setDetail(await api.get(`/api/print-orders/${row.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeStatus = async (row, to) => {
    setBusy(true);
    try {
      await api.put(`/api/print-orders/${row.id}/status`, { status: to });
      toast.success(`Status: ${PRINT_STATUS_LABELS[to]}`);
      load();
      if (detail?.id === row.id) openDetail(row);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openPay = (row) => {
    setPaying(row);
    setPayForm({ method: 'cash', amount: String(row.grand_total), reference: '' });
  };

  const submitPay = async () => {
    if (!shift) {
      toast.error('Buka shift terlebih dahulu untuk menerima pembayaran');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post(`/api/print-orders/${paying.id}/pay`, {
        shift_id: shift.id,
        method: payForm.method,
        amount: Number(payForm.amount) || Number(paying.grand_total),
        reference: payForm.reference || undefined,
      });
      toast.success(`Terbayar · invoice ${result.sale.invoice_no}`);
      setPaying(null);
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'queue', label: 'Antrian', align: 'center' },
    { key: 'code', label: 'Kode' },
    { key: 'customer', label: 'Pelanggan' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'payment', label: 'Bayar', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Pesanan & Antrian Fotokopi"
        subtitle="Pantau antrian, ubah status, dan terima pembayaran"
        actions={(
          <div className="flex gap-2">
            <Button variant="neutral" onClick={load}><RefreshCw size={16} /> Muat Ulang</Button>
            <Button onClick={() => navigate('/print-orders/new')}>
              <Plus size={16} /> Buat Pesanan
            </Button>
          </div>
        )}
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input
            as="select"
            label="Status"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
          >
            <option value="">Semua status</option>
            <option value="queued,processing,ready">Antrian aktif</option>
            <option value="queued">Antre</option>
            <option value="processing">Diproses</option>
            <option value="ready">Siap Diambil</option>
            <option value="picked_up">Sudah Diambil</option>
            <option value="cancelled">Dibatalkan</option>
          </Input>
          <Input
            as="select"
            label="Pembayaran"
            value={filters.payment_status}
            onChange={(e) => setFilter('payment_status', e.target.value)}
          >
            <option value="">Semua</option>
            <option value="paid">Lunas</option>
            <option value="unpaid">Belum Bayar</option>
          </Input>
          <Input
            label="Cari (kode/nama)"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="PRN-... atau nama"
          />
          <Input label="Dari" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          <Input label="Sampai" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </div>
        {(filters.status || filters.payment_status || filters.search || filters.from || filters.to) && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setPage(1); setFilters(EMPTY_FILTERS); }}>
              <XCircle size={14} /> Reset filter
            </Button>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada pesanan fotokopi">
            {rows.map((row) => {
              const step = NEXT_STEP[row.status];
              const canCancel = row.status === 'queued' || row.status === 'processing';
              return (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-lg bg-ios-blue/15 text-ios-blue font-bold">
                      {row.queue_no}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{row.code}</td>
                  <td className="px-4 py-3 text-white">
                    {row.customer_name || '-'}
                    <span className="block text-xs text-slate-400">{formatDateTime(row.created_at)}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(row.grand_total)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={STATUS_TONES[row.status]}>{PRINT_STATUS_LABELS[row.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={PAYMENT_TONES[row.payment_status]}>
                      {PAYMENT_STATUS_LABELS[row.payment_status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {row.payment_status !== 'paid' && row.status !== 'cancelled' && (
                        <Button variant="success" size="sm" onClick={() => openPay(row)} title="Bayar">
                          <Wallet size={14} /> Bayar
                        </Button>
                      )}
                      {step && (
                        <Button
                          variant="neutral"
                          size="sm"
                          disabled={busy}
                          onClick={() => changeStatus(row, step.to)}
                          title={step.label}
                        >
                          <step.icon size={14} /> {step.label}
                        </Button>
                      )}
                      {canCancel && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => changeStatus(row, 'cancelled')}
                          title="Batalkan"
                        >
                          <XCircle size={14} className="text-ios-red" />
                        </Button>
                      )}
                      {row.payment_status !== 'paid' && row.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/print-orders/${row.id}/edit`)} title="Ubah">
                          <Pencil size={14} />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openDetail(row)} title="Detail">
                        <Eye size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination pagination={pagination} onChange={setPage} />
        </div>
      </Card>

      {/* Detail + nota */}
      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={`Pesanan ${detail?.code || ''}`}
        footer={detail && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="neutral" onClick={printReceipt}>
              <Printer size={16} /> Cetak Nota
            </Button>
            {detail.payment_status !== 'paid' && detail.status !== 'cancelled' && (
              <Button variant="neutral" onClick={() => navigate(`/print-orders/${detail.id}/edit`)}>
                <Pencil size={16} /> Ubah
              </Button>
            )}
            {detail.payment_status !== 'paid' && detail.status !== 'cancelled' && (
              <Button onClick={() => { const row = detail; setDetail(null); openPay(row); }}>
                <Wallet size={16} /> Bayar
              </Button>
            )}
          </div>
        )}
      >
        {detail && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Antrian</span>
                <span className="text-white font-semibold">#{detail.queue_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pelanggan</span>
                <span className="text-white">{detail.customer_name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Dibuat</span>
                <span className="text-white">{formatDateTime(detail.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status</span>
                <Badge tone={STATUS_TONES[detail.status]}>{PRINT_STATUS_LABELS[detail.status]}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bayar</span>
                <Badge tone={PAYMENT_TONES[detail.payment_status]}>
                  {PAYMENT_STATUS_LABELS[detail.payment_status]}
                </Badge>
              </div>
              {detail.invoice_no && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Invoice</span>
                  <span className="text-white">{detail.invoice_no}</span>
                </div>
              )}
              {detail.notes && (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-slate-400 text-xs mb-1">Catatan</p>
                  <p className="text-slate-200 whitespace-pre-line">{detail.notes}</p>
                </div>
              )}

              <div className="pt-3 border-t border-white/10 space-y-2">
                {detail.items?.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2">
                    <span className="text-slate-300">
                      {item.description || item.display_name || item.service_name}
                      {item.product_id ? (
                        <span className="block text-xs text-slate-400">
                          Produk{item.unit_name ? ` · ${item.unit_name}` : ''}
                        </span>
                      ) : (
                        <span className="block text-xs text-slate-400">
                          {item.pages} hal × {item.copies} rangkap
                          {item.sides === 'double' ? ' · bolak-balik' : ''}
                          {item.paper_size ? ` · ${item.paper_size}` : ''}
                        </span>
                      )}
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-white">{formatCurrency(item.line_total)}</span>
                      <span className="block text-xs text-slate-400">
                        {item.qty} {item.product_id ? (item.unit_name || 'pcs') : 'lembar'}
                      </span>
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-white/10 text-base">
                  <span className="text-white font-medium">Total</span>
                  <span className="text-ios-blue font-bold">{formatCurrency(detail.grand_total)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="transform scale-90 origin-top">
                <PrintReceipt order={detail} settings={settings} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Pembayaran */}
      <Modal
        isOpen={Boolean(paying)}
        onClose={() => setPaying(null)}
        title={`Bayar ${paying?.code || ''}`}
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setPaying(null)}>Batal</Button>
            <Button onClick={submitPay} disabled={busy || !shift}>
              {busy ? 'Memproses...' : 'Bayar Sekarang'}
            </Button>
          </div>
        )}
      >
        {paying && (
          <div className="space-y-4">
            <div className="p-3 rounded-ios bg-white/5 border border-white/10 flex justify-between">
              <span className="text-slate-400 text-sm">Total tagihan</span>
              <span className="text-white font-semibold">{formatCurrency(paying.grand_total)}</span>
            </div>

            {shift === undefined ? (
              <Spinner label="Memeriksa shift..." />
            ) : shift ? (
              <p className="text-xs text-slate-400">
                Shift aktif: #{shift.id} · kas awal {formatCurrency(shift.opening_cash)}
              </p>
            ) : (
              <div className="p-3 rounded-ios bg-ios-orange/10 border border-ios-orange/30 text-sm text-ios-orange">
                Belum ada shift terbuka.{' '}
                <Link to="/shifts" className="underline">Buka shift</Link> terlebih dahulu.
              </div>
            )}

            <Input
              as="select"
              label="Metode"
              value={payForm.method}
              onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
            >
              <option value="cash">Tunai</option>
              <option value="qris">QRIS</option>
              <option value="debit">Debit</option>
              <option value="transfer">Transfer</option>
            </Input>
            <Input
              label="Dibayar (Rp)"
              type="number"
              min="0"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
            />
            <Input
              label="Referensi (opsional)"
              value={payForm.reference}
              onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PrintOrders;

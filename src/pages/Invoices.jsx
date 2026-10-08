import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Printer, Wallet, AlertTriangle, Receipt, FileDown, XCircle, Eye,
} from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import InvoicePrint from '../components/invoice/InvoicePrint';
import useDebounce from '../hooks/useDebounce';
import { formatCurrency, formatDate, parseMoney, todayIso, firstOfMonthIso } from '../utils/formatters';
import { PAYMENT_LABELS } from '../utils/labels';

const STATUS_META = {
  unpaid: { label: 'Belum Bayar', tone: 'red' },
  partial: { label: 'Sebagian', tone: 'orange' },
  paid: { label: 'Lunas', tone: 'green' },
};

const FILTERS = [
  { key: 'unpaid', label: 'Belum Lunas' },
  { key: 'overdue', label: 'Lewat Jatuh Tempo' },
  { key: 'all', label: 'Semua' },
];

const PAY_METHODS = [
  { key: 'cash', label: 'Tunai' },
  { key: 'qris', label: 'QRIS' },
  { key: 'debit', label: 'Debit/Kredit' },
  { key: 'transfer', label: 'Transfer' },
];

const Invoices = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const { settings } = useSettings();
  const canManage = can('invoice.manage');

  const [data, setData] = useState({ data: [], pagination: null });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('unpaid');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const debouncedSearch = useDebounce(search, 350);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', reference: '', note: '' });
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25, from: range.from, to: range.to };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter === 'overdue') params.overdue_only = 'true';
      else if (filter === 'unpaid') params.payment_status = 'unpaid';
      else if (filter === 'partial') params.payment_status = 'partial';
      else if (filter === 'paid') params.payment_status = 'paid';
      const result = await api.get('/api/invoices', params);
      setData(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, filter, debouncedSearch, range, toast]);

  useEffect(() => { load(); }, [load]);

  // Saat pratinjau invoice terbuka, tandai body agar @media print menyembunyikan
  // #root sepenuhnya (display:none). Portal #invoice-print-area ada di luar #root
  // sehingga invoice menjadi konten pertama dan tercetak di halaman 1.
  useEffect(() => {
    document.body.classList.toggle('invoice-printing', previewOpen);
    return () => document.body.classList.remove('invoice-printing');
  }, [previewOpen]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.get('/api/invoices/summary'));
    } catch {
      // ringkasan opsional
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const openDetail = async (invoice) => {
    setDetailLoading(true);
    setDetail({ id: invoice.id });
    try {
      setDetail(await api.get(`/api/invoices/${invoice.id}`));
    } catch (err) {
      toast.error(err.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openPayment = () => {
    const outstanding = detail ? Number(detail.grand_total) - Number(detail.paid_amount) : 0;
    setPayForm({ amount: String(outstanding), method: 'cash', reference: '', note: '' });
    setPayOpen(true);
  };

  const submitPayment = async () => {
    const amount = parseMoney(payForm.amount);
    if (amount <= 0) return toast.warning('Jumlah pembayaran tidak valid');
    setPaying(true);
    try {
      await api.post(`/api/invoices/${detail.id}/payments`, {
        amount,
        method: payForm.method,
        reference: payForm.reference || null,
        note: payForm.note || null,
      });
      toast.success('Pembayaran dicatat');
      setPayOpen(false);
      const updated = await api.get(`/api/invoices/${detail.id}`);
      setDetail(updated);
      load();
      loadSummary();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPaying(false);
    }
  };

  const voidInvoice = async () => {
    const hadPayment = Number(detail.paid_amount) > 0;
    const msg = hadPayment
      ? `Void invoice ${detail.invoice_no}? Sudah ada pembayaran ${formatCurrency(detail.paid_amount)} yang akan dibatalkan dan stok dikembalikan.`
      : `Void invoice ${detail.invoice_no}? Stok akan dikembalikan.`;
    if (!window.confirm(msg)) return;
    const reason = window.prompt('Alasan void:') || 'Tanpa alasan';
    try {
      await api.post(`/api/invoices/${detail.id}/void`, { reason });
      toast.success('Invoice di-void');
      setDetail(null);
      load();
      loadSummary();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openPreview = async (invoice) => {
    setPreviewOpen(true);
    if (invoice.items && Array.isArray(invoice.payments)) {
      setPreviewData(invoice);
      return;
    }
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      setPreviewData(await api.get(`/api/invoices/${invoice.id}`));
    } catch (err) {
      toast.error(err.message);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewData(null);
  };

  const printPreview = () => {
    window.print();
  };

  const exportCsv = async () => {
    try {
      const params = { from: range.from, to: range.to, format: 'csv' };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter === 'overdue') params.overdue_only = 'true';
      await downloadFile('/api/invoices', `invoice-grosir-${range.from}_${range.to}.csv`, params);
      toast.success('CSV diunduh');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const outstanding = detail ? Number(detail.grand_total) - Number(detail.paid_amount) : 0;

  const columns = [
    { key: 'invoice_no', label: 'No Invoice' },
    { key: 'customer', label: 'Pelanggan' },
    { key: 'created', label: 'Tanggal' },
    { key: 'due', label: 'Jatuh Tempo' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'outstanding', label: 'Sisa', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Invoice Grosir"
        subtitle="Piutang pelanggan B2B & pembayaran bertahap"
        actions={<Button variant="neutral" onClick={exportCsv}><FileDown size={16} /> Ekspor CSV</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Total Piutang</p>
              <p className="text-xl font-bold text-white mt-1">{formatCurrency(summary?.outstanding_total ?? 0)}</p>
              <p className="text-xs text-slate-500 mt-1">{summary?.unpaid_count ?? 0} invoice belum lunas</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-blue/15 border-ios-blue/30 text-ios-blue"><Wallet size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Lewat Jatuh Tempo</p>
              <p className="text-xl font-bold text-ios-red mt-1">{formatCurrency(summary?.overdue_total ?? 0)}</p>
              <p className="text-xs text-slate-500 mt-1">{summary?.overdue_count ?? 0} invoice</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-red/15 border-ios-red/30 text-ios-red"><AlertTriangle size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Invoice Belum Lunas</p>
              <p className="text-xl font-bold text-white mt-1">{summary?.unpaid_count ?? 0}</p>
              <p className="text-xs text-slate-500 mt-1">perlu ditindaklanjuti</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-orange/15 border-ios-orange/30 text-ios-orange"><Receipt size={20} /></div>
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 border-b border-white/10 flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
              placeholder="Cari no invoice / pelanggan..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex rounded-ios-sm overflow-hidden border border-white/10">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setPage(1); }}
                className={`px-3 py-2 text-xs ${filter === f.key ? 'bg-ios-blue text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" />
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" />
          <Button variant="ghost" size="sm" onClick={() => setRange({ from: '', to: '' })}>Semua Periode</Button>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Tidak ada invoice">
            {data.data.map((invoice) => {
              const meta = STATUS_META[invoice.payment_status] || STATUS_META.unpaid;
              return (
                <tr key={invoice.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{invoice.invoice_no}</td>
                  <td className="px-4 py-3 text-white">{invoice.customer_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{formatDate(invoice.created_at)}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={invoice.is_overdue ? 'text-ios-red font-medium' : 'text-slate-400'}>
                      {invoice.due_date ? formatDate(invoice.due_date) : '-'}
                    </span>
                    {invoice.is_overdue && <Badge tone="red" className="ml-2">Telat</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right text-white">{formatCurrency(invoice.grand_total)}</td>
                  <td className="px-4 py-3 text-right text-ios-orange font-medium">{formatCurrency(invoice.outstanding)}</td>
                  <td className="px-4 py-3 text-center"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(invoice)} title="Detail"><Eye size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openPreview(invoice)} title="Pratinjau & Cetak"><Printer size={14} /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      {/* Modal detail invoice */}
      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Invoice ${detail.invoice_no || ''}` : 'Invoice'}
        size="lg"
        footer={detail && !detailLoading ? (
          <div className="flex justify-between items-center gap-2">
            <div>
              {canManage && detail.status !== 'void' && (
                <Button variant="danger" onClick={voidInvoice}><XCircle size={16} /> Void</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={() => openPreview(detail)}><Printer size={16} /> Cetak</Button>
              {canManage && detail.payment_status !== 'paid' && detail.status !== 'void' && (
                <Button variant="success" onClick={openPayment}><Wallet size={16} /> Catat Pembayaran</Button>
              )}
            </div>
          </div>
        ) : undefined}
      >
        {detailLoading || !detail ? (
          <p className="text-sm text-slate-400 py-8 text-center">Memuat...</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">Pelanggan</div><div className="text-white">{detail.customer_name || '-'}</div></div>
              <div><div className="text-xs text-slate-500">Tanggal</div><div className="text-white">{formatDate(detail.created_at)}</div></div>
              <div><div className="text-xs text-slate-500">Jatuh Tempo</div><div className={detail.is_overdue ? 'text-ios-red' : 'text-white'}>{detail.due_date ? formatDate(detail.due_date) : '-'}</div></div>
              <div><div className="text-xs text-slate-500">Total</div><div className="text-white font-medium">{formatCurrency(detail.grand_total)}</div></div>
              <div><div className="text-xs text-slate-500">Dibayar</div><div className="text-ios-green">{formatCurrency(detail.paid_amount)}</div></div>
              <div><div className="text-xs text-slate-500">Sisa Tagihan</div><div className="text-ios-orange font-medium">{formatCurrency(outstanding)}</div></div>
            </div>

            <Table columns={[
              { key: 'item', label: 'Item' },
              { key: 'qty', label: 'Qty', align: 'right' },
              { key: 'price', label: 'Harga', align: 'right' },
              { key: 'total', label: 'Jumlah', align: 'right' },
            ]}>
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-white">{item.display_name || item.product_name || item.bundle_name}{item.bundle_id ? ' (PAKET)' : ''}</td>
                  <td className="px-4 py-2 text-right text-slate-300">{item.qty} {item.unit_name || ''}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-2 text-right text-white">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </Table>

            <div>
              <p className="text-sm font-medium text-white mb-2">Riwayat Pembayaran</p>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada pembayaran.</p>
              ) : (
                <div className="space-y-2">
                  {detail.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-ios-sm text-sm">
                      <div>
                        <span className="text-white">{formatCurrency(p.amount)}</span>
                        <span className="text-slate-400 ml-2">{PAYMENT_LABELS[p.method] || p.method}</span>
                        {p.note && <span className="text-slate-500 ml-2">· {p.note}</span>}
                      </div>
                      <div className="text-xs text-slate-500 text-right">
                        <div>{formatDate(p.paid_at)}</div>
                        {p.user_name && <div>{p.user_name}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal catat pembayaran */}
      <Modal
        isOpen={payOpen}
        onClose={() => setPayOpen(false)}
        title="Catat Pembayaran"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setPayOpen(false)}>Batal</Button>
            <Button variant="success" onClick={submitPayment} disabled={paying}>{paying ? 'Menyimpan...' : 'Simpan Pembayaran'}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="p-3 rounded-ios-sm bg-white/5 text-sm flex justify-between">
            <span className="text-slate-400">Sisa Tagihan</span>
            <span className="text-ios-orange font-medium">{formatCurrency(outstanding)}</span>
          </div>
          <Input label="Jumlah Bayar (Rp)" type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} autoFocus />
          <Input as="select" label="Metode" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
            {PAY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Input>
          <Input label="Referensi (opsional)" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
          <Input label="Catatan (opsional)" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          <p className="text-xs text-slate-500">Pembayaran piutang tidak masuk kas shift kasir.</p>
        </div>
      </Modal>

      {/* Modal pratinjau A4 + tombol cetak */}
      <Modal
        isOpen={previewOpen}
        onClose={closePreview}
        title={previewData ? `Pratinjau Invoice ${previewData.invoice_no || ''}` : 'Pratinjau Invoice'}
        size="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={closePreview}>Tutup</Button>
            <Button variant="primary" onClick={printPreview} disabled={!previewData || previewLoading}>
              <Printer size={16} /> Cetak
            </Button>
          </div>
        }
      >
        {previewLoading || !previewData ? (
          <p className="text-sm text-slate-400 py-8 text-center">Memuat...</p>
        ) : (
          <div className="flex justify-center p-2 bg-slate-950/40 rounded-ios-sm overflow-x-auto">
            <InvoicePrint invoice={previewData} settings={settings} />
          </div>
        )}
      </Modal>

      {/* Area cetak: di-portal ke body agar bebas dari ancestor position:fixed /
          transform (layout aplikasi & modal). Hanya tampil saat @media print. */}
      {previewData && createPortal(
        <InvoicePrint invoice={previewData} settings={settings} print />,
        document.body,
      )}
    </div>
  );
};

export default Invoices;

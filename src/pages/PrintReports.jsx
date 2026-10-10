import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer, Wallet, ClipboardList, CheckCircle2, Clock, PackageCheck, XCircle, Download,
  FileDown, RefreshCw,
} from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import Modal from '../components/ui/Modal';
import MonthlyReportPrint from '../components/reports/MonthlyReportPrint';
import { formatCurrency, todayIso, firstOfMonthIso } from '../utils/formatters';

const STATUS_CARDS = [
  { key: 'queued', label: 'Antre', icon: Clock, tone: 'orange' },
  { key: 'processing', label: 'Diproses', icon: Printer, tone: 'blue' },
  { key: 'ready', label: 'Siap Diambil', icon: PackageCheck, tone: 'green' },
  { key: 'picked_up', label: 'Diambil', icon: CheckCircle2, tone: 'neutral' },
  { key: 'cancelled', label: 'Batal', icon: XCircle, tone: 'red' },
];

const PrintReports = () => {
  const toast = useToastContext();
  const { settings } = useSettings();
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [summary, setSummary] = useState(null);
  const [top, setTop] = useState(null);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);

  // Pratinjau laporan bulanan A4 (window.print -> "Save as PDF").
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfReport, setPdfReport] = useState(null);
  const [pdfInsight, setPdfInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);

  // Saat pratinjau terbuka, @media print menyembunyikan #root; portal
  // #report-print-area (di luar #root) tetap tercetak.
  useEffect(() => {
    document.body.classList.toggle('report-printing', pdfOpen);
    return () => document.body.classList.remove('report-printing');
  }, [pdfOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/api/reports/print-summary', range),
      api.get('/api/reports/print-top-services', range),
      api.get('/api/reports/print-queue-stats', range),
    ])
      .then(([s, t, q]) => {
        if (cancelled) return;
        setSummary(s);
        setTop(t);
        setQueue(q);
      })
      .catch((err) => { if (!cancelled) toast.error(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, toast]);

  const exportCsv = async () => {
    try {
      await downloadFile('/api/reports/print-summary', `fotokopi-penjualan-${range.from}_${range.to}.csv`, {
        ...range,
        format: 'csv',
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Insight AI laporan bulanan (kenari.id). Gagal = catatan fallback di dokumen.
  const loadPdfInsight = async (refresh = false) => {
    setInsightLoading(true);
    setPdfInsight(null);
    try {
      const params = { ...range };
      if (refresh) params.refresh = 1;
      setPdfInsight(await api.get('/api/reports/print-monthly-insight', params));
    } catch (err) {
      setPdfInsight({ content: null, cached: false, reason: 'ai_unavailable' });
      if (refresh) toast.error(err.message);
    } finally {
      setInsightLoading(false);
    }
  };

  const exportPdf = async () => {
    setPdfOpen(true);
    setPdfLoading(true);
    setPdfReport(null);
    setPdfInsight(null);
    loadPdfInsight(false);
    try {
      const [s, t] = await Promise.all([
        api.get('/api/reports/print-summary', range),
        api.get('/api/reports/print-top-services', { ...range, limit: 10 }),
      ]);
      const totals = s.totals || {};
      const avgPerOrder = totals.order_count > 0
        ? Math.round(totals.grand_total / totals.order_count)
        : 0;
      const topService = (t.rows || [])[0];
      setPdfReport({
        from: s.from,
        to: s.to,
        generated_at: new Date().toISOString(),
        kpis: [
          { label: 'Pendapatan', value: formatCurrency(totals.grand_total) },
          { label: 'Pesanan Lunas', value: totals.order_count ?? 0 },
          { label: 'Rata-rata / Pesanan', value: formatCurrency(avgPerOrder) },
          { label: 'Jasa Teratas', value: topService ? topService.service_name : '-' },
        ],
        daily: s.rows,
        services: t.rows || [],
        totals,
      });
    } catch (err) {
      toast.error(err.message);
      setPdfOpen(false);
    } finally {
      setPdfLoading(false);
    }
  };

  if (loading && !summary) return <Spinner label="Memuat laporan fotokopi..." />;

  const totals = summary?.totals || { order_count: 0, grand_total: 0, tax_total: 0 };

  return (
    <div>
      <PageHeader
        title="Laporan Fotokopi"
        subtitle="Penjualan jasa, layanan terpopuler, dan status antrian"
        actions={(
          <div className="flex gap-2">
            <Button variant="neutral" onClick={exportPdf}>
              <FileDown size={16} /> Export PDF
            </Button>
            <Button variant="neutral" onClick={exportCsv}>
              <Download size={16} /> Unduh CSV
            </Button>
          </div>
        )}
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Dari" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input label="Sampai" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <div className="flex items-end">
            <Button variant="neutral" className="w-full" onClick={() => setRange({ from: firstOfMonthIso(), to: todayIso() })}>
              Reset ke bulan ini
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Pesanan Lunas</p>
              <p className="text-2xl font-bold text-white mt-2">{totals.order_count}</p>
              <p className="text-xs text-slate-400 mt-1">periode terpilih</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-blue/15 border-ios-blue/30 text-ios-blue">
              <ClipboardList size={20} />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Pendapatan</p>
              <p className="text-2xl font-bold text-white mt-2">{formatCurrency(totals.grand_total)}</p>
              <p className="text-xs text-slate-400 mt-1">PPN {formatCurrency(totals.tax_total)}</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-green/15 border-ios-green/30 text-ios-green">
              <Wallet size={20} />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Pesanan Periode</p>
              <p className="text-2xl font-bold text-white mt-2">{queue?.total ?? 0}</p>
              <p className="text-xs text-slate-400 mt-1">{queue?.paid ?? 0} sudah dibayar</p>
            </div>
            <div className="p-3 rounded-ios-sm border bg-ios-purple/15 border-ios-purple/30 text-ios-purple">
              <Printer size={20} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Penjualan Harian" className="lg:col-span-2" padded={false}>
          <div className="p-4">
            <Table
              columns={[
                { key: 'date', label: 'Tanggal' },
                { key: 'order_count', label: 'Pesanan', align: 'right' },
                { key: 'subtotal', label: 'Subtotal', align: 'right' },
                { key: 'discount', label: 'Diskon', align: 'right' },
                { key: 'grand_total', label: 'Total', align: 'right' },
              ]}
              loading={loading}
              empty="Belum ada penjualan jasa pada periode ini"
            >
              {(summary?.rows || []).map((row) => (
                <tr key={row.date} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{row.date}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{row.order_count}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{formatCurrency(row.subtotal)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{formatCurrency(row.discount)}</td>
                  <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(row.grand_total)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Status Antrian (periode)">
            <div className="space-y-2">
              {STATUS_CARDS.map((card) => (
                <div key={card.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-300">
                    <card.icon size={14} /> {card.label}
                  </span>
                  <Badge tone={card.tone}>{queue?.by_status?.[card.key] ?? 0}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Layanan Terpopuler" padded={false}>
            <div className="p-4">
              <Table
                columns={[
                  { key: 'service_name', label: 'Jasa' },
                  { key: 'sheets', label: 'Lembar', align: 'right' },
                  { key: 'revenue', label: 'Pendapatan', align: 'right' },
                ]}
                loading={loading}
                empty="Belum ada data jasa"
              >
                {(top?.rows || []).map((row) => (
                  <tr key={row.service_id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">
                      {row.service_name}
                      {row.category && <span className="block text-xs text-slate-400 capitalize">{row.category}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">{row.sheets}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(row.revenue)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        </div>
      </div>

      {/* Modal pratinjau laporan bulanan A4 + tombol cetak/simpan PDF */}
      <Modal
        isOpen={pdfOpen}
        onClose={() => setPdfOpen(false)}
        title="Pratinjau Laporan Bulanan Fotokopi"
        size="xl"
        footer={(
          <div className="flex justify-between items-center gap-2">
            <Button
              variant="neutral"
              onClick={() => loadPdfInsight(true)}
              disabled={pdfLoading || insightLoading || !pdfReport}
            >
              <RefreshCw size={16} /> {insightLoading ? 'Membuat ulang...' : 'Regenerate Insight'}
            </Button>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={() => setPdfOpen(false)}>Tutup</Button>
              <Button
                variant="primary"
                onClick={() => window.print()}
                disabled={pdfLoading || !pdfReport}
              >
                <Printer size={16} /> Cetak / Simpan PDF
              </Button>
            </div>
          </div>
        )}
      >
        {pdfLoading || !pdfReport ? (
          <p className="text-sm text-slate-400 py-8 text-center">Memuat laporan...</p>
        ) : (
          <div className="flex justify-center p-2 bg-slate-950/40 rounded-ios-sm overflow-x-auto">
            <MonthlyReportPrint
              business="fotokopi"
              report={pdfReport}
              settings={settings}
              insight={pdfInsight}
              onRegenerate={insightLoading ? undefined : () => loadPdfInsight(true)}
            />
          </div>
        )}
      </Modal>

      {/* Area cetak: portal ke body agar bebas dari ancestor fixed/transform modal. */}
      {pdfOpen && pdfReport && createPortal(
        <MonthlyReportPrint
          business="fotokopi"
          report={pdfReport}
          settings={settings}
          insight={pdfInsight}
          print
        />,
        document.body,
      )}
    </div>
  );
};

export default PrintReports;

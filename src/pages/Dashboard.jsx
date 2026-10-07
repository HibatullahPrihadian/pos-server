import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Receipt, PiggyBank, AlertTriangle, Clock, ShoppingBag, ArrowRight, CalendarClock, Wallet,
  HandCoins,
} from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useBusiness } from '../context/BusinessContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import TrendLineChart, { zeroFillDailySeries } from '../components/charts/TrendLineChart';
import { formatCurrency, formatDate, todayIso, firstOfMonthIso } from '../utils/formatters';

const KPI = ({ icon: Icon, label, value, sub, tone = 'blue', to }) => {
  const tones = {
    blue: 'bg-ios-blue/15 border-ios-blue/30 text-ios-blue',
    green: 'bg-ios-green/15 border-ios-green/30 text-ios-green',
    purple: 'bg-ios-purple/15 border-ios-purple/30 text-ios-purple',
    orange: 'bg-ios-orange/15 border-ios-orange/30 text-ios-orange',
    red: 'bg-ios-red/15 border-ios-red/30 text-ios-red',
  };

  const content = (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-white mt-2">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-3 rounded-ios-sm border ${tones[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );

  if (!to) return content;

  return (
    <Link
      to={to}
      title={`Buka ${label}`}
      aria-label={`Buka ${label}`}
      className="block rounded-ios transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/70 [&>div]:transition-colors [&>div:hover]:border-white/20 [&>div:hover]:bg-slate-900/80"
    >
      {content}
    </Link>
  );
};

// Dashboard mode fotokopi: fokus pada antrian pesanan & pendapatan jasa.
// Data stok/piutang minimarket sengaja tidak ditampilkan (bukan milik usaha ini).
const PrintDashboard = () => {
  const toast = useToastContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const to = todayIso();
    const from = firstOfMonthIso();

    Promise.all([
      api.get('/api/reports/print-summary', { from, to }),
      api.get('/api/reports/print-queue-stats', { from: to, to }),
      api.get('/api/reports/dashboard').catch(() => null),
    ])
      .then(([summary, queue, dash]) => setData({ summary, queue, dash, today: to }))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return <Spinner label="Memuat dashboard fotokopi..." />;
  if (!data) return null;

  const todayRow = (data.summary?.rows || []).find((r) => r.date === data.today)
    || { order_count: 0, grand_total: 0, tax_total: 0 };
  const activeQueue = (data.queue?.by_status?.queued || 0)
    + (data.queue?.by_status?.processing || 0)
    + (data.queue?.by_status?.ready || 0);
  const printTrend = zeroFillDailySeries(
    data.summary?.rows || [],
    data.summary?.from || firstOfMonthIso(),
    data.summary?.to || data.today
  );

  return (
    <div>
      <PageHeader title="Dashboard Fotokopi" subtitle="Ringkasan pesanan & pendapatan jasa" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPI
          icon={Wallet}
          label="Pendapatan Hari Ini"
          value={formatCurrency(todayRow.grand_total)}
          sub={`PPN ${formatCurrency(todayRow.tax_total)}`}
          tone="green"
          to="/print-reports"
        />
        <KPI
          icon={Receipt}
          label="Pesanan Hari Ini"
          value={todayRow.order_count}
          sub={`${data.queue?.paid ?? 0} lunas hari ini`}
          tone="blue"
          to="/print-orders"
        />
        <KPI
          icon={Clock}
          label="Antrian Aktif"
          value={activeQueue}
          sub="antre / diproses / siap"
          tone={activeQueue > 0 ? 'orange' : 'green'}
          to="/print-orders"
        />
        <KPI
          icon={CalendarClock}
          label="Shift Terbuka"
          value={data.dash?.open_shifts ?? 0}
          sub="shift usaha ini"
          tone="purple"
          to="/shifts"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card
          title="Pendapatan Bulan Ini"
          className="lg:col-span-2 flex flex-col"
          bodyClassName="flex-1 min-h-48 flex flex-col"
        >
          <TrendLineChart data={printTrend} emptyLabel="Belum ada penjualan jasa" />
        </Card>

        <div className="space-y-5">
          <Card title="Status Antrian Hari Ini">
            <div className="space-y-2 text-sm">
              {[['queued', 'Antre'], ['processing', 'Diproses'], ['ready', 'Siap Diambil'], ['picked_up', 'Diambil']].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-slate-300">{label}</span>
                  <Badge tone={key === 'queued' ? 'orange' : key === 'ready' ? 'green' : 'blue'}>
                    {data.queue?.by_status?.[key] ?? 0}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Pintasan">
            <div className="space-y-2">
              <Link to="/print-orders/new" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><Receipt size={16} /> Buat Pesanan</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link to="/print-orders" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><Clock size={16} /> Buka Antrian</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link to="/print-reports" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><TrendingUp size={16} /> Lihat Laporan</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const MinimarketDashboard = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [expiring, setExpiring] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/reports/dashboard'),
      api.get('/api/stock/expiring').catch(() => null),
    ])
      .then(([dash, exp]) => {
        setData(dash);
        setExpiring(exp);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return <Spinner label="Memuat dashboard..." />;
  if (!data) return null;

  // Halaman tujuan KPI masing-masing punya izinnya sendiri; sembunyikan tautan
  // bila user tidak punya izin halaman tersebut.
  const linkTo = (path) => {
    if (path.startsWith('/reports') && !can('report.view')) return undefined;
    if (path.startsWith('/stock') && !can('stock.view')) return undefined;
    if (path.startsWith('/invoices') && !can('invoice.view')) return undefined;
    return path;
  };

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Ringkasan operasional toko" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPI
          icon={TrendingUp}
          label="Penjualan Hari Ini"
          value={formatCurrency(data.today.grand_total)}
          sub={`${data.today.txn_count} transaksi`}
          tone="green"
          to={linkTo('/reports?tab=sales-summary')}
        />
        <KPI
          icon={PiggyBank}
          label="Laba Kotor Hari Ini"
          value={formatCurrency(data.today.gross_profit)}
          sub={`PPN ${formatCurrency(data.today.tax_total)}`}
          tone="purple"
          to={linkTo('/reports?tab=gross-profit')}
        />
        <KPI
          icon={Wallet}
          label="Laba Bersih Hari Ini"
          value={formatCurrency(data.today.net_profit ?? 0)}
          sub={`Beban ${formatCurrency(data.today.expense ?? 0)}`}
          tone={(data.today.net_profit ?? 0) >= 0 ? 'green' : 'red'}
          to={linkTo('/reports?tab=profit-loss')}
        />
        <KPI
          icon={Wallet}
          label="Laba Bersih Bulan Ini"
          value={formatCurrency(data.month.net_profit ?? 0)}
          sub={`Beban ${formatCurrency(data.month.expense ?? 0)}`}
          tone={(data.month.net_profit ?? 0) >= 0 ? 'blue' : 'red'}
          to={linkTo('/reports?tab=profit-loss')}
        />
        <KPI
          icon={Receipt}
          label="Penjualan Bulan Ini"
          value={formatCurrency(data.month.grand_total)}
          sub={`${data.month.txn_count} transaksi`}
          tone="blue"
          to={linkTo('/reports?tab=sales-summary')}
        />
        <KPI
          icon={ShoppingBag}
          label="Modal"
          value={formatCurrency(data.month.purchase_paid ?? 0)}
          sub={`Hari ini ${formatCurrency(data.today.purchase_paid ?? 0)} · ${data.month.purchase_paid_count ?? 0} PO lunas`}
          tone="blue"
          to={linkTo('/reports?tab=purchase-paid')}
        />
        <KPI
          icon={AlertTriangle}
          label="Stok Minimum"
          value={data.low_stock_count}
          sub="produk perlu restock"
          tone="orange"
          to={linkTo('/stock?tab=low')}
        />
        <KPI
          icon={CalendarClock}
          label="Akan Kadaluarsa"
          value={expiring?.expiring?.length ?? 0}
          sub={`≤ ${expiring?.warning_days ?? 180} hari`}
          tone="orange"
          to={linkTo('/stock?tab=batches')}
        />
        <KPI
          icon={AlertTriangle}
          label="Sudah Kadaluarsa"
          value={expiring?.expired?.length ?? 0}
          sub="batch perlu dibuang"
          tone="red"
          to={linkTo('/stock?tab=batches')}
        />
        <KPI
          icon={HandCoins}
          label="Piutang Grosir"
          value={formatCurrency(data.receivable?.outstanding_total ?? 0)}
          sub={`Lewat jatuh tempo: ${formatCurrency(data.receivable?.overdue_total ?? 0)}`}
          tone={(data.receivable?.overdue_total ?? 0) > 0 ? 'red' : 'orange'}
          to={linkTo('/invoices')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card
          title="Tren Penjualan Bulan Ini"
          className="lg:col-span-2 flex flex-col"
          bodyClassName="flex-1 min-h-48 flex flex-col"
        >
          <TrendLineChart data={data.trend} />
        </Card>

        <div className="space-y-5">
          <Card title="Produk Terlaris (30 hari)">
            {data.top_products.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada penjualan</p>
            ) : (
              <div className="space-y-2">
                {data.top_products.map((product, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300 flex items-center gap-2 truncate">
                      <span className="w-5 text-slate-500">{index + 1}.</span>
                      {product.product_name}
                    </span>
                    <Badge tone="blue">{product.qty_sold}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Batch Akan/ Sudah Kadaluarsa">
            {(!expiring || (expiring.expiring.length === 0 && expiring.expired.length === 0)) ? (
              <p className="text-sm text-slate-500">Tidak ada batch mendekati kadaluarsa</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {[...expiring.expired, ...expiring.expiring].slice(0, 8).map((batch) => (
                  <div key={batch.id} className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-300 truncate">
                      {batch.product_name}
                      {batch.batch_code ? <span className="text-slate-500"> · {batch.batch_code}</span> : null}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-500">{formatDate(batch.expiry_date)}</span>
                      <Badge tone={batch.is_expired ? 'red' : 'orange'}>{batch.qty_remaining}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Pintasan">
            <div className="space-y-2">
              <Link to="/pos" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><ShoppingBag size={16} /> Buka Kasir</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link to="/stock" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><AlertTriangle size={16} /> Cek Stok Minimum</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link to="/reports" className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors">
                <span className="text-white text-sm flex items-center gap-2"><Receipt size={16} /> Lihat Laporan</span>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
                <span className="text-slate-400 text-sm flex items-center gap-2"><Clock size={16} /> Shift Terbuka</span>
                <Badge tone={data.open_shifts > 0 ? 'green' : 'neutral'}>{data.open_shifts}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Route "/" dipakai kedua mode: isi dashboard menyesuaikan mode usaha aktif.
const Dashboard = () => {
  const { business } = useBusiness();
  return business === 'fotokopi' ? <PrintDashboard /> : <MinimarketDashboard />;
};

export default Dashboard;

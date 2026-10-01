import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Receipt, PiggyBank, AlertTriangle, Clock, ShoppingBag, ArrowRight, CalendarClock,
} from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../utils/formatters';

const KPI = ({ icon: Icon, label, value, sub, tone = 'blue' }) => {
  const tones = {
    blue: 'bg-ios-blue/15 border-ios-blue/30 text-ios-blue',
    green: 'bg-ios-green/15 border-ios-green/30 text-ios-green',
    purple: 'bg-ios-purple/15 border-ios-purple/30 text-ios-purple',
    orange: 'bg-ios-orange/15 border-ios-orange/30 text-ios-orange',
    red: 'bg-ios-red/15 border-ios-red/30 text-ios-red',
  };

  return (
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
};

const Dashboard = () => {
  const toast = useToastContext();
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

  const maxTrend = Math.max(...data.trend.map((t) => t.grand_total), 1);

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
        />
        <KPI
          icon={PiggyBank}
          label="Laba Kotor Hari Ini"
          value={formatCurrency(data.today.gross_profit)}
          sub={`PPN ${formatCurrency(data.today.tax_total)}`}
          tone="purple"
        />
        <KPI
          icon={Receipt}
          label="Penjualan Bulan Ini"
          value={formatCurrency(data.month.grand_total)}
          sub={`${data.month.txn_count} transaksi`}
          tone="blue"
        />
        <KPI
          icon={AlertTriangle}
          label="Stok Minimum"
          value={data.low_stock_count}
          sub="produk perlu restock"
          tone="orange"
        />
        <KPI
          icon={CalendarClock}
          label="Akan Kadaluarsa"
          value={expiring?.expiring?.length ?? 0}
          sub={`≤ ${expiring?.warning_days ?? 180} hari`}
          tone="orange"
        />
        <KPI
          icon={AlertTriangle}
          label="Sudah Kadaluarsa"
          value={expiring?.expired?.length ?? 0}
          sub="batch perlu dibuang"
          tone="red"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Tren Penjualan 7 Hari" className="lg:col-span-2">
          {data.trend.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">Belum ada data penjualan</p>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {data.trend.map((item) => (
                <div key={item.date} className="flex-1 flex flex-col items-center gap-2">
                  <div className="text-xs text-slate-400">{formatCurrency(item.grand_total).replace('Rp', '')}</div>
                  <div
                    className="w-full bg-gradient-to-t from-ios-blue to-ios-cyan rounded-t"
                    style={{ height: `${Math.max(4, (item.grand_total / maxTrend) * 140)}px` }}
                  />
                  <div className="text-xs text-slate-500">{item.date.slice(8)}/{item.date.slice(5, 7)}</div>
                </div>
              ))}
            </div>
          )}
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

export default Dashboard;

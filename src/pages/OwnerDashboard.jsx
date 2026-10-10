import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Store, Printer, TrendingUp, Receipt, Clock, ArrowRight } from 'lucide-react';
import { getToken } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useBusiness, BUSINESS_META } from '../context/BusinessContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import TrendLineChart from '../components/charts/TrendLineChart';
import { formatCurrency } from '../utils/formatters';

const ICONS = { minimarket: Store, fotokopi: Printer };
const TONES = {
  minimarket: 'bg-ios-blue/15 border-ios-blue/30 text-ios-blue',
  fotokopi: 'bg-ios-purple/15 border-ios-purple/30 text-ios-purple',
};

// Dashboard gabungan lintas usaha (owner). Tidak mengubah mode aktif; masuk ke
// salah satu usaha lewat setBusiness + tautan.
const OwnerDashboard = () => {
  const toast = useToastContext();
  const { setBusiness } = useBusiness();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Request khusus: ringkasan gabungan butuh X-Business: all.
        const res = await fetch('/api/reports/overview', {
          headers: { Authorization: `Bearer ${getToken()}`, 'X-Business': 'all' },
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || 'Gagal memuat ringkasan');
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [toast]);

  if (loading) return <Spinner label="Memuat ringkasan semua usaha..." />;
  if (!data) return null;

  const enterBusiness = (business) => setBusiness(business);

  return (
    <div>
      <PageHeader
        title="Semua Usaha"
        subtitle="Ringkasan gabungan minimarket & fotokopi"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-xs text-slate-400 uppercase tracking-wide">Penjualan Hari Ini</p>
          <p className="text-2xl font-bold text-white mt-2">{formatCurrency(data.totals.today_grand_total)}</p>
          <p className="text-xs text-slate-400 mt-1">{data.totals.today_txn_count} transaksi (semua usaha)</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400 uppercase tracking-wide">Penjualan Bulan Ini</p>
          <p className="text-2xl font-bold text-white mt-2">{formatCurrency(data.totals.month_grand_total)}</p>
          <p className="text-xs text-slate-400 mt-1">{data.totals.month_txn_count} transaksi</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400 uppercase tracking-wide">Antrian Fotokopi</p>
          <p className="text-2xl font-bold text-white mt-2">{data.fotokopi.active_queue}</p>
          <p className="text-xs text-slate-400 mt-1">antre / diproses / siap</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400 uppercase tracking-wide">Jasa Fotokopi Hari Ini</p>
          <p className="text-2xl font-bold text-white mt-2">{formatCurrency(data.fotokopi.today_revenue)}</p>
          <p className="text-xs text-slate-400 mt-1">{data.fotokopi.today_orders} pesanan lunas</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card
          title="Tren Gabungan Bulan Ini"
          className="lg:col-span-2 flex flex-col"
          bodyClassName="flex-1 min-h-48 flex flex-col"
        >
          <TrendLineChart data={data.trend || []} />
        </Card>

        <Card title="Shift Terbuka per Usaha">
          <div className="space-y-3">
            {data.businesses.map((b) => (
              <div key={b.business} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{BUSINESS_META[b.business]?.label || b.business}</span>
                <Badge tone={b.open_shifts > 0 ? 'green' : 'neutral'}>{b.open_shifts}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {data.businesses.map((b) => {
          const Icon = ICONS[b.business] || Store;
          const meta = BUSINESS_META[b.business] || { label: b.business, description: '' };
          return (
            <Card key={b.business}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className={`p-3 rounded-ios-sm border ${TONES[b.business] || TONES.minimarket}`}>
                    <Icon size={22} />
                  </span>
                  <div>
                    <p className="font-semibold text-white">{meta.label}</p>
                    <p className="text-xs text-slate-400">{meta.description}</p>
                  </div>
                </div>
                <Badge tone={b.open_shifts > 0 ? 'green' : 'neutral'}>{b.open_shifts} shift</Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 rounded-ios-sm bg-white/5">
                  <p className="text-xs text-slate-400 flex items-center gap-1"><TrendingUp size={12} /> Hari ini</p>
                  <p className="text-lg font-bold text-white mt-1">{formatCurrency(b.today.grand_total)}</p>
                  <p className="text-xs text-slate-400">{b.today.txn_count} transaksi</p>
                </div>
                <div className="p-3 rounded-ios-sm bg-white/5">
                  <p className="text-xs text-slate-400 flex items-center gap-1"><Receipt size={12} /> Bulan ini</p>
                  <p className="text-lg font-bold text-white mt-1">{formatCurrency(b.month.grand_total)}</p>
                  <p className="text-xs text-slate-400">{b.month.txn_count} transaksi</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to={b.business === 'fotokopi' ? '/print-orders' : '/pos'}
                  onClick={() => enterBusiness(b.business)}
                  className="flex-1 flex items-center justify-between p-3 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors"
                >
                  <span className="text-white text-sm flex items-center gap-2"><Clock size={16} /> Masuk usaha</span>
                  <ArrowRight size={16} className="text-slate-400" />
                </Link>
                <Link
                  to="/"
                  onClick={() => enterBusiness(b.business)}
                  className="flex items-center justify-center p-3 px-4 bg-white/5 rounded-ios-sm hover:bg-white/10 transition-colors text-sm text-slate-300"
                >
                  Dashboard
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default OwnerDashboard;

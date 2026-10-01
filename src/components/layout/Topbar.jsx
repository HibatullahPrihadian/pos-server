import { useEffect, useState } from 'react';
import { Clock, Wifi, WifiOff } from 'lucide-react';
import { api } from '../../api/client';
import { formatTime } from '../../utils/formatters';

const Topbar = () => {
  const [now, setNow] = useState(new Date());
  const [healthy, setHealthy] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Cek kesehatan backend tiap 30 detik agar kasir tahu bila koneksi putus.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await api.get('/api/health');
        if (!cancelled) setHealthy(true);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dateLabel = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-slate-900/40 backdrop-blur-glass">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Clock size={16} />
        <span>{dateLabel}</span>
        <span className="text-slate-600">•</span>
        <span className="text-white font-medium">{formatTime(now)}</span>
      </div>
      <div
        className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${healthy ? 'bg-ios-green/10 border-ios-green/30 text-ios-green' : 'bg-ios-red/10 border-ios-red/30 text-ios-red'}`}
      >
        {healthy ? <Wifi size={14} /> : <WifiOff size={14} />}
        {healthy ? 'Terhubung' : 'Koneksi terputus'}
      </div>
    </div>
  );
};

export default Topbar;

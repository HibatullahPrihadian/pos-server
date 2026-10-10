import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { formatCurrency, formatDate } from '../../utils/formatters';

// Isi titik harian yang hilang dengan 0 antara from..to ('YYYY-MM-DD').
// Dipakai PrintDashboard (print-summary tetap sparse di backend).
export const zeroFillDailySeries = (rows, from, to) => {
  const byDate = new Map((rows || []).map((r) => [r.date, r]));
  const out = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const existing = byDate.get(iso);
    out.push(
      existing
        ? { ...existing, date: iso, grand_total: Number(existing.grand_total) || 0 }
        : { date: iso, grand_total: 0 }
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

const compactAmount = (n) => {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}jt`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 border border-white/10 rounded-ios-sm px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-400 mb-0.5">{formatDate(label)}</p>
      <p className="text-xs font-semibold text-white">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

const TrendLineChart = ({ data, emptyLabel = 'Belum ada data penjualan' }) => {
  const hasSales = (data || []).some((d) => (d.grand_total ?? 0) > 0);
  if (!hasSales) {
    return (
      <div className="flex-1 min-h-48 flex items-center justify-center">
        <p className="text-sm text-slate-400 text-center">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}`}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={12}
          />
          <YAxis
            tickFormatter={compactAmount}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
          <Line
            type="monotone"
            dataKey="grand_total"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendLineChart;

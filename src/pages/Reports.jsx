import { useState, useEffect, useCallback } from 'react';
import { Download, BarChart3 } from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { formatCurrency, formatDate, todayIso, firstOfMonthIso } from '../utils/formatters';
import { PAYMENT_LABELS } from '../utils/labels';

const TABS = [
  { key: 'sales-summary', label: 'Penjualan Harian' },
  { key: 'by-cashier', label: 'Per Kasir' },
  { key: 'by-payment', label: 'Per Metode Bayar' },
  { key: 'gross-profit', label: 'Laba Kotor' },
  { key: 'top-products', label: 'Produk Terlaris' },
  { key: 'low-stock', label: 'Stok Minimum' },
  { key: 'stock-card', label: 'Kartu Stok' },
];

const Reports = () => {
  const toast = useToastContext();
  const [tab, setTab] = useState('sales-summary');
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      if (tab === 'stock-card') {
        if (!productId) { setLoading(false); return; }
        setData(await api.get(`/api/reports/stock-card/${productId}`, { from: range.from, to: range.to }));
      } else if (tab === 'low-stock') {
        setData(await api.get('/api/reports/low-stock'));
      } else {
        setData(await api.get(`/api/reports/${tab}`, { from: range.from, to: range.to }));
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, range, productId, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/products', { limit: 200 }).then((res) => setProducts(res.data)).catch(() => {});
  }, []);

  const exportCsv = async () => {
    try {
      const params = { from: range.from, to: range.to, format: 'csv' };
      if (tab === 'stock-card') {
        if (!productId) return toast.warning('Pilih produk terlebih dahulu');
        await downloadFile(`/api/reports/stock-card/${productId}`, `kartu-stok-${range.from}_${range.to}.csv`, params);
      } else if (tab === 'low-stock') {
        await downloadFile('/api/reports/low-stock', 'stok-minimum.csv', { format: 'csv' });
      } else {
        await downloadFile(`/api/reports/${tab}`, `${tab}-${range.from}_${range.to}.csv`, params);
      }
      toast.success('CSV diunduh');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const renderTable = () => {
    if (!data) return <p className="text-sm text-slate-500 py-8 text-center">Tidak ada data</p>;

    if (tab === 'sales-summary') {
      return (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Transaksi', value: data.totals.txn_count },
              { label: 'Penjualan', value: formatCurrency(data.totals.grand_total) },
              { label: 'PPN (incl.)', value: formatCurrency(data.totals.tax_total) },
              { label: 'Retur', value: formatCurrency(data.totals.refund_total) },
            ].map((kpi) => (
              <div key={kpi.label} className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-xs text-slate-400">{kpi.label}</div>
                <div className="text-lg font-semibold text-white">{kpi.value}</div>
              </div>
            ))}
          </div>
          <Table
            columns={[
              { key: 'date', label: 'Tanggal' },
              { key: 'txn', label: 'Transaksi', align: 'right' },
              { key: 'subtotal', label: 'Subtotal', align: 'right' },
              { key: 'discount', label: 'Diskon', align: 'right' },
              { key: 'tax', label: 'PPN', align: 'right' },
              { key: 'total', label: 'Total', align: 'right' },
              { key: 'refund', label: 'Retur', align: 'right' },
            ]}
          >
            {data.rows.map((row) => (
              <tr key={row.date} className="hover:bg-white/5">
                <td className="px-4 py-2 text-white">{formatDate(row.date)}</td>
                <td className="px-4 py-2 text-right text-slate-300">{row.txn_count}</td>
                <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(row.subtotal)}</td>
                <td className="px-4 py-2 text-right text-ios-orange">{formatCurrency(row.item_discount + row.txn_discount + row.points_value)}</td>
                <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(row.tax_total)}</td>
                <td className="px-4 py-2 text-right text-white font-medium">{formatCurrency(row.grand_total)}</td>
                <td className="px-4 py-2 text-right text-ios-red">{row.refund_total ? formatCurrency(row.refund_total) : '-'}</td>
              </tr>
            ))}
          </Table>
        </>
      );
    }

    if (tab === 'by-cashier') {
      return (
        <Table
          columns={[
            { key: 'name', label: 'Kasir' },
            { key: 'txn', label: 'Transaksi', align: 'right' },
            { key: 'total', label: 'Total Penjualan', align: 'right' },
            { key: 'net', label: 'Penjualan Bersih', align: 'right' },
          ]}
        >
          {data.rows.map((row) => (
            <tr key={row.cashier_id} className="hover:bg-white/5">
              <td className="px-4 py-2 text-white">{row.cashier_name}</td>
              <td className="px-4 py-2 text-right text-slate-300">{row.txn_count}</td>
              <td className="px-4 py-2 text-right text-white font-medium">{formatCurrency(row.grand_total)}</td>
              <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(row.net_sales)}</td>
            </tr>
          ))}
        </Table>
      );
    }

    if (tab === 'by-payment') {
      return (
        <Table
          columns={[
            { key: 'method', label: 'Metode' },
            { key: 'txn', label: 'Transaksi', align: 'right' },
            { key: 'total', label: 'Total', align: 'right' },
          ]}
        >
          {data.rows.map((row) => (
            <tr key={row.method} className="hover:bg-white/5">
              <td className="px-4 py-2 text-white">{PAYMENT_LABELS[row.method] || row.method}</td>
              <td className="px-4 py-2 text-right text-slate-300">{row.txn_count}</td>
              <td className="px-4 py-2 text-right text-white font-medium">{formatCurrency(row.total)}</td>
            </tr>
          ))}
        </Table>
      );
    }

    if (tab === 'gross-profit') {
      return (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Pendapatan', value: formatCurrency(data.summary.revenue) },
              { label: 'HPP', value: formatCurrency(data.summary.cogs) },
              { label: 'Laba Kotor', value: formatCurrency(data.summary.gross_profit) },
            ].map((kpi) => (
              <div key={kpi.label} className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-xs text-slate-400">{kpi.label}</div>
                <div className="text-lg font-semibold text-ios-green">{kpi.value}</div>
              </div>
            ))}
          </div>
          <Table
            columns={[
              { key: 'date', label: 'Tanggal' },
              { key: 'revenue', label: 'Pendapatan', align: 'right' },
              { key: 'cogs', label: 'HPP', align: 'right' },
              { key: 'profit', label: 'Laba Kotor', align: 'right' },
            ]}
          >
            {data.rows.map((row) => (
              <tr key={row.date} className="hover:bg-white/5">
                <td className="px-4 py-2 text-white">{formatDate(row.date)}</td>
                <td className="px-4 py-2 text-right text-slate-300">{formatCurrency(row.revenue)}</td>
                <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(row.cogs)}</td>
                <td className="px-4 py-2 text-right text-ios-green font-medium">{formatCurrency(row.gross_profit)}</td>
              </tr>
            ))}
          </Table>
        </>
      );
    }

    if (tab === 'top-products') {
      return (
        <Table
          columns={[
            { key: 'product', label: 'Produk' },
            { key: 'qty', label: 'Terjual', align: 'right' },
            { key: 'revenue', label: 'Pendapatan', align: 'right' },
            { key: 'profit', label: 'Laba Kotor', align: 'right' },
          ]}
        >
          {data.rows.map((row) => (
            <tr key={row.product_id} className="hover:bg-white/5">
              <td className="px-4 py-2">
                <div className="text-white">{row.product_name}</div>
                <div className="text-xs text-slate-500 font-mono">{row.sku}</div>
              </td>
              <td className="px-4 py-2 text-right text-slate-300">{row.qty_sold} {row.base_unit}</td>
              <td className="px-4 py-2 text-right text-white">{formatCurrency(row.revenue)}</td>
              <td className="px-4 py-2 text-right text-ios-green">{formatCurrency(row.gross_profit)}</td>
            </tr>
          ))}
        </Table>
      );
    }

    if (tab === 'low-stock') {
      return (
        <Table
          columns={[
            { key: 'sku', label: 'SKU' },
            { key: 'product', label: 'Produk' },
            { key: 'category', label: 'Kategori' },
            { key: 'stock', label: 'Stok', align: 'right' },
            { key: 'min', label: 'Minimum', align: 'right' },
            { key: 'status', label: 'Status', align: 'center' },
          ]}
        >
          {data.rows.map((row) => (
            <tr key={row.product_id} className="hover:bg-white/5">
              <td className="px-4 py-2 font-mono text-xs text-slate-400">{row.sku}</td>
              <td className="px-4 py-2 text-white">{row.product_name}</td>
              <td className="px-4 py-2 text-slate-400">{row.category_name || '-'}</td>
              <td className="px-4 py-2 text-right text-ios-orange font-medium">{row.stock_qty}</td>
              <td className="px-4 py-2 text-right text-slate-400">{row.min_stock}</td>
              <td className="px-4 py-2 text-center">
                <Badge tone={row.stock_qty <= 0 ? 'red' : 'orange'}>
                  {row.stock_qty <= 0 ? 'Habis' : 'Rendah'}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      );
    }

    if (tab === 'stock-card') {
      return (
        <Table
          columns={[
            { key: 'time', label: 'Waktu' },
            { key: 'type', label: 'Jenis' },
            { key: 'change', label: 'Perubahan', align: 'right' },
            { key: 'balance', label: 'Saldo', align: 'right' },
            { key: 'note', label: 'Keterangan' },
          ]}
        >
          {data.rows.map((row, index) => (
            <tr key={index} className="hover:bg-white/5">
              <td className="px-4 py-2 text-sm text-slate-400">{formatDate(row.created_at)}</td>
              <td className="px-4 py-2 text-slate-300">{row.type}</td>
              <td className={`px-4 py-2 text-right font-medium ${row.qty_change > 0 ? 'text-ios-green' : 'text-ios-red'}`}>
                {row.qty_change > 0 ? '+' : ''}{row.qty_change}
              </td>
              <td className="px-4 py-2 text-right text-white">{row.balance_after}</td>
              <td className="px-4 py-2 text-sm text-slate-400">{row.note || '-'}</td>
            </tr>
          ))}
        </Table>
      );
    }

    return null;
  };

  return (
    <div>
      <PageHeader
        title="Laporan"
        subtitle="Analisis penjualan, laba, dan stok dengan ekspor CSV"
        actions={<Button variant="neutral" onClick={exportCsv}><Download size={16} /> Ekspor CSV</Button>}
      />

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-3 py-2 rounded-ios-sm text-sm transition-colors ${tab === item.key ? 'bg-ios-blue text-white shadow-glow-blue' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-4 flex flex-wrap gap-3 border-b border-white/10 items-center">
          <BarChart3 size={18} className="text-ios-blue" />
          {tab === 'stock-card' ? (
            <select
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60 min-w-[240px]"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">- Pilih Produk -</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </select>
          ) : null}
          {tab !== 'low-stock' && (
            <>
              <input
                type="date"
                className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
              <input
                type="date"
                className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </>
          )}
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-sm text-slate-500 py-8 text-center">Memuat laporan...</p>
          ) : (
            renderTable()
          )}
        </div>
      </Card>
    </div>
  );
};

export default Reports;

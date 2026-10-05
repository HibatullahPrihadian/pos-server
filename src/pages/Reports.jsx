import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, BarChart3 } from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import useDebounce from '../hooks/useDebounce';
import { formatCurrency, formatDate, todayIso, firstOfMonthIso } from '../utils/formatters';
import { PAYMENT_LABELS, PO_STATUS_LABELS } from '../utils/labels';

const TABS = [
  { key: 'sales-summary', label: 'Penjualan Harian' },
  { key: 'by-cashier', label: 'Per Kasir' },
  { key: 'by-payment', label: 'Per Metode Bayar' },
  { key: 'gross-profit', label: 'Laba Kotor' },
  { key: 'profit-loss', label: 'Laba Rugi' },
  { key: 'purchase-paid', label: 'Modal' },
  { key: 'top-products', label: 'Produk Terlaris' },
  { key: 'low-stock', label: 'Stok Minimum' },
  { key: 'stock-card', label: 'Kartu Stok' },
];

const Reports = () => {
  const toast = useToastContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab');
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === paramTab) ? paramTab : 'sales-summary'));
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [data, setData] = useState(null);
  const [dataTab, setDataTab] = useState(null);
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 350);

  const requestIdRef = useRef(0);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    if (tab === 'stock-card' && !productId) {
      abortRef.current?.abort();
      setData(null);
      setDataTab(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setData(null);
    setDataTab(null);
    try {
      let payload;
      if (tab === 'stock-card') {
        payload = await api.get(`/api/reports/stock-card/${productId}`, { from: range.from, to: range.to }, { signal: controller.signal });
      } else if (tab === 'low-stock') {
        payload = await api.get('/api/reports/low-stock', undefined, { signal: controller.signal });
      } else if (tab === 'purchase-paid') {
        const params = { from: range.from, to: range.to };
        if (supplierId) params.supplier_id = supplierId;
        if (search.trim()) params.search = search.trim();
        payload = await api.get('/api/reports/purchase-paid', params, { signal: controller.signal });
      } else {
        payload = await api.get(`/api/reports/${tab}`, { from: range.from, to: range.to }, { signal: controller.signal });
      }
      if (requestId !== requestIdRef.current) return;
      setData(payload);
      setDataTab(tab);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (requestId !== requestIdRef.current) return;
      toast.error(err.message);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [tab, range, productId, supplierId, search, toast]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (searchParams.get('tab') !== tab) setSearchParams({ tab }, { replace: true });
  }, [tab, searchParams, setSearchParams]);

  // Ikuti perubahan URL (mis. tombol back/forward) saat komponen tetap ter-mount.
  useEffect(() => {
    const next = searchParams.get('tab');
    if (TABS.some((t) => t.key === next)) setTab(next);
  }, [searchParams]);

  useEffect(() => {
    api.get('/api/products', { limit: 200 }).then((res) => setProducts(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/api/suppliers').then((res) => setSuppliers(res)).catch(() => {});
  }, []);

  const exportCsv = async () => {
    try {
      const params = { from: range.from, to: range.to, format: 'csv' };
      if (tab === 'stock-card') {
        if (!productId) return toast.warning('Pilih produk terlebih dahulu');
        await downloadFile(`/api/reports/stock-card/${productId}`, `kartu-stok-${range.from}_${range.to}.csv`, params);
      } else if (tab === 'low-stock') {
        await downloadFile('/api/reports/low-stock', 'stok-minimum.csv', { format: 'csv' });
      } else if (tab === 'purchase-paid') {
        if (supplierId) params.supplier_id = supplierId;
        if (search.trim()) params.search = search.trim();
        await downloadFile('/api/reports/purchase-paid', `modal-pembelian-${range.from}_${range.to}.csv`, params);
      } else {
        await downloadFile(`/api/reports/${tab}`, `${tab}-${range.from}_${range.to}.csv`, params);
      }
      toast.success('CSV diunduh');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const renderTable = () => {
    if (!data || dataTab !== tab) return <p className="text-sm text-slate-500 py-8 text-center">Tidak ada data</p>;

    if (tab === 'sales-summary') {
      if (!data.totals) return <p className="text-sm text-slate-500 py-8 text-center">Data tidak tersedia</p>;
      return (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Transaksi', value: data.totals.txn_count ?? 0 },
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
      if (!data.summary) return <p className="text-sm text-slate-500 py-8 text-center">Data tidak tersedia</p>;
      return (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Pendapatan', value: formatCurrency(data.summary?.revenue ?? 0) },
              { label: 'HPP', value: formatCurrency(data.summary?.cogs ?? 0) },
              { label: 'Laba Kotor', value: formatCurrency(data.summary?.gross_profit ?? 0) },
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

    if (tab === 'profit-loss') {
      if (!data.summary) return <p className="text-sm text-slate-500 py-8 text-center">Data tidak tersedia</p>;
      return (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
            {[
              { label: 'Penjualan', value: formatCurrency(data.summary?.revenue ?? 0) },
              { label: 'HPP', value: formatCurrency(data.summary?.cogs ?? 0) },
              { label: 'Laba Kotor', value: formatCurrency(data.summary?.gross_profit ?? 0) },
              { label: 'Retur (neto HPP)', value: formatCurrency((data.summary?.return_refund ?? 0) - (data.summary?.return_cogs ?? 0)) },
              { label: 'Beban Operasional', value: formatCurrency(data.summary?.operating_expense ?? 0) },
              { label: 'Laba Bersih', value: formatCurrency(data.summary?.net_profit ?? 0), highlight: true },
            ].map((kpi) => (
              <div key={kpi.label} className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-xs text-slate-400">{kpi.label}</div>
                <div className={`text-lg font-semibold ${kpi.highlight ? 'text-ios-green' : 'text-white'}`}>{kpi.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div>
              <h4 className="text-sm font-semibold text-white mb-2">Beban per Kategori</h4>
              <Table
                columns={[
                  { key: 'category', label: 'Kategori' },
                  { key: 'amount', label: 'Jumlah', align: 'right' },
                ]}
                empty="Belum ada beban pada periode ini"
              >
                {(data.expense_by_category || []).map((row) => (
                  <tr key={row.category} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-white">{row.category}</td>
                    <td className="px-4 py-2 text-right text-ios-orange font-medium">{formatCurrency(row.amount)}</td>
                  </tr>
                ))}
              </Table>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white mb-2">Informasi (tidak mengurangi laba)</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
                  <span className="text-sm text-slate-300">Pembelian Stok (total PO)</span>
                  <span className="text-white">{formatCurrency(data.info?.purchase_total ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
                  <span className="text-sm text-slate-300">Sudah Dibayar (Modal)</span>
                  <span className="text-white">{formatCurrency(data.info?.purchase_paid ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-ios-sm">
                  <span className="text-sm text-slate-300">Payout Penitip (Konsinyasi)</span>
                  <span className="text-white">{formatCurrency(data.info?.consignment_payout ?? 0)}</span>
                </div>
                <p className="text-xs text-slate-500">
                  Pembelian Stok = total PO periode ini; Sudah Dibayar (Modal) = PO yang sudah lunas
                  penuh. Selisihnya adalah PO yang belum lunas penuh. Keduanya mengubah kas menjadi
                  persediaan (aset), bukan beban; HPP sudah otomatis dikurangkan saat barang terjual.
                </p>
              </div>
            </div>
          </div>

          <Table
            columns={[
              { key: 'date', label: 'Tanggal' },
              { key: 'revenue', label: 'Penjualan', align: 'right' },
              { key: 'cogs', label: 'HPP', align: 'right' },
              { key: 'gross', label: 'Laba Kotor', align: 'right' },
              { key: 'expense', label: 'Beban', align: 'right' },
              { key: 'net', label: 'Laba Bersih', align: 'right' },
            ]}
          >
            {data.rows.map((row) => (
              <tr key={row.date} className="hover:bg-white/5">
                <td className="px-4 py-2 text-white">{formatDate(row.date)}</td>
                <td className="px-4 py-2 text-right text-slate-300">{formatCurrency(row.revenue)}</td>
                <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(row.cogs)}</td>
                <td className="px-4 py-2 text-right text-slate-300">{formatCurrency(row.gross_profit_net)}</td>
                <td className="px-4 py-2 text-right text-ios-orange">{formatCurrency(row.expense)}</td>
                <td className={`px-4 py-2 text-right font-medium ${row.net_profit >= 0 ? 'text-ios-green' : 'text-ios-red'}`}>
                  {formatCurrency(row.net_profit)}
                </td>
              </tr>
            ))}
          </Table>
        </>
      );
    }

    if (tab === 'purchase-paid') {
      if (!data.summary) return <p className="text-sm text-slate-500 py-8 text-center">Data tidak tersedia</p>;
      return (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Total Modal', value: formatCurrency(data.summary?.total_amount ?? 0), highlight: true },
              { label: 'Jumlah PO', value: data.summary?.po_count ?? 0 },
              { label: 'Total Item (qty)', value: data.summary?.item_qty ?? 0 },
            ].map((kpi) => (
              <div key={kpi.label} className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-xs text-slate-400">{kpi.label}</div>
                <div className={`text-lg font-semibold ${kpi.highlight ? 'text-ios-green' : 'text-white'}`}>{kpi.value}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500 mb-4">
            Hanya PO yang sudah dibayar penuh ke supplier. Modal pembelian mengubah kas menjadi
            persediaan (aset); bukan beban laba — HPP sudah otomatis dikurangkan saat barang terjual.
          </p>

          <Table
            columns={[
              { key: 'date', label: 'Tanggal' },
              { key: 'code', label: 'Kode' },
              { key: 'supplier', label: 'Supplier' },
              { key: 'invoice', label: 'No. Invoice' },
              { key: 'qty', label: 'Item (qty)', align: 'right' },
              { key: 'total', label: 'Total', align: 'right' },
              { key: 'paid', label: 'Dibayar', align: 'right' },
              { key: 'status', label: 'Status Terima' },
            ]}
            empty={(data.rows || []).length === 0 ? 'Belum ada data' : undefined}
          >
            {(data.rows || []).map((row) => (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-4 py-2 text-white">{formatDate(row.date)}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">{row.code}</td>
                <td className="px-4 py-2 text-white">{row.supplier_name || '-'}</td>
                <td className="px-4 py-2 text-slate-400">{row.invoice_no || '-'}</td>
                <td className="px-4 py-2 text-right text-slate-300">{row.qty_total}</td>
                <td className="px-4 py-2 text-right text-white font-medium">{formatCurrency(row.total)}</td>
                <td className="px-4 py-2 text-right text-ios-green">{formatCurrency(row.paid_amount)}</td>
                <td className="px-4 py-2 text-slate-400">{PO_STATUS_LABELS[row.status] || row.status}</td>
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
          {tab === 'purchase-paid' ? (
            <>
              <select
                className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60 min-w-[180px]"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">- Semua Supplier -</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Cari kode/invoice"
                className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-ios-blue/60"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </>
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

import { useState, useEffect, useCallback } from 'react';
import { Search, Eye, Printer, RotateCcw, Ban } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useToastContext } from '../context/ToastContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Receipt from '../components/receipt/Receipt';
import { formatDateTime, formatCurrency, parseQty, todayIso, firstOfMonthIso } from '../utils/formatters';
import { PAYMENT_LABELS, SALE_STATUS_LABELS } from '../utils/labels';
import { printReceipt } from '../utils/printReceipt';

const Transactions = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const canViewAll = can('user.manage');
  const { settings } = useSettings();

  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ from: firstOfMonthIso(), to: todayIso(), status: '', method: '', invoice_no: '' });
  const [users, setUsers] = useState([]);
  const [cashierFilter, setCashierFilter] = useState('');

  const [detail, setDetail] = useState(null);
  const [receiptView, setReceiptView] = useState(false);

  const [voidConfirm, setVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQtys, setReturnQtys] = useState({});
  const [returnForm, setReturnForm] = useState({ refund_method: 'cash', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.get('/api/sales', {
          page,
          limit: 25,
          from: filters.from,
          to: filters.to,
          status: filters.status,
          method: filters.method,
          invoice_no: filters.invoice_no,
          cashier_id: cashierFilter,
        })
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters, cashierFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (canViewAll) api.get('/api/users').then(setUsers).catch(() => {});
  }, [canViewAll]);

  const openDetail = async (sale) => {
    try {
      setDetail(await api.get(`/api/sales/${sale.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitVoid = async () => {
    try {
      await api.post(`/api/sales/${detail.id}/void`, { reason: voidReason });
      toast.success('Transaksi di-void, stok dikembalikan');
      setVoidConfirm(false);
      setVoidReason('');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setVoidConfirm(false);
    }
  };

  const openReturn = () => {
    const initial = {};
    detail.items.forEach((item) => { initial[item.id] = 0; });
    setReturnQtys(initial);
    setReturnForm({ refund_method: 'cash', reason: '' });
    setReturnOpen(true);
  };

  const submitReturn = async () => {
    try {
      const items = Object.entries(returnQtys)
        .map(([saleItemId, qty]) => ({ sale_item_id: Number(saleItemId), qty: parseQty(qty) }))
        .filter((i) => i.qty > 0);
      if (items.length === 0) return toast.warning('Isi jumlah retur minimal satu item');

      await api.post('/api/returns', {
        sale_id: detail.id,
        shift_id: detail.shift_id,
        refund_method: returnForm.refund_method,
        reason: returnForm.reason,
        items,
      });
      toast.success('Retur berhasil, stok dikembalikan');
      setReturnOpen(false);
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const canVoid = detail && detail.status === 'completed';

  const columns = [
    { key: 'invoice', label: 'Invoice' },
    { key: 'time', label: 'Waktu' },
    { key: 'cashier', label: 'Kasir' },
    { key: 'member', label: 'Member' },
    { key: 'payment', label: 'Pembayaran' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader title="Transaksi" subtitle="Riwayat penjualan, cetak ulang, retur, dan void" />

      <Card padded={false}>
        <div className="p-4 flex flex-wrap gap-3 border-b border-white/10">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
              placeholder="Cari no. invoice..."
              value={filters.invoice_no}
              onChange={(e) => { setFilters({ ...filters, invoice_no: e.target.value }); setPage(1); }}
            />
          </div>
          <input
            type="date"
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={filters.from}
            onChange={(e) => { setFilters({ ...filters, from: e.target.value }); setPage(1); }}
          />
          <input
            type="date"
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={filters.to}
            onChange={(e) => { setFilters({ ...filters, to: e.target.value }); setPage(1); }}
          />
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={filters.method}
            onChange={(e) => { setFilters({ ...filters, method: e.target.value }); setPage(1); }}
          >
            <option value="">Semua Metode</option>
            {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={filters.status}
            onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}
          >
            <option value="">Semua Status</option>
            <option value="completed">Selesai</option>
            <option value="void">Void</option>
          </select>
          {canViewAll && (
            <select
              className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
              value={cashierFilter}
              onChange={(e) => { setCashierFilter(e.target.value); setPage(1); }}
            >
              <option value="">Semua Kasir</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          )}
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada transaksi">
            {data.data.map((sale) => (
              <tr key={sale.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-sm text-white">{sale.invoice_no}</td>
                <td className="px-4 py-3 text-sm text-slate-400">{formatDateTime(sale.created_at)}</td>
                <td className="px-4 py-3 text-slate-300">{sale.cashier_name || '-'}</td>
                <td className="px-4 py-3 text-slate-400">{sale.member_name || '-'}</td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {(sale.methods || '').split(',').filter(Boolean).map((m) => PAYMENT_LABELS[m] || m).join(' + ') || '-'}
                </td>
                <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(sale.grand_total)}</td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={sale.status === 'completed' ? 'green' : 'red'}>
                    {SALE_STATUS_LABELS[sale.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openDetail(sale)}><Eye size={14} /></Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal isOpen={Boolean(detail) && !receiptView} onClose={() => setDetail(null)} title={`Transaksi ${detail?.invoice_no || ''}`} size="lg">
        {detail && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge tone={detail.status === 'completed' ? 'green' : 'red'}>{SALE_STATUS_LABELS[detail.status]}</Badge>
              <span className="text-sm text-slate-400">{formatDateTime(detail.created_at)}</span>
              <span className="text-sm text-slate-400">• Kasir: {detail.cashier_name}</span>
              {detail.member_name && <span className="text-sm text-slate-400">• Member: {detail.member_name}</span>}
            </div>

            {detail.status === 'void' && detail.void_reason && (
              <div className="p-3 mb-4 rounded-ios-sm bg-ios-red/10 border border-ios-red/30 text-sm text-ios-red">
                Void: {detail.void_reason}
              </div>
            )}

            <Table
              columns={[
                { key: 'product', label: 'Produk' },
                { key: 'qty', label: 'Qty', align: 'right' },
                { key: 'price', label: 'Harga', align: 'right' },
                { key: 'discount', label: 'Diskon', align: 'right' },
                { key: 'returned', label: 'Retur', align: 'right' },
                { key: 'total', label: 'Total', align: 'right' },
              ]}
            >
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-white">
                    {item.display_name || item.product_name || item.bundle_name || '-'}
                    {item.bundle_id ? ' (PAKET)' : ''}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300">{item.qty} {item.unit_name || item.base_unit || ''}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-2 text-right text-ios-orange">{item.discount > 0 ? `-${formatCurrency(item.discount)}` : '-'}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{item.returned_qty || '-'}</td>
                  <td className="px-4 py-2 text-right text-white">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </Table>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span className="text-white">{formatCurrency(detail.subtotal)}</span></div>
                {detail.item_discount > 0 && <div className="flex justify-between"><span className="text-slate-400">Diskon Item</span><span className="text-ios-orange">-{formatCurrency(detail.item_discount)}</span></div>}
                {detail.txn_discount > 0 && <div className="flex justify-between"><span className="text-slate-400">Diskon Transaksi</span><span className="text-ios-orange">-{formatCurrency(detail.txn_discount)}</span></div>}
                {detail.points_value > 0 && <div className="flex justify-between"><span className="text-slate-400">Tukar Poin</span><span className="text-ios-purple">-{formatCurrency(detail.points_value)}</span></div>}
                <div className="flex justify-between"><span className="text-slate-400">PPN (incl.)</span><span className="text-white">{formatCurrency(detail.tax_total)}</span></div>
                <div className="flex justify-between pt-1 border-t border-white/10"><span className="text-white font-semibold">TOTAL</span><span className="text-ios-green font-bold">{formatCurrency(detail.grand_total)}</span></div>
              </div>
              <div className="space-y-1 text-sm">
                {detail.payments.map((payment) => (
                  <div key={payment.id} className="flex justify-between">
                    <span className="text-slate-400">{PAYMENT_LABELS[payment.method]}</span>
                    <span className="text-white">{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
                {(detail.points_earned > 0 || detail.points_redeemed > 0) && (
                  <div className="flex justify-between pt-1 border-t border-white/10">
                    <span className="text-slate-400">Poin</span>
                    <span className="text-ios-yellow">+{detail.points_earned} / -{detail.points_redeemed}</span>
                  </div>
                )}
                {detail.returns?.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <p className="text-slate-400 mb-1">Retur:</p>
                    {detail.returns.map((ret) => (
                      <div key={ret.id} className="flex justify-between text-xs">
                        <span className="text-slate-400 font-mono">{ret.code}</span>
                        <span className="text-ios-orange">-{formatCurrency(ret.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 mt-5 pt-4 border-t border-white/10">
              <Button variant="neutral" onClick={() => setReceiptView(true)}><Printer size={16} /> Cetak Struk</Button>
              {canVoid && (
                <Button variant="warning" onClick={openReturn}><RotateCcw size={16} /> Retur</Button>
              )}
              {canVoid && (
                <Button variant="danger" onClick={() => setVoidConfirm(true)}><Ban size={16} /> Void</Button>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(detail) && receiptView}
        onClose={() => setReceiptView(false)}
        title="Struk"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setReceiptView(false)}>Tutup</Button>
            <Button onClick={printReceipt}><Printer size={16} /> Cetak</Button>
          </div>
        }
      >
        {detail && (
          <div className="bg-white rounded-ios-sm p-2 max-h-[60vh] overflow-y-auto">
            <Receipt sale={detail} settings={settings} />
          </div>
        )}
      </Modal>

      <Modal
        isOpen={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Retur Barang"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setReturnOpen(false)}>Batal</Button>
            <Button variant="warning" onClick={submitReturn}><RotateCcw size={16} /> Proses Retur</Button>
          </div>
        }
      >
        <p className="text-sm text-slate-400 mb-4">Masukkan jumlah yang diretur. Stok dikembalikan dengan HPP asli saat penjualan.</p>
        <Table
          columns={[
            { key: 'product', label: 'Produk' },
            { key: 'sold', label: 'Dibeli', align: 'right' },
            { key: 'returned', label: 'Sudah Retur', align: 'right' },
            { key: 'now', label: 'Retur Sekarang', align: 'right' },
          ]}
        >
          {(detail?.items || []).map((item) => {
            const remaining = item.qty - (item.returned_qty || 0);
            return (
              <tr key={item.id}>
                <td className="px-4 py-2 text-white">
                  {item.display_name || item.product_name || item.bundle_name || '-'}
                  {item.bundle_id ? ' (PAKET)' : ''}
                </td>
                <td className="px-4 py-2 text-right text-slate-300">{item.qty}</td>
                <td className="px-4 py-2 text-right text-slate-400">{item.returned_qty || 0}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    max={remaining}
                    disabled={remaining <= 0}
                    className="w-20 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-right text-white disabled:opacity-40"
                    value={returnQtys[item.id] ?? 0}
                    onChange={(e) => setReturnQtys({ ...returnQtys, [item.id]: Math.min(remaining, Math.max(0, parseQty(e.target.value))) })}
                  />
                </td>
              </tr>
            );
          })}
        </Table>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Input as="select" label="Metode Pengembalian" value={returnForm.refund_method} onChange={(e) => setReturnForm({ ...returnForm, refund_method: e.target.value })}>
            <option value="cash">Tunai</option>
            <option value="transfer">Transfer</option>
          </Input>
          <Input label="Alasan" value={returnForm.reason} onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={voidConfirm}
        onClose={() => setVoidConfirm(false)}
        onConfirm={submitVoid}
        title="Void Transaksi"
        message={`Void transaksi ${detail?.invoice_no}? Stok akan dikembalikan dan poin member disesuaikan. Hanya transaksi hari ini dengan shift belum ditutup yang dapat di-void.`}
        confirmLabel="Void"
      />
    </div>
  );
};

export default Transactions;

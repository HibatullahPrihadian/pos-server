import { useState, useEffect, useCallback } from 'react';
import { Plus, Eye, PackageCheck, Trash2, CreditCard, XCircle } from 'lucide-react';
import { api } from '../api/client';
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
import useDebounce from '../hooks/useDebounce';
import { formatDate, formatCurrency, parseMoney, parseQty, todayIso } from '../utils/formatters';
import { PO_STATUS_LABELS } from '../utils/labels';

const PO_TONES = {
  draft: 'neutral',
  ordered: 'blue',
  partial: 'orange',
  received: 'green',
  cancelled: 'red',
};

const Purchases = () => {
  const toast = useToastContext();
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [suppliers, setSuppliers] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [header, setHeader] = useState({ supplier_id: '', invoice_no: '', date: todayIso(), note: '', status: 'draft' });
  const [lines, setLines] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState([]);
  const debouncedSearch = useDebounce(productSearch, 350);

  const [detail, setDetail] = useState(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState({});
  const [receiveMeta, setReceiveMeta] = useState({});
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/purchases', { page, limit: 25, status: statusFilter }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/suppliers').then(setSuppliers).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/api/products', { search: debouncedSearch, limit: 20 }).then((r) => setProducts(r.data)).catch(() => {});
  }, [debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setHeader({ supplier_id: '', invoice_no: '', date: todayIso(), note: '', status: 'draft' });
    setLines([]);
    setFormOpen(true);
  };

  const openEdit = async (po) => {
    try {
      const full = await api.get(`/api/purchases/${po.id}`);
      setEditing(full);
      setHeader({
        supplier_id: full.supplier_id || '',
        invoice_no: full.invoice_no || '',
        date: String(full.date).slice(0, 10),
        note: full.note || '',
        status: full.status,
      });
      setLines(
        full.items.map((item) => ({
          product_id: item.product_id,
          name: item.product_name,
          sku: item.sku,
          unit_id: item.unit_id,
          unit_name: item.unit_name,
          qty: item.qty,
          unit_cost: item.unit_cost,
          base_unit: item.base_unit,
        }))
      );
      setFormOpen(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addLine = async (product) => {
    let units = [];
    try {
      units = await api.get(`/api/products/${product.id}/units`);
    } catch {
      units = [];
    }
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit_id: null,
        unit_name: product.base_unit,
        qty: 1,
        unit_cost: product.cost_price,
        base_unit: product.base_unit,
        available_units: units,
      },
    ]);
    setProductSearch('');
  };

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const changeLineUnit = (index, unitId) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const unit = (line.available_units || []).find((u) => String(u.id) === String(unitId));
        return {
          ...line,
          unit_id: unit ? unit.id : null,
          unit_name: unit ? unit.unit_name : line.base_unit,
          qty: 1,
        };
      })
    );
  };

  const savePO = async () => {
    try {
      const payload = {
        supplier_id: header.supplier_id || null,
        invoice_no: header.invoice_no,
        date: header.date,
        note: header.note,
        status: header.status,
        items: lines.map((line) => ({
          product_id: line.product_id,
          unit_id: line.unit_id,
          qty: parseQty(line.qty),
          unit_cost: parseMoney(line.unit_cost),
        })),
      };
      if (editing) await api.put(`/api/purchases/${editing.id}`, payload);
      else await api.post('/api/purchases', payload);
      toast.success(editing ? 'PO diperbarui' : 'PO dibuat');
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openDetail = async (po) => {
    try {
      setDetail(await api.get(`/api/purchases/${po.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openReceive = async (po) => {
    try {
      const full = await api.get(`/api/purchases/${po.id}`);
      setDetail(full);
      const initial = {};
      const meta = {};
      full.items.forEach((item) => {
        initial[item.id] = item.qty - item.received_qty;
        meta[item.id] = { expiry_date: '', batch_code: '' };
      });
      setReceiveQty(initial);
      setReceiveMeta(meta);
      setReceiveOpen(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitReceive = async () => {
    try {
      const items = Object.entries(receiveQty)
        .map(([id, qty]) => ({
          purchase_item_id: Number(id),
          received_qty: parseQty(qty),
          expiry_date: receiveMeta[id]?.expiry_date || null,
          batch_code: receiveMeta[id]?.batch_code || null,
        }))
        .filter((i) => i.received_qty > 0);
      if (items.length === 0) return toast.warning('Isi jumlah terima minimal satu item');
      await api.post(`/api/purchases/${detail.id}/receive`, { items });
      toast.success('Barang diterima, stok dan HPP diperbarui');
      setReceiveOpen(false);
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitPayment = async () => {
    try {
      await api.post(`/api/purchases/${detail.id}/payment`, { amount: parseMoney(paymentAmount) });
      toast.success('Pembayaran dicatat');
      setPaymentOpen(false);
      setPaymentAmount('');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancelPO = async () => {
    try {
      await api.post(`/api/purchases/${cancelConfirm.id}/cancel`, {});
      toast.success('PO dibatalkan');
      setCancelConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setCancelConfirm(null);
    }
  };

  const columns = [
    { key: 'code', label: 'Kode' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'date', label: 'Tanggal' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'payment', label: 'Bayar', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  const formTotal = lines.reduce((sum, line) => sum + parseQty(line.qty) * parseMoney(line.unit_cost), 0);

  return (
    <div>
      <PageHeader
        title="Pembelian"
        subtitle="Purchase order, penerimaan barang, dan pembayaran supplier"
        actions={<Button onClick={openCreate}><Plus size={16} /> PO Baru</Button>}
      />

      <Card padded={false}>
        <div className="p-4 border-b border-white/10">
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Semua Status</option>
            {Object.entries(PO_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada pembelian">
            {data.data.map((po) => (
              <tr key={po.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-sm text-white">{po.code}</td>
                <td className="px-4 py-3 text-slate-300">{po.supplier_name || '-'}</td>
                <td className="px-4 py-3 text-slate-400">{formatDate(po.date)}</td>
                <td className="px-4 py-3 text-right text-white">{formatCurrency(po.total)}</td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={PO_TONES[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
                </td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={po.payment_status === 'paid' ? 'green' : 'orange'}>
                    {po.payment_status === 'paid' ? 'Lunas' : 'Belum Lunas'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openDetail(po)} title="Detail"><Eye size={14} /></Button>
                    {['draft', 'ordered'].includes(po.status) && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(po)} title="Ubah">Ubah</Button>
                        <Button variant="ghost" size="sm" onClick={() => openReceive(po)} title="Terima"><PackageCheck size={14} className="text-ios-green" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setCancelConfirm(po)} title="Batalkan"><XCircle size={14} className="text-ios-red" /></Button>
                      </>
                    )}
                    {po.status === 'partial' && (
                      <Button variant="ghost" size="sm" onClick={() => openReceive(po)} title="Terima Sisa"><PackageCheck size={14} className="text-ios-green" /></Button>
                    )}
                    {po.payment_status === 'unpaid' && po.status !== 'cancelled' && (
                      <Button variant="ghost" size="sm" onClick={() => { setDetail(po); setPaymentOpen(true); }} title="Bayar">
                        <CreditCard size={14} className="text-ios-blue" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination pagination={data.pagination} onChange={setPage} />
        </div>
      </Card>

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Ubah PO ${editing.code}` : 'Purchase Order Baru'}
        size="xl"
        footer={
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold">Total: {formatCurrency(formTotal)}</span>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={() => setFormOpen(false)}>Batal</Button>
              <Button onClick={savePO} disabled={lines.length === 0}>Simpan</Button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-4 gap-3 mb-5">
          <Input as="select" label="Supplier" value={header.supplier_id} onChange={(e) => setHeader({ ...header, supplier_id: e.target.value })}>
            <option value="">- Pilih -</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Input>
          <Input label="No. Invoice Supplier" value={header.invoice_no} onChange={(e) => setHeader({ ...header, invoice_no: e.target.value })} />
          <Input label="Tanggal" type="date" value={header.date} onChange={(e) => setHeader({ ...header, date: e.target.value })} />
          <Input as="select" label="Status" value={header.status} onChange={(e) => setHeader({ ...header, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="ordered">Dikirim</option>
          </Input>
        </div>

        <div className="mb-4">
          <Input label="Tambah Produk" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Cari nama / SKU produk..." />
          {productSearch && products.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-ios-sm border border-white/10 bg-slate-950/90">
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addLine(product)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex justify-between"
                >
                  <span className="text-white">{product.name}</span>
                  <span className="text-slate-500 font-mono text-xs">{product.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Table
          columns={[
            { key: 'product', label: 'Produk' },
            { key: 'unit', label: 'Satuan' },
            { key: 'qty', label: 'Qty', align: 'right' },
            { key: 'cost', label: 'Harga Beli', align: 'right' },
            { key: 'subtotal', label: 'Subtotal', align: 'right' },
            { key: 'actions', label: '', align: 'right' },
          ]}
          empty="Belum ada item"
        >
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="px-4 py-2">
                <div className="text-white">{line.name}</div>
                <div className="text-xs text-slate-500 font-mono">{line.sku}</div>
              </td>
              <td className="px-4 py-2">
                <select
                  className="bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-xs text-white"
                  value={line.unit_id || ''}
                  onChange={(e) => changeLineUnit(index, e.target.value)}
                >
                  <option value="">{line.base_unit}</option>
                  {(line.available_units || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.unit_name} (x{u.conversion_factor})</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2 text-right">
                <input
                  type="number"
                  className="w-20 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-right text-white"
                  value={line.qty}
                  onChange={(e) => updateLine(index, { qty: e.target.value })}
                />
              </td>
              <td className="px-4 py-2 text-right">
                <input
                  type="number"
                  className="w-28 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-right text-white"
                  value={line.unit_cost}
                  onChange={(e) => updateLine(index, { unit_cost: e.target.value })}
                />
              </td>
              <td className="px-4 py-2 text-right text-white">
                {formatCurrency(parseQty(line.qty) * parseMoney(line.unit_cost))}
              </td>
              <td className="px-4 py-2 text-right">
                <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                  <Trash2 size={14} className="text-ios-red" />
                </Button>
              </td>
            </tr>
          ))}
        </Table>

        <div className="mt-4">
          <Input as="textarea" label="Catatan" value={header.note} onChange={(e) => setHeader({ ...header, note: e.target.value })} />
        </div>
      </Modal>

      <Modal isOpen={Boolean(detail) && !receiveOpen && !paymentOpen} onClose={() => setDetail(null)} title={`PO ${detail?.code || ''}`} size="lg">
        {detail && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Supplier</div>
                <div className="text-white">{detail.supplier_name || '-'}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Tanggal</div>
                <div className="text-white">{formatDate(detail.date)}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-ios-sm">
                <div className="text-slate-400 text-xs">Status</div>
                <div className="text-white">{PO_STATUS_LABELS[detail.status]}</div>
              </div>
            </div>
            <Table
              columns={[
                { key: 'product', label: 'Produk' },
                { key: 'ordered', label: 'Dipesan', align: 'right' },
                { key: 'received', label: 'Diterima', align: 'right' },
                { key: 'cost', label: 'Harga', align: 'right' },
                { key: 'total', label: 'Total', align: 'right' },
              ]}
            >
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-white">{item.product_name}</td>
                  <td className="px-4 py-2 text-right text-slate-300">{item.qty} {item.unit_name || item.base_unit}</td>
                  <td className="px-4 py-2 text-right text-slate-300">{item.received_qty}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(item.unit_cost)}</td>
                  <td className="px-4 py-2 text-right text-white">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </Table>
            <div className="flex justify-end gap-6 mt-4 text-sm">
              <div>Total: <span className="text-white font-semibold">{formatCurrency(detail.total)}</span></div>
              <div>Dibayar: <span className="text-white font-semibold">{formatCurrency(detail.paid_amount)}</span></div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title={`Penerimaan Barang - ${detail?.code || ''}`}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setReceiveOpen(false)}>Batal</Button>
            <Button variant="success" onClick={submitReceive}><PackageCheck size={16} /> Terima Barang</Button>
          </div>
        }
      >
        {detail && (
          <>
            <p className="text-sm text-slate-400 mb-4">
              Masukkan jumlah yang diterima. Stok bertambah dan HPP diperbarui dengan metode rata-rata bergerak.
              Tanggal kadaluarsa opsional; isi agar penjualan memakai batch ini secara FEFO.
            </p>
            <Table
              columns={[
                { key: 'product', label: 'Produk' },
                { key: 'ordered', label: 'Dipesan', align: 'right' },
                { key: 'received', label: 'Sudah Diterima', align: 'right' },
                { key: 'now', label: 'Terima Sekarang', align: 'right' },
                { key: 'expiry', label: 'Kadaluarsa (opsional)' },
                { key: 'batch_code', label: 'Kode Batch' },
              ]}
            >
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-white">{item.product_name}</td>
                  <td className="px-4 py-2 text-right text-slate-300">{item.qty}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{item.received_qty}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-24 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-right text-white"
                      value={receiveQty[item.id] ?? ''}
                      onChange={(e) => setReceiveQty({ ...receiveQty, [item.id]: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="date"
                      className="bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-sm text-white"
                      value={receiveMeta[item.id]?.expiry_date || ''}
                      onChange={(e) => setReceiveMeta({
                        ...receiveMeta,
                        [item.id]: { ...(receiveMeta[item.id] || {}), expiry_date: e.target.value },
                      })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="w-28 bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-sm text-white"
                      placeholder="Opsional"
                      value={receiveMeta[item.id]?.batch_code || ''}
                      onChange={(e) => setReceiveMeta({
                        ...receiveMeta,
                        [item.id]: { ...(receiveMeta[item.id] || {}), batch_code: e.target.value },
                      })}
                    />
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Modal>

      <Modal
        isOpen={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={`Pembayaran PO ${detail?.code || ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setPaymentOpen(false)}>Batal</Button>
            <Button onClick={submitPayment} disabled={!paymentAmount}><CreditCard size={16} /> Bayar</Button>
          </div>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="text-sm text-slate-300">
              Total PO: <span className="text-white font-semibold">{formatCurrency(detail.total)}</span><br />
              Sisa: <span className="text-ios-orange font-semibold">{formatCurrency(detail.total - detail.paid_amount)}</span>
            </div>
            <Input label="Jumlah Bayar" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} autoFocus />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(cancelConfirm)}
        onClose={() => setCancelConfirm(null)}
        onConfirm={cancelPO}
        title="Batalkan PO"
        message={`Batalkan PO ${cancelConfirm?.code}? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Batalkan PO"
      />
    </div>
  );
};

export default Purchases;

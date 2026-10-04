import { useState, useEffect, useCallback } from 'react';
import { Printer, Wand2, RefreshCw, Copy } from 'lucide-react';
import { api } from '../../api/client';
import { useToastContext } from '../../context/ToastContext';
import Card from '../ui/Card';
import Table from '../ui/Table';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Pagination from '../ui/Pagination';
import { formatCurrency } from '../../utils/formatters';

const LABEL_SIZES = [
  { key: '40x30', label: '40 × 30 mm', width: '40mm', height: '30mm', cols: 5 },
  { key: '50x30', label: '50 × 30 mm', width: '50mm', height: '30mm', cols: 4 },
  { key: '33x25', label: '33 × 25 mm', width: '33mm', height: '25mm', cols: 6 },
];

// Ambil SVG barcode dari endpoint batch agar satu request untuk banyak label.
const fetchLabels = async (ids) => {
  const res = await api.post('/api/bundles/barcodes/render', { ids });
  return res.items || [];
};

const BundleBarcodeTab = () => {
  const toast = useToastContext();
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [generatingId, setGeneratingId] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState([]);
  const [labelSize, setLabelSize] = useState('40x30');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/api/bundles', { page, limit: 25 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { load(); }, [load]);

  const bundles = data.data;
  const allSelected = bundles.length > 0 && bundles.every((b) => selected.has(b.id));

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (bundles.every((b) => prev.has(b.id))) return new Set();
      return new Set(bundles.map((b) => b.id));
    });
  };

  const generateFor = async (bundle) => {
    setGeneratingId(bundle.id);
    try {
      const res = await api.get('/api/bundles/barcode/generate');
      await api.put(`/api/bundles/${bundle.id}`, { barcode: res.barcode });
      toast.success(`Barcode ${res.barcode} disimpan`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGeneratingId(null);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Barcode disalin');
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  const openPrint = async (ids) => {
    const targetIds = ids || [...selected];
    if (targetIds.length === 0) return toast.warning('Pilih paket terlebih dahulu');
    setBusy(true);
    try {
      const items = await fetchLabels(targetIds);
      const withSvg = items.filter((i) => i.svg);
      if (withSvg.length === 0) {
        toast.warning('Tidak ada barcode yang bisa dicetak');
        return;
      }
      setPrintItems(withSvg);
      setPrintOpen(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doPrint = () => {
    window.print();
  };

  const columns = [
    {
      key: 'select',
      align: 'center',
      label: (
        <input
          type="checkbox"
          className="accent-ios-blue"
          checked={allSelected}
          onChange={toggleAll}
          aria-label="Pilih semua"
        />
      ),
    },
    { key: 'name', label: 'Nama Paket' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'price', label: 'Harga', align: 'right' },
    { key: 'actions', label: 'Aksi', align: 'right' },
  ];

  const size = LABEL_SIZES.find((s) => s.key === labelSize) || LABEL_SIZES[0];

  return (
    <>
      <Card padded={false}>
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="text-sm text-slate-400">
              {selected.size > 0 ? `${selected.size} paket dipilih` : 'Pilih paket untuk mencetak label'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-400 flex items-center gap-2">
                Ukuran label
                <select
                  value={labelSize}
                  onChange={(e) => setLabelSize(e.target.value)}
                  className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-2 py-1.5 text-xs text-white focus:outline-none focus:border-ios-blue/60"
                >
                  {LABEL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <Button onClick={() => openPrint()} disabled={busy || selected.size === 0}>
                <Printer size={16} /> Cetak Label Terpilih
              </Button>
            </div>
          </div>

          <Table columns={columns} loading={loading} empty="Belum ada paket">
            {bundles.map((bundle) => (
              <tr key={bundle.id} className="hover:bg-white/5">
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    className="accent-ios-blue"
                    checked={selected.has(bundle.id)}
                    onChange={() => toggleOne(bundle.id)}
                    aria-label={`Pilih ${bundle.name}`}
                  />
                </td>
                <td className="px-4 py-2 text-white">{bundle.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">{bundle.sku}</td>
                <td className="px-4 py-2">
                  {bundle.barcode ? (
                    <div className="flex items-center gap-2">
                      <Badge tone="blue">{bundle.barcode}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => copyCode(bundle.barcode)} title="Salin barcode">
                        <Copy size={13} />
                      </Button>
                    </div>
                  ) : (
                    <Badge tone="orange">Belum ada</Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-ios-green">{formatCurrency(bundle.price)}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    {bundle.barcode ? (
                      <Button variant="ghost" size="sm" onClick={() => openPrint([bundle.id])} disabled={busy}>
                        <Printer size={14} />
                      </Button>
                    ) : (
                      <Button
                        variant="neutral"
                        size="sm"
                        onClick={() => generateFor(bundle)}
                        disabled={generatingId === bundle.id}
                      >
                        {generatingId === bundle.id ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        Generate
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

      {printOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="no-print flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <span className="text-white font-medium">Pratinjau Label ({printItems.length})</span>
              <select
                value={labelSize}
                onChange={(e) => setLabelSize(e.target.value)}
                className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-2 py-1.5 text-xs text-white focus:outline-none focus:border-ios-blue/60"
              >
                {LABEL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="neutral" onClick={() => setPrintOpen(false)}>Tutup</Button>
              <Button onClick={doPrint}><Printer size={16} /> Cetak</Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 bg-white">
            <div
              id="barcode-print-area"
              className="flex flex-wrap gap-2"
            >
              {printItems.map((item) => (
                <div
                  key={item.id}
                  className="barcode-label"
                  style={{ width: size.width, height: size.height }}
                >
                  <div className="barcode-label-name">{item.name}</div>
                  <div
                    className="barcode-label-svg"
                    // SVG berasal dari backend kami sendiri (bwip-js), bukan input pengguna.
                    dangerouslySetInnerHTML={{ __html: item.svg }}
                  />
                  <div className="barcode-label-code">{item.code}</div>
                  <div className="barcode-label-price">{formatCurrency(item.price)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BundleBarcodeTab;

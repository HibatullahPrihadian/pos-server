import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { api, downloadFile } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import BarcodeScannerModal from '../components/scanner/BarcodeScannerModal';
import CameraScanButton from '../components/scanner/CameraScanButton';
import useDebounce from '../hooks/useDebounce';
import { resolveBarcode } from '../utils/barcode';

const EMPTY = { sku: '', barcode: '', name: '', category_id: '', supplier_id: '', base_unit: 'pcs', cost_price: '', sell_price: '', member_price: '', min_stock: '', is_active: true, is_consignment: false, consignor_id: '' };

const Products = () => {
  const toast = useToastContext();
  const { can } = useAuth();
  const canManage = can('product.manage');
  const canManageConsignment = can('consignment.manage');
  const [data, setData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [consignors, setConsignors] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);

  const [unitsProduct, setUnitsProduct] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitForm, setUnitForm] = useState({ unit_name: '', conversion_factor: '', sell_price: '', member_price: '', barcode: '' });

  const [barcodesProduct, setBarcodesProduct] = useState(null);
  const [barcodes, setBarcodes] = useState([]);
  const [barcodesUnits, setBarcodesUnits] = useState([]);
  const [barcodeForm, setBarcodeForm] = useState({ barcode: '', unit_id: '' });

  const [tiersProduct, setTiersProduct] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [tiersUnits, setTiersUnits] = useState([]);
  const [tierForm, setTierForm] = useState({ unit_id: '', min_qty: '', price: '' });

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);

  const debouncedSearch = useDebounce(search, 350);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/products', {
        page,
        limit: 25,
        search: debouncedSearch,
        category_id: categoryFilter,
      });
      setData(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, categoryFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/api/categories').then(setCategories).catch(() => {});
    api.get('/api/suppliers').then(setSuppliers).catch(() => {});
  }, []);

  // Data penitip butuh `consignment.manage`; hanya diambil bila user punya izin.
  useEffect(() => {
    if (!canManageConsignment) return;
    api.get('/api/consignment/consignors', { limit: 200 })
      .then((r) => setConsignors(r.data || []))
      .catch(() => {});
  }, [canManageConsignment]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (product) => {
    setEditing(product);
    setForm({
      sku: product.sku,
      barcode: product.barcode || '',
      name: product.name,
      category_id: product.category_id || '',
      supplier_id: product.supplier_id || '',
      base_unit: product.base_unit,
      cost_price: product.cost_price,
      sell_price: product.sell_price,
      member_price: product.member_price ?? '',
      min_stock: product.min_stock,
      is_active: product.is_active,
      is_consignment: Boolean(product.is_consignment),
      consignor_id: product.consignor_id || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        category_id: form.category_id || null,
        supplier_id: form.supplier_id || null,
        member_price: form.member_price === '' ? null : form.member_price,
        barcode: form.barcode || null,
        consignor_id: form.is_consignment ? (form.consignor_id || null) : null,
      };
      if (editing) {
        await api.put(`/api/products/${editing.id}`, payload);
        toast.success('Produk diperbarui');
      } else {
        await api.post('/api/products', payload);
        toast.success('Produk ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.del(`/api/products/${confirm.id}`);
      toast.success('Produk dinonaktifkan');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Hasil kamera: isi field barcode, lalu cek apakah sudah dipakai produk lain.
  const handleCameraScan = async (code) => {
    const trimmed = String(code || '').trim();
    setForm((f) => ({ ...f, barcode: trimmed }));
    setScanOpen(false);
    try {
      const { product } = await resolveBarcode(trimmed);
      if (product && product.id !== editing?.id) {
        toast.error(`Barcode sudah dipakai: ${product.name}`);
      }
    } catch {
      // 404 = barcode baru (jalur normal); error jaringan tidak memblokir pengisian.
    }
  };

  const openUnits = async (product) => {
    setUnitsProduct(product);
    try {
      setUnits(await api.get(`/api/products/${product.id}/units`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addUnit = async () => {
    try {
      await api.post(`/api/products/${unitsProduct.id}/units`, unitForm);
      toast.success('Satuan ditambahkan');
      setUnitForm({ unit_name: '', conversion_factor: '', sell_price: '', member_price: '', barcode: '' });
      setUnits(await api.get(`/api/products/${unitsProduct.id}/units`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteUnit = async (unitId) => {
    try {
      await api.del(`/api/products/${unitsProduct.id}/units/${unitId}`);
      toast.success('Satuan dihapus');
      setUnits(await api.get(`/api/products/${unitsProduct.id}/units`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openBarcodes = async (product) => {
    setBarcodesProduct(product);
    setBarcodeForm({ barcode: '', unit_id: '' });
    try {
      setBarcodes(await api.get(`/api/products/${product.id}/barcodes`));
      setBarcodesUnits(await api.get(`/api/products/${product.id}/units`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addBarcode = async () => {
    try {
      await api.post(`/api/products/${barcodesProduct.id}/barcodes`, {
        barcode: barcodeForm.barcode,
        unit_id: barcodeForm.unit_id || null,
      });
      toast.success('Barcode ditambahkan');
      setBarcodeForm({ barcode: '', unit_id: '' });
      setBarcodes(await api.get(`/api/products/${barcodesProduct.id}/barcodes`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteBarcode = async (barcodeId) => {
    try {
      await api.del(`/api/products/${barcodesProduct.id}/barcodes/${barcodeId}`);
      setBarcodes(await api.get(`/api/products/${barcodesProduct.id}/barcodes`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openTiers = async (product) => {
    setTiersProduct(product);
    setTierForm({ unit_id: '', min_qty: '', price: '' });
    try {
      setTiers(await api.get(`/api/products/${product.id}/tiers`));
      setTiersUnits(await api.get(`/api/products/${product.id}/units`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addTier = async () => {
    try {
      await api.post(`/api/products/${tiersProduct.id}/tiers`, {
        unit_id: tierForm.unit_id || null,
        min_qty: tierForm.min_qty,
        price: tierForm.price,
      });
      toast.success('Tier disimpan');
      setTierForm({ unit_id: '', min_qty: '', price: '' });
      setTiers(await api.get(`/api/products/${tiersProduct.id}/tiers`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteTier = async (tierId) => {
    try {
      await api.del(`/api/products/${tiersProduct.id}/tiers/${tierId}`);
      setTiers(await api.get(`/api/products/${tiersProduct.id}/tiers`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleImport = async () => {
    try {
      const result = await api.post('/api/products/import', { csv: importText });
      setImportResult(result);
      toast.success(`${result.imported} produk diimpor, ${result.failed} gagal`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Nama' },
    { key: 'category', label: 'Kategori' },
    { key: 'price', label: 'Harga Jual', align: 'right' },
    { key: 'stock', label: 'Stok', align: 'right' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'actions', label: '', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Produk"
        subtitle="Kelola master produk, harga, stok minimum, dan satuan"
        actions={
          <>
            {canManage && (
              <Button variant="neutral" onClick={() => { setImportOpen(true); setImportResult(null); setImportText(''); }}>
                Impor CSV
              </Button>
            )}
            <Button variant="neutral" onClick={() => downloadFile('/api/products/export', 'produk.csv')}>
              Ekspor CSV
            </Button>
            {canManage && (
              <Button onClick={openCreate}>
                <Plus size={16} /> Produk Baru
              </Button>
            )}
          </>
        }
      />

      <Card padded={false}>
        <div className="p-4 flex flex-wrap gap-3 border-b border-white/10">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60"
              placeholder="Cari nama / SKU / barcode..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          >
            <option value="">Semua Kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="p-4">
          <Table columns={columns} loading={loading} empty="Belum ada produk">
            {data.data.map((product) => (
              <tr key={product.id} className="hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{product.sku}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {product.image_path ? (
                      <img src={product.image_path} alt="" className="w-9 h-9 rounded object-cover border border-white/10" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-white/5 border border-white/10" />
                    )}
                    <div>
                      <div className="text-white flex items-center gap-2">
                        {product.name}
                        {product.is_consignment && <Badge tone="purple">Titipan</Badge>}
                      </div>
                      {product.barcode && <div className="text-xs text-slate-500">{product.barcode}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{product.category_name || '-'}</td>
                <td className="px-4 py-3 text-right text-white">
                  Rp {Number(product.sell_price).toLocaleString('id-ID')}
                  <div className="text-xs text-slate-500">/{product.base_unit}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={product.stock_qty <= product.min_stock ? 'text-ios-orange font-medium' : 'text-white'}>
                    {product.stock_qty}
                  </span>
                  <div className="text-xs text-slate-500">min {product.min_stock}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  {product.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {canManage && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openUnits(product)} title="Satuan">Satuan</Button>
                        <Button variant="ghost" size="sm" onClick={() => openBarcodes(product)} title="Barcode tambahan">Barcode</Button>
                        <Button variant="ghost" size="sm" onClick={() => openTiers(product)} title="Harga partai">Tier</Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(product)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirm(product)}><Trash2 size={14} className="text-ios-red" /></Button>
                      </>
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
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Ubah Produk' : 'Produk Baru'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label="SKU *" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <div className="flex gap-2 items-end">
            <Input label="Barcode" className="flex-1" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            <CameraScanButton onClick={() => setScanOpen(true)} label="Kamera" />
          </div>
          <Input label="Nama Produk *" className="col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input as="select" label="Kategori" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">- Pilih -</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Input>
          <Input as="select" label="Supplier" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">- Pilih -</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Input>
          <Input label="Satuan Dasar *" value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} />
          <Input label="Stok Minimum" type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
          <Input label="Harga Beli (HPP)" type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
          <Input label="Harga Jual *" type="number" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: e.target.value })} />
          <Input label="Harga Member" type="number" value={form.member_price} onChange={(e) => setForm({ ...form, member_price: e.target.value })} />
          <Input as="select" label="Status" value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
          </Input>
          {canManageConsignment && (
            <>
              <Input as="select" label="Barang Titipan (Konsinyasi)" value={form.is_consignment ? '1' : '0'} onChange={(e) => setForm({ ...form, is_consignment: e.target.value === '1', consignor_id: e.target.value === '1' ? form.consignor_id : '' })}>
                <option value="0">Bukan Konsinyasi</option>
                <option value="1">Konsinyasi</option>
              </Input>
              {form.is_consignment && (
                <Input as="select" label="Penitip" value={form.consignor_id} onChange={(e) => setForm({ ...form, consignor_id: e.target.value })}>
                  <option value="">- Pilih Penitip -</option>
                  {consignors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Input>
              )}
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">Semua harga dalam rupiah dan sudah termasuk PPN. Harga Beli (HPP) produk konsinyasi dipakai sebagai harga setor ke penitip.</p>
      </Modal>

      <BarcodeScannerModal
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={handleCameraScan}
      />

      <Modal isOpen={Boolean(unitsProduct)} onClose={() => setUnitsProduct(null)} title={`Satuan - ${unitsProduct?.name || ''}`}>
        <div className="space-y-3 mb-4">
          {units.length === 0 && <p className="text-sm text-slate-500">Belum ada satuan tambahan.</p>}
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-ios-sm">
              <div>
                <span className="text-white font-medium">1 {unit.unit_name}</span>
                <span className="text-slate-400"> = {unit.conversion_factor} {unitsProduct?.base_unit}</span>
                <div className="text-xs text-slate-500">Rp {Number(unit.sell_price).toLocaleString('id-ID')}{unit.barcode ? ` • ${unit.barcode}` : ''}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteUnit(unit.id)}><Trash2 size={14} className="text-ios-red" /></Button>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-medium text-white mb-3">Tambah Satuan</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nama Satuan" value={unitForm.unit_name} onChange={(e) => setUnitForm({ ...unitForm, unit_name: e.target.value })} placeholder="dus" />
            <Input label="Faktor Konversi" type="number" value={unitForm.conversion_factor} onChange={(e) => setUnitForm({ ...unitForm, conversion_factor: e.target.value })} placeholder="40" />
            <Input label="Harga Jual" type="number" value={unitForm.sell_price} onChange={(e) => setUnitForm({ ...unitForm, sell_price: e.target.value })} />
            <Input label="Barcode" value={unitForm.barcode} onChange={(e) => setUnitForm({ ...unitForm, barcode: e.target.value })} />
          </div>
          <Button className="mt-3" onClick={addUnit}><Plus size={16} /> Tambah</Button>
        </div>
      </Modal>

      <Modal isOpen={Boolean(barcodesProduct)} onClose={() => setBarcodesProduct(null)} title={`Barcode Tambahan - ${barcodesProduct?.name || ''}`}>
        <div className="space-y-2 mb-4">
          {barcodes.length === 0 && <p className="text-sm text-slate-500">Belum ada barcode tambahan.</p>}
          {barcodes.map((b) => (
            <div key={b.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-ios-sm">
              <div>
                <span className="text-white font-mono">{b.barcode}</span>
                {b.unit_name && <span className="text-slate-400 text-xs ml-2">({b.unit_name})</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteBarcode(b.id)}><Trash2 size={14} className="text-ios-red" /></Button>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-medium text-white mb-3">Tambah Barcode</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Barcode *" value={barcodeForm.barcode} onChange={(e) => setBarcodeForm({ ...barcodeForm, barcode: e.target.value })} />
            <Input as="select" label="Satuan (opsional)" value={barcodeForm.unit_id} onChange={(e) => setBarcodeForm({ ...barcodeForm, unit_id: e.target.value })}>
              <option value="">Satuan dasar</option>
              {barcodesUnits.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
            </Input>
          </div>
          <p className="text-xs text-slate-500 mt-2">Pilih satuan hanya bila barcode mewakili unit seperti dus/karton. Barcode harus unik di semua sumber.</p>
          <Button className="mt-3" onClick={addBarcode} disabled={!barcodeForm.barcode}><Plus size={16} /> Tambah</Button>
        </div>
      </Modal>

      <Modal isOpen={Boolean(tiersProduct)} onClose={() => setTiersProduct(null)} title={`Harga Partai Bertingkat - ${tiersProduct?.name || ''}`} size="lg">
        <div className="space-y-2 mb-4">
          {tiers.length === 0 && <p className="text-sm text-slate-500">Belum ada tier harga.</p>}
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-ios-sm">
              <div>
                <span className="text-white">Min {t.min_qty} {t.unit_name || tiersProduct?.base_unit}</span>
                <span className="text-ios-green ml-3">Rp {Number(t.price).toLocaleString('id-ID')}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteTier(t.id)}><Trash2 size={14} className="text-ios-red" /></Button>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-medium text-white mb-3">Tambah / Ubah Tier</p>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Min Qty *" type="number" value={tierForm.min_qty} onChange={(e) => setTierForm({ ...tierForm, min_qty: e.target.value })} placeholder="mis. 12" />
            <Input label="Harga per Unit (Rp) *" type="number" value={tierForm.price} onChange={(e) => setTierForm({ ...tierForm, price: e.target.value })} />
            <Input as="select" label="Satuan" value={tierForm.unit_id} onChange={(e) => setTierForm({ ...tierForm, unit_id: e.target.value })}>
              <option value="">{tiersProduct?.base_unit || 'Satuan dasar'}</option>
              {tiersUnits.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
            </Input>
          </div>
          <Button className="mt-3" onClick={addTier} disabled={!tierForm.min_qty || !tierForm.price}><Plus size={16} /> Simpan Tier</Button>
        </div>
      </Modal>

      <Modal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        title="Impor Produk (CSV)"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setImportOpen(false)}>Tutup</Button>
            <Button onClick={handleImport} disabled={!importText.trim()}>Impor</Button>
          </div>
        }
      >
        <p className="text-sm text-slate-400 mb-3">
          Header kolom: <code className="text-ios-blue">sku, barcode, name, category, supplier, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty</code>.
          Kategori/supplier baru dibuat otomatis. SKU yang sudah ada akan diperbarui.
        </p>
        <textarea
          className="w-full h-56 bg-slate-950/60 border border-white/10 rounded-ios-sm p-3 text-xs font-mono text-white focus:outline-none focus:border-ios-blue/60"
          placeholder={'sku,barcode,name,category,supplier,base_unit,cost_price,sell_price,min_stock,stock_qty\nSKU-100,123456,Kopi Sachet,Minuman,PT Sumber Pangan,pcs,1200,2000,10,100'}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        {importResult && (
          <div className="mt-3 p-3 rounded-ios-sm bg-white/5 text-sm">
            <p className="text-ios-green">{importResult.imported} berhasil</p>
            {importResult.failed > 0 && (
              <div className="mt-2 text-ios-red">
                <p>{importResult.failed} gagal:</p>
                <ul className="list-disc list-inside text-xs mt-1">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>Baris {err.line}: {err.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={handleDelete}
        title="Nonaktifkan Produk"
        message={`Nonaktifkan produk "${confirm?.name}"? Produk tidak akan muncul di kasir, tetapi riwayat transaksi tetap tersimpan.`}
        confirmLabel="Nonaktifkan"
      />
    </div>
  );
};

export default Products;

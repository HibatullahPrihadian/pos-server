import { useState, useEffect } from 'react';
import { Save, Upload, QrCode } from 'lucide-react';
import { api } from '../api/client';
import { useToastContext } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import { useBusiness } from '../context/BusinessContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';

const Settings = () => {
  const toast = useToastContext();
  const { settings, setSettings, reload } = useSettings();
  const { business } = useBusiness();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name,
        address: settings.address,
        phone: settings.phone,
        npwp: settings.npwp,
        tax_rate: settings.tax_rate,
        tax_included: settings.tax_included,
        invoice_prefix: settings.invoice_prefix,
        receipt_footer: settings.receipt_footer,
        point_earn_per_amount: settings.point_earn_per_amount,
        point_value_rupiah: settings.point_value_rupiah,
        point_min_redeem: settings.point_min_redeem,
        low_stock_default: settings.low_stock_default,
        allow_negative_stock: settings.allow_negative_stock,
        expiry_warning_days: settings.expiry_warning_days ?? 180,
      });
    }
  }, [settings]);

  if (!form) return <Spinner label="Memuat pengaturan..." />;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.put('/api/settings', form);
      setSettings(updated);
      toast.success('Pengaturan disimpan');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadQris = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Tipe file harus gambar (jpg, png, webp, gif)');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 5MB');
      event.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      await api.upload('/api/settings/qris-image', formData);
      toast.success('Gambar QRIS diunggah');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div>
      <PageHeader
        title="Pengaturan"
        subtitle="Identitas toko, pajak, struk, QRIS, dan aturan poin"
        actions={<Button onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</Button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Identitas Toko">
          <div className="space-y-4">
            <Input label="Nama Toko *" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} />
            <Input as="textarea" label="Alamat" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="NPWP" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} />
          </div>
        </Card>

        <Card title="Pajak & Invoice">
          <div className="space-y-4">
            <Input label="Tarif PPN (%)" type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} />
            <Input as="select" label="Mode Pajak" value={form.tax_included ? '1' : '0'} onChange={(e) => setForm({ ...form, tax_included: e.target.value === '1' })}>
              <option value="1">Harga sudah termasuk PPN</option>
              <option value="0">PPN ditambahkan di atas harga</option>
            </Input>
            <Input label="Prefix Invoice" value={form.invoice_prefix} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value.toUpperCase() })} />
            <Input as="textarea" label="Footer Struk" value={form.receipt_footer} onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })} />
          </div>
        </Card>

        {/* Poin/stok hanya berlaku untuk minimarket; mode lain memakai setelan usaha. */}
        {business === 'minimarket' && (
        <Card title="Poin Member">
          <div className="space-y-4">
            <Input label="Rupiah per 1 Poin (earning)" type="number" value={form.point_earn_per_amount} onChange={(e) => setForm({ ...form, point_earn_per_amount: e.target.value })} />
            <Input label="Nilai 1 Poin (rupiah saat tukar)" type="number" value={form.point_value_rupiah} onChange={(e) => setForm({ ...form, point_value_rupiah: e.target.value })} />
            <Input label="Minimal Poin untuk Tukar" type="number" value={form.point_min_redeem} onChange={(e) => setForm({ ...form, point_min_redeem: e.target.value })} />
            <Input label="Stok Minimum Default" type="number" value={form.low_stock_default} onChange={(e) => setForm({ ...form, low_stock_default: e.target.value })} />
            <Input
              label="Ambang Peringatan Kadaluarsa (hari)"
              type="number"
              value={form.expiry_warning_days}
              onChange={(e) => setForm({ ...form, expiry_warning_days: e.target.value })}
            />
            <p className="text-xs text-slate-400 -mt-2">Batch dengan kadaluarsa ≤ ambang ini muncul di dashboard (default 180 hari).</p>
            <Input as="select" label="Izinkan Stok Negatif" value={form.allow_negative_stock ? '1' : '0'} onChange={(e) => setForm({ ...form, allow_negative_stock: e.target.value === '1' })}>
              <option value="0">Tidak (disarankan)</option>
              <option value="1">Ya</option>
            </Input>
          </div>
        </Card>
        )}

        <Card title="QRIS Toko (Statis)">
          <div className="space-y-4">
            {settings?.qris_image_path ? (
              <img src={settings.qris_image_path} alt="QRIS" className="w-56 h-56 object-contain bg-white rounded-ios-sm border border-white/10 p-2" />
            ) : (
              <div className="w-56 h-56 flex flex-col items-center justify-center bg-white/5 rounded-ios-sm border border-dashed border-white/20 text-slate-400">
                <QrCode size={40} />
                <span className="text-xs mt-2">Belum ada gambar QRIS</span>
              </div>
            )}
            <label className="inline-flex">
              <input type="file" accept="image/*" className="hidden" onChange={uploadQris} disabled={uploading} />
              <span className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-ios-sm bg-white/10 hover:bg-white/15 text-white cursor-pointer border border-white/10">
                <Upload size={16} /> {uploading ? 'Mengunggah...' : 'Unggah QRIS'}
              </span>
            </label>
            <p className="text-xs text-slate-400">Gambar ini ditampilkan di layar kasir saat pembayaran QRIS.</p>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Settings;

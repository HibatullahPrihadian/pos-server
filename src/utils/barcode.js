import { api } from '../api/client';

/**
 * Resolusi satu kode barcode menjadi produk (dengan `units` dan `matched_unit`).
 *
 * Semua halaman (POS, Produk, Pembelian, Stok) memakai jalur ini agar perilaku
 * identik: kode di-trim, dan hasilnya dinormalkan sehingga pemanggil tidak perlu
 * menebak bentuk respons. Melempar error dari `api.get` bila barcode tidak ada
 * (mis. 404) supaya pemanggil bisa memberi pesan atau fallback sendiri.
 */
export const resolveBarcode = async (rawCode) => {
  const code = String(rawCode || '').trim();
  if (!code) throw new Error('Barcode kosong');

  const result = await api.get(`/api/products/barcode/${encodeURIComponent(code)}`);
  return {
    code,
    product: result?.product || null,
    units: Array.isArray(result?.units) ? result.units : [],
    matchedUnit: result?.matched_unit || null,
  };
};

export default resolveBarcode;

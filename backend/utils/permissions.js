// Sumber kebenaran daftar izin granular. Dipakai backend untuk otorisasi dan
// diekspos ke frontend lewat GET /api/users/permissions agar UI memakai daftar
// yang sama (tidak ada import lintas folder backend/frontend).
//
// Semantik:
// - `users.permissions` NULL -> pakai preset role.
// - `users.permissions` array -> izin eksplisit (diiris dengan daftar kunci).
// - role admin SELALU punya semua izin (bypass) agar tidak bisa terkunci.

const PERMISSIONS = [
  'pos.use',
  'shift.use',
  'attendance.self',
  'product.view',
  'product.manage',
  'stock.view',
  'stock.manage',
  'purchase.view',
  'purchase.manage',
  'purchase.pay',
  'supplier.manage',
  'consignment.manage',
  'bundle.manage',
  'promotion.manage',
  'member.manage',
  'customer.manage',
  'invoice.view',
  'invoice.manage',
  'expense.manage',
  'print.use',
  'print.manage',
  'print.report',
  'report.view',
  'user.manage',
  'settings.manage',
];

// Label manusiawi untuk UI (dipakai GET /users/permissions).
const PERMISSION_LABELS = {
  'pos.use': 'Kasir / POS',
  'shift.use': 'Buka & tutup shift sendiri',
  'attendance.self': 'Absen sendiri',
  'product.view': 'Lihat produk',
  'product.manage': 'Kelola produk',
  'stock.view': 'Lihat stok',
  'stock.manage': 'Kelola stok & opname',
  'purchase.view': 'Lihat pembelian',
  'purchase.manage': 'Kelola pembelian & terima barang',
  'purchase.pay': 'Bayar ke supplier',
  'supplier.manage': 'Kelola supplier & kategori',
  'consignment.manage': 'Kelola konsinyasi',
  'bundle.manage': 'Kelola paket',
  'promotion.manage': 'Kelola promo',
  'member.manage': 'Kelola member',
  'customer.manage': 'Kelola pelanggan grosir',
  'invoice.view': 'Lihat piutang & invoice grosir',
  'invoice.manage': 'Terbitkan invoice kredit & catat pembayaran',
  'expense.manage': 'Kelola beban operasional',
  'print.use': 'Buat & proses pesanan fotokopi',
  'print.manage': 'Kelola master jasa fotokopi',
  'print.report': 'Lihat laporan fotokopi',
  'report.view': 'Lihat laporan',
  'user.manage': 'Kelola pengguna',
  'settings.manage': 'Kelola pengaturan',
};

const ROLE_PRESETS = {
  admin: [...PERMISSIONS],
  kasir: [
    'pos.use',
    'shift.use',
    'attendance.self',
    'product.view',
    'stock.view',
    'member.manage',
    // Kasir boleh MELIHAT piutang, tapi tidak boleh menerbitkan kredit/mencatat
    // pembayaran (invoice.manage) — keputusan pemilik/admin.
    'invoice.view',
    // Mode fotokopi: kasir merangkap operator (buat/proses pesanan), bukan admin jasa.
    'print.use',
  ],
  // Gudang: boleh jualan di POS (pos.use/shift.use), kelola produk & stok,
  // buat/terima PO. TIDAK boleh bayar ke supplier, kelola supplier/konsinyasi/
  // paket/promo/beban, laporan, pengguna, atau pengaturan.
  gudang: [
    'pos.use',
    'shift.use',
    'attendance.self',
    'product.view',
    'product.manage',
    'stock.view',
    'stock.manage',
    'purchase.view',
    'purchase.manage',
  ],
  // Operator fotokopi: hanya modul fotokopi + shift & absensi. Tidak bisa
  // menyentuh POS/stok/inventori minimarket.
  operator: [
    'print.use',
    'print.report',
    'report.view',
    'attendance.self',
    'shift.use',
  ],
};

const PERMISSION_SET = new Set(PERMISSIONS);
const VALID_ROLES = new Set(Object.keys(ROLE_PRESETS));

// Buang nilai tak dikenal, non-string, dan duplikat. Non-array -> null (preset).
const sanitizePermissions = (input) => {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const key of input) {
    if (typeof key === 'string' && PERMISSION_SET.has(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
};

// Izin efektif seorang user dalam bentuk array kunci.
const resolvePermissions = (user) => {
  if (!user) return [];
  if (user.role === 'admin' || user.is_admin === true) return [...PERMISSIONS];
  if (Array.isArray(user.permissions)) {
    return user.permissions.filter((key) => PERMISSION_SET.has(key));
  }
  return [...(ROLE_PRESETS[user.role] || [])];
};

const hasPermission = (user, key) => resolvePermissions(user).includes(key);

module.exports = {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_PRESETS,
  VALID_ROLES,
  sanitizePermissions,
  resolvePermissions,
  hasPermission,
};

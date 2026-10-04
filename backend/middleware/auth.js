const jwt = require('jsonwebtoken');
const pool = require('../db');
const { hasPermission } = require('../utils/permissions');

// Nilai contoh yang ikut ter-commit; tidak boleh dipakai di runtime.
const PLACEHOLDER_SECRETS = new Set([
  'ganti-dengan-string-acak-panjang',
  'dev-secret-change-me',
  'changeme',
]);

// Tidak ada fallback: JWT_SECRET wajib diisi dan bukan nilai contoh, agar token
// tidak dapat dipalsukan dengan secret yang publik.
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16 || PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET wajib diisi (minimal 16 karakter) dan tidak boleh memakai nilai contoh. Set di .env sebelum menjalankan server.'
    );
  }
  return secret;
};

// Verifikasi JWT lalu muat user dari DB. Izin TIDAK ditaruh di token agar
// perubahan role/izin (atau penonaktifan akun) langsung berlaku tanpa login
// ulang. Bila user hilang atau nonaktif -> 401.
const verifyJwt = async (req, res, next) => {
  // Beberapa router memasang verifyJwt lagi setelah guard global /api. Bila
  // user sudah dimuat pada request ini, jangan query DB dua kali.
  if (req.user) return next();

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getSecret());
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, full_name, role, permissions, is_active FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Akun tidak ditemukan atau nonaktif' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      permissions: user.permissions,
      is_admin: user.role === 'admin',
    };
    return next();
  } catch (err) {
    return next(err);
  }
};

// Batasi endpoint ke role tertentu, mis. requireRole('admin').
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Belum terautentikasi' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Akses ditolak untuk role ini' });
  }
  return next();
};

// Batasi endpoint berdasarkan izin. Default: cukup salah satu kunci (OR).
// Pakai requirePermission.all(...) untuk menuntut SEMUA kunci (AND).
const requirePermission = (...keys) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Belum terautentikasi' });
  }
  if (!keys.some((key) => hasPermission(req.user, key))) {
    return res.status(403).json({ error: 'Akses ditolak: izin tidak mencukupi' });
  }
  return next();
};

requirePermission.all = (...keys) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Belum terautentikasi' });
  }
  if (!keys.every((key) => hasPermission(req.user, key))) {
    return res.status(403).json({ error: 'Akses ditolak: izin tidak mencukupi' });
  }
  return next();
};

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '12h' }
  );

// Dipanggil saat bootstrap agar konfigurasi salah terdeteksi lebih awal.
const assertJwtSecret = () => getSecret();

module.exports = { verifyJwt, requireRole, requirePermission, signToken, assertJwtSecret };

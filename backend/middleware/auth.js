const jwt = require('jsonwebtoken');

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

// Verifikasi JWT dan tempelkan payload ke req.user.
const verifyJwt = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
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

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '12h' }
  );

// Dipanggil saat bootstrap agar konfigurasi salah terdeteksi lebih awal.
const assertJwtSecret = () => getSecret();

module.exports = { verifyJwt, requireRole, signToken, assertJwtSecret };

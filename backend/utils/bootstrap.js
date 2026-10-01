const bcrypt = require('bcryptjs');
const pool = require('../db');

// Membuat akun awal tanpa pernah menanam password default yang diketahui publik.
// - Bila ADMIN_PASSWORD / KASIR_PASSWORD diisi, password itu dipakai.
// - Bila tidak, password acak dibuat dan dicetak SEKALI ke log server.
// Akun hanya dibuat bila belum ada, sehingga aman dijalankan berulang.
const randomPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

const ensureUser = async ({ username, fullName, role, envPassword, generated }) => {
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows[0]) return null;

  let password = envPassword;
  let isGenerated = false;
  if (!password) {
    password = randomPassword();
    isGenerated = true;
  }
  if (password.length < 8) {
    throw new Error(`Password untuk ${username} minimal 8 karakter`);
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, fullName, hash, role]
  );

  // Bila balapan dengan proses lain, tidak ada baris yang dibuat.
  if (!result.rows[0]) return null;

  // Password hanya dilaporkan setelah akun benar-benar dibuat.
  if (isGenerated) generated.push({ username, password });
  return username;
};

// Dipanggil saat bootstrap server. Mengulang beberapa kali agar tidak gagal
// hanya karena database belum siap menerima koneksi.
const ensureInitialUsers = async (attempts = 10) => {
  const generated = [];
  const created = [];

  const createAll = async () => {
    const admin = await ensureUser({
      username: process.env.ADMIN_USERNAME || 'admin',
      fullName: process.env.ADMIN_FULL_NAME || 'Administrator',
      role: 'admin',
      envPassword: process.env.ADMIN_PASSWORD,
      generated,
    });
    if (admin) created.push(admin);

    const kasir = await ensureUser({
      username: process.env.KASIR_USERNAME || 'kasir',
      fullName: process.env.KASIR_FULL_NAME || 'Kasir Satu',
      role: 'kasir',
      envPassword: process.env.KASIR_PASSWORD,
      generated,
    });
    if (kasir) created.push(kasir);
  };

  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await createAll();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  if (lastError) throw lastError;

  if (created.length > 0) {
    console.log(`Akun awal dibuat: ${created.join(', ')}`);
  }
  generated.forEach(({ username, password }) => {
    console.warn(
      `[PENTING] Password acak untuk '${username}': ${password} — catat sekarang dan segera ubah setelah login.`
    );
  });

  return { created, generated };
};

module.exports = { ensureInitialUsers };

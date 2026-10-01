const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { signToken, verifyJwt } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString } = require('../utils/validate');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const username = requireString(req.body?.username, 'Username', 50);
    if (username.error) throw new HttpError(400, username.error);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) throw new HttpError(400, 'Password wajib diisi');

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.value]);
    const user = result.rows[0];
    if (!user || !user.is_active) {
      throw new HttpError(401, 'Username atau password salah');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new HttpError(401, 'Username atau password salah');

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', verifyJwt, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', verifyJwt, async (req, res, next) => {
  try {
    const oldPassword = typeof req.body?.old_password === 'string' ? req.body.old_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (newPassword.length < 6) throw new HttpError(400, 'Password baru minimal 6 karakter');

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    const ok = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
    if (!ok) throw new HttpError(400, 'Password lama salah');

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password berhasil diubah' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

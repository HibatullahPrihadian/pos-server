const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(requireRole('admin'));

const PUBLIC_FIELDS = 'id, username, full_name, role, is_active, created_at';

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY id`);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const username = requireString(req.body?.username, 'Username', 50);
    if (username.error) throw new HttpError(400, username.error);
    const fullName = requireString(req.body?.full_name, 'Nama lengkap', 100);
    if (fullName.error) throw new HttpError(400, fullName.error);

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter');

    const role = req.body?.role === 'admin' ? 'admin' : 'kasir';
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_FIELDS}`,
      [username.value, fullName.value, hash, role]
    );
    await logAudit(pool, {
      userId: req.user.id,
      action: 'create',
      entity: 'users',
      entityId: result.rows[0].id,
      detail: { username: username.value, role },
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const fullName = requireString(req.body?.full_name, 'Nama lengkap', 100);
    if (fullName.error) throw new HttpError(400, fullName.error);

    const role = req.body?.role === 'admin' ? 'admin' : 'kasir';
    const isActive = toBool(req.body?.is_active, true);

    const fields = [fullName.value, role, isActive];
    let query = 'UPDATE users SET full_name = $1, role = $2, is_active = $3';

    if (typeof req.body?.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
      const hash = await bcrypt.hash(req.body.password, 10);
      fields.push(hash);
      query += `, password_hash = $${fields.length}`;
    }

    fields.push(req.params.id);
    query += ` WHERE id = $${fields.length} RETURNING ${PUBLIC_FIELDS}`;

    const result = await pool.query(query, fields);
    if (!result.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'users',
      entityId: Number(req.params.id),
    });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/deactivate', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      throw new HttpError(400, 'Tidak dapat menonaktifkan akun sendiri');
    }
    const result = await pool.query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING ${PUBLIC_FIELDS}`,
      [req.params.id]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    await logAudit(pool, {
      userId: req.user.id,
      action: 'deactivate',
      entity: 'users',
      entityId: Number(req.params.id),
    });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

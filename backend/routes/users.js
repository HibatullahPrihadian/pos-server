const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { withTransaction } = require('../db');
const { requirePermission, BUSINESSES } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { requireString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');
const {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_PRESETS,
  VALID_ROLES,
  sanitizePermissions,
  resolvePermissions,
} = require('../utils/permissions');

const router = express.Router();

router.use(requirePermission('user.manage'));

const PUBLIC_FIELDS = 'id, username, full_name, role, is_active, permissions, business, created_at';

const normalizeRole = (value) => (VALID_ROLES.has(value) ? value : null);

// Usaha yang boleh ditetapkan: null = lintas usaha (owner/admin), atau satu
// usaha aktif. `undefined` berarti field tidak dikirim (tidak diubah).
const normalizeBusiness = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (BUSINESSES.includes(value)) return value;
  throw new HttpError(400, 'Usaha tidak valid');
};

// Daftar izin + preset untuk membangun UI checkbox di halaman Pengguna.
router.get('/permissions', (_req, res) => {
  res.json({
    permissions: PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] || key })),
    presets: ROLE_PRESETS,
    roles: [...VALID_ROLES],
  });
});

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY id`);
    const rows = result.rows.map((row) => ({
      ...row,
      resolved_permissions: resolvePermissions(row),
    }));
    res.json(rows);
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

    const role = normalizeRole(req.body?.role);
    if (!role) throw new HttpError(400, 'Role tidak valid');
    // Hanya admin sungguhan yang boleh membuat/mengangkat admin, agar pemberian
    // `user.manage` ke non-admin tidak menjadi jalan eskalasi hak akses.
    if (role === 'admin' && !req.user.is_admin) {
      throw new HttpError(403, 'Hanya administrator yang dapat membuat akun admin');
    }
    const permissions = sanitizePermissions(req.body?.permissions);
    const business = normalizeBusiness(req.body?.business) ?? null;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role, permissions, business)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_FIELDS}`,
      [username.value, fullName.value, hash, role, permissions ? JSON.stringify(permissions) : null, business]
    );
    await logAudit(pool, {
      userId: req.user.id,
      action: 'create',
      entity: 'users',
      entityId: result.rows[0].id,
      detail: { username: username.value, role },
    });
    res.status(201).json({
      ...result.rows[0],
      resolved_permissions: resolvePermissions(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    const fullName = requireString(req.body?.full_name, 'Nama lengkap', 100);
    if (fullName.error) throw new HttpError(400, fullName.error);

    let role = normalizeRole(req.body?.role);
    if (!role) throw new HttpError(400, 'Role tidak valid');

    const existing = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    // Hanya admin sungguhan yang boleh mengangkat/menurunkan peran admin.
    if ((role === 'admin' || existing.rows[0].role === 'admin') && !req.user.is_admin) {
      throw new HttpError(403, 'Hanya administrator yang dapat mengubah peran admin');
    }

    const isActive = toBool(req.body?.is_active, true);

    // Cegah admin mengunci dirinya sendiri: bila mengubah akun sendiri yang
    // SEDANG admin, role tetap admin dan akun tetap aktif. Jangan pernah
    // menaikkan role user non-admin ke admin di sini (itu eskalasi hak akses).
    const isSelf = targetId === req.user.id;
    const wasAdmin = existing.rows[0].role === 'admin';
    if (isSelf && wasAdmin) {
      role = 'admin';
    }
    const finalActive = isSelf ? true : isActive;

    // permissions: undefined -> jangan ubah; null -> pakai preset role; array -> eksplisit.
    const hasPermissionsField = Object.prototype.hasOwnProperty.call(req.body || {}, 'permissions');
    const permissions = hasPermissionsField ? sanitizePermissions(req.body.permissions) : undefined;

    // business: undefined -> tidak diubah; null -> lintas usaha; nilai -> terikat satu usaha.
    const hasBusinessField = Object.prototype.hasOwnProperty.call(req.body || {}, 'business');
    const business = hasBusinessField ? normalizeBusiness(req.body.business) : undefined;

    const fields = [fullName.value, role, finalActive];
    let query = 'UPDATE users SET full_name = $1, role = $2, is_active = $3';
    if (hasPermissionsField) {
      fields.push(permissions ? JSON.stringify(permissions) : null);
      query += `, permissions = $${fields.length}`;
    }
    if (hasBusinessField) {
      fields.push(business ?? null);
      query += `, business = $${fields.length}`;
    }

    if (typeof req.body?.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
      const hash = await bcrypt.hash(req.body.password, 10);
      fields.push(hash);
      query += `, password_hash = $${fields.length}`;
    }

    fields.push(req.params.id);
    query += ` WHERE id = $${fields.length} RETURNING ${PUBLIC_FIELDS}`;

    // Cek "admin terakhir" + UPDATE dalam satu transaksi dengan lock baris admin
    // agar dua permintaan bersamaan tidak sama-sama menurunkan admin terakhir.
    const demotingLastAdmin = wasAdmin && (role !== 'admin' || !finalActive);
    const result = await withTransaction(async (client) => {
      if (demotingLastAdmin) {
        await client.query("SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE FOR UPDATE");
      }
      const updated = await client.query(query, fields);
      if (!updated.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');
      if (demotingLastAdmin) {
        const others = await client.query(
          "SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = TRUE AND id <> $1",
          [targetId]
        );
        if (others.rows[0].n === 0) {
          throw new HttpError(400, 'Minimal harus ada satu administrator aktif');
        }
      }
      return updated;
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'users',
      entityId: targetId,
    });
    res.json({
      ...result.rows[0],
      resolved_permissions: resolvePermissions(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/deactivate', async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) {
      throw new HttpError(400, 'Tidak dapat menonaktifkan akun sendiri');
    }

    const target = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    // Hanya admin sungguhan yang boleh menonaktifkan admin lain.
    if (target.rows[0].role === 'admin' && !req.user.is_admin) {
      throw new HttpError(403, 'Hanya administrator yang dapat menonaktifkan akun admin');
    }

    const deactivatingAdmin = target.rows[0].role === 'admin';
    const result = await withTransaction(async (client) => {
      if (deactivatingAdmin) {
        await client.query("SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE FOR UPDATE");
      }
      const updated = await client.query(
        `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING ${PUBLIC_FIELDS}`,
        [req.params.id]
      );
      if (!updated.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');
      if (deactivatingAdmin) {
        const others = await client.query(
          "SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = TRUE AND id <> $1",
          [targetId]
        );
        if (others.rows[0].n === 0) {
          throw new HttpError(400, 'Minimal harus ada satu administrator aktif');
        }
      }
      return updated;
    });

    await logAudit(pool, {
      userId: req.user.id,
      action: 'deactivate',
      entity: 'users',
      entityId: targetId,
    });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

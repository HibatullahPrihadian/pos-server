const express = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated } = require('../utils/pagination');
const { requireString, cleanString, toBool } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Kode member berurutan: MBR-0001, MBR-0002, ...
const nextMemberCode = async (client) => {
  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)), 0) AS last FROM members WHERE code LIKE 'MBR-%'`
  );
  const next = Number(result.rows[0].last) + 1;
  return `MBR-${String(next).padStart(4, '0')}`;
};

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 25 });
    const search = cleanString(req.query.search, 100);
    const activeOnly = req.query.is_active === undefined ? true : toBool(req.query.is_active, true);

    // Member dipisah per usaha; tanpa header, default 'minimarket' = perilaku lama.
    const conditions = ['business = $1'];
    const params = [req.business];
    if (activeOnly) conditions.push('is_active = TRUE');
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(name) LIKE $${params.length} OR LOWER(code) LIKE $${params.length} OR COALESCE(phone, '') LIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM members ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM members ${where} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM members WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    if (!result.rows[0]) throw new HttpError(404, 'Member tidak ditemukan');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('member.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama member', 150);
    if (name.error) throw new HttpError(400, name.error);

    const phone = cleanString(req.body?.phone, 50);
    const email = cleanString(req.body?.email, 120);
    const code = cleanString(req.body?.code, 30) || (await nextMemberCode(pool));

    const result = await pool.query(
      'INSERT INTO members (code, name, phone, email, business) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [code, name.value, phone, email, req.business]
    );
    await logAudit(pool, { userId: req.user.id, action: 'create', entity: 'members', entityId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('member.manage'), async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, 'Nama member', 150);
    if (name.error) throw new HttpError(400, name.error);
    const isActive = toBool(req.body?.is_active, true);

    const result = await pool.query(
      'UPDATE members SET name = $1, phone = $2, email = $3, is_active = $4 WHERE id = $5 AND business = $6 RETURNING *',
      [name.value, cleanString(req.body?.phone, 50), cleanString(req.body?.email, 120), isActive, req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Member tidak ditemukan');
    await logAudit(pool, { userId: req.user.id, action: 'update', entity: 'members', entityId: Number(req.params.id) });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('member.manage'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE members SET is_active = FALSE WHERE id = $1 AND business = $2 RETURNING id',
      [req.params.id, req.business]
    );
    if (!result.rows[0]) throw new HttpError(404, 'Member tidak ditemukan');
    res.json({ message: 'Member dinonaktifkan' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/points', async (req, res, next) => {
  try {
    const member = await pool.query('SELECT id, code, name, points FROM members WHERE id = $1 AND business = $2', [req.params.id, req.business]);
    if (!member.rows[0]) throw new HttpError(404, 'Member tidak ditemukan');

    const logs = await pool.query(
      `SELECT * FROM member_point_logs WHERE member_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [req.params.id]
    );
    res.json({ ...member.rows[0], logs: logs.rows });
  } catch (err) {
    next(err);
  }
});

// Penyesuaian poin manual (admin). change boleh negatif, saldo tidak boleh minus.
router.post('/:id/points/adjust', requirePermission('member.manage'), async (req, res, next) => {
  try {
    const change = Math.round(Number(req.body?.change));
    if (!Number.isFinite(change) || change === 0) {
      throw new HttpError(400, 'Perubahan poin harus bilangan bulat bukan nol');
    }
    const note = cleanString(req.body?.note, 300);

    const result = await pool.query(
      `UPDATE members SET points = points + $1
       WHERE id = $2 AND business = $3 AND points + $1 >= 0
       RETURNING id, code, name, points`,
      [change, req.params.id, req.business]
    );
    if (!result.rows[0]) {
      throw new HttpError(400, 'Member tidak ditemukan atau saldo poin tidak mencukupi');
    }

    await pool.query(
      `INSERT INTO member_point_logs (member_id, change, balance_after, type, ref_type, note)
       VALUES ($1, $2, $3, 'adjust', 'manual', $4)`,
      [result.rows[0].id, change, result.rows[0].points, note]
    );
    await logAudit(pool, {
      userId: req.user.id,
      action: 'adjust_points',
      entity: 'members',
      entityId: Number(req.params.id),
      detail: { change },
    });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

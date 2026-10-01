const express = require('express');
const pool = require('../db');
const { withTransaction } = require('../db');
const { verifyJwt, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getPagination, paginated, toInt } = require('../utils/pagination');
const { cleanString, isValidDate } = require('../utils/validate');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.use(verifyJwt);

// PostgreSQL unique_violation.
const UNIQUE_VIOLATION = '23505';

const SELECT_ATTENDANCE = `
  SELECT a.*, u.full_name AS user_name, u.username
  FROM attendance a
  LEFT JOIN users u ON u.id = a.user_id
`;

// Shift terbuka milik user pada hari kerja (untuk tautan attendance.shift_id).
const findOpenShiftId = async (runner, userId) => {
  const result = await runner.query(
    'SELECT id FROM shifts WHERE user_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0]?.id || null;
};

// =========================================================
// Self: check-in / check-out / riwayat
// =========================================================
router.post('/check-in', async (req, res, next) => {
  try {
    const note = cleanString(req.body?.note, 300);
    const shiftId = toInt(req.body?.shift_id, 0) || null;

    const created = await withTransaction(async (client) => {
      const todayResult = await client.query('SELECT CURRENT_DATE AS today');
      const today = todayResult.rows[0].today;

      const existing = await client.query(
        'SELECT * FROM attendance WHERE user_id = $1 AND work_date = $2 FOR UPDATE',
        [req.user.id, today]
      );

      if (existing.rows[0]?.check_in) {
        throw new HttpError(400, 'Anda sudah absen masuk hari ini');
      }

      const linkedShiftId = shiftId || (await findOpenShiftId(client, req.user.id));

      try {
        if (existing.rows[0]) {
          const updated = await client.query(
            `UPDATE attendance SET check_in = NOW(), note = COALESCE($1, note),
               shift_id = COALESCE($2, shift_id)
             WHERE id = $3 RETURNING *`,
            [note, linkedShiftId, existing.rows[0].id]
          );
          return updated.rows[0];
        }
        const inserted = await client.query(
          `INSERT INTO attendance (user_id, work_date, check_in, shift_id, note)
           VALUES ($1, $2, NOW(), $3, $4) RETURNING *`,
          [req.user.id, today, linkedShiftId, note]
        );
        return inserted.rows[0];
      } catch (err) {
        // Balapan dua check-in bersamaan: UNIQUE(user_id, work_date) menangkapnya.
        if (err.code === UNIQUE_VIOLATION) {
          throw new HttpError(400, 'Anda sudah absen masuk hari ini');
        }
        throw err;
      }
    });

    await logAudit(pool, { userId: req.user.id, action: 'check_in', entity: 'attendance', entityId: created.id });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.post('/check-out', async (req, res, next) => {
  try {
    const note = cleanString(req.body?.note, 300);

    const updated = await withTransaction(async (client) => {
      const todayResult = await client.query('SELECT CURRENT_DATE AS today');
      const today = todayResult.rows[0].today;

      const existing = await client.query(
        'SELECT * FROM attendance WHERE user_id = $1 AND work_date = $2 FOR UPDATE',
        [req.user.id, today]
      );
      const row = existing.rows[0];
      if (!row || !row.check_in) throw new HttpError(400, 'Belum absen masuk hari ini');
      if (row.check_out) throw new HttpError(400, 'Anda sudah absen pulang hari ini');

      const result = await client.query(
        `UPDATE attendance SET check_out = NOW(), note = COALESCE($1, note)
         WHERE id = $2 RETURNING *`,
        [note, row.id]
      );
      return result.rows[0];
    });

    await logAudit(pool, { userId: req.user.id, action: 'check_out', entity: 'attendance', entityId: updated.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);

    const conditions = ['a.user_id = $1'];
    const params = [req.user.id];
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`a.work_date >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`a.work_date <= $${params.length}::date`);
    }

    const result = await pool.query(
      `${SELECT_ATTENDANCE} WHERE ${conditions.join(' AND ')} ORDER BY a.work_date DESC LIMIT 60`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// =========================================================
// Admin: daftar, rekap, koreksi manual
// =========================================================
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const userId = toInt(req.query.user_id, 0);
    const from = cleanString(req.query.from, 10);
    const to = cleanString(req.query.to, 10);

    const conditions = [];
    const params = [];
    if (userId > 0) {
      params.push(userId);
      conditions.push(`a.user_id = $${params.length}`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      conditions.push(`a.work_date >= $${params.length}::date`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      conditions.push(`a.work_date <= $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM attendance a ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `${SELECT_ATTENDANCE} ${where} ORDER BY a.work_date DESC, a.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(paginated(result.rows, countResult.rows[0].total, page, limit));
  } catch (err) {
    next(err);
  }
});

// Rekap per karyawan pada periode (hari hadir, total jam kerja).
router.get('/summary', requireRole('admin'), async (req, res, next) => {
  try {
    const from = isValidDate(req.query.from) ? req.query.from : null;
    const to = isValidDate(req.query.to) ? req.query.to : null;

    const conditions = [];
    const params = [];
    if (from) {
      params.push(from);
      conditions.push(`a.work_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`a.work_date <= $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT u.id AS user_id, u.full_name AS user_name, u.role,
              COUNT(*)::int AS days_present,
              COALESCE(SUM(EXTRACT(EPOCH FROM (a.check_out - a.check_in))), 0)::bigint AS worked_seconds,
              COALESCE(SUM(CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NULL THEN 1 ELSE 0 END), 0)::int AS incomplete_days
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       ${where}
       GROUP BY u.id, u.full_name, u.role
       ORDER BY u.full_name`,
      params
    );

    res.json({
      from,
      to,
      rows: result.rows.map((r) => ({
        ...r,
        worked_hours: Math.round((Number(r.worked_seconds) / 3600) * 100) / 100,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Input/koreksi manual oleh admin (upsert per user + tanggal).
router.post('/manual', requireRole('admin'), async (req, res, next) => {
  try {
    const userId = toInt(req.body?.user_id, 0);
    if (userId <= 0) throw new HttpError(400, 'user_id wajib diisi');

    const workDate = cleanString(req.body?.work_date, 10);
    if (workDate && !isValidDate(workDate)) throw new HttpError(400, 'work_date tidak valid');

    const checkIn = cleanString(req.body?.check_in, 30);
    const checkOut = cleanString(req.body?.check_out, 30);
    const note = cleanString(req.body?.note, 300);
    const shiftId = toInt(req.body?.shift_id, 0) || null;

    const user = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) throw new HttpError(404, 'Pengguna tidak ditemukan');

    const result = await pool.query(
      `INSERT INTO attendance (user_id, work_date, check_in, check_out, shift_id, note)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::timestamptz, $4::timestamptz, $5, $6)
       ON CONFLICT (user_id, work_date) DO UPDATE SET
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         shift_id = EXCLUDED.shift_id,
         note = EXCLUDED.note
       RETURNING *`,
      [userId, workDate || null, checkIn, checkOut, shiftId, note]
    );

    await logAudit(pool, {
      userId: req.user.id,
      action: 'manual',
      entity: 'attendance',
      entityId: result.rows[0].id,
      detail: { user_id: userId, work_date: workDate },
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

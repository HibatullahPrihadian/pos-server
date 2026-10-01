const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/error');
const { getSettings } = require('../utils/settings');
const { imageUpload, uploadRoot, publicPath } = require('../utils/upload');
const { logAudit } = require('../utils/audit');
const { cleanString, toBool } = require('../utils/validate');

const router = express.Router();

const TEXT_FIELDS = [
  'store_name',
  'address',
  'phone',
  'npwp',
  'invoice_prefix',
  'receipt_footer',
];
const INT_FIELDS = [
  'point_earn_per_amount',
  'point_value_rupiah',
  'point_min_redeem',
  'low_stock_default',
];

router.get('/', async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

router.put('/', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const current = await getSettings();
    if (!current) throw new HttpError(500, 'Pengaturan toko belum diinisialisasi');

    const updates = {};
    TEXT_FIELDS.forEach((field) => {
      if (field in body) {
        const value = cleanString(body[field], field === 'receipt_footer' ? 500 : 200) || '';
        if (field === 'store_name' && !value) throw new HttpError(400, 'Nama toko wajib diisi');
        if (field === 'invoice_prefix' && !/^[A-Za-z0-9]{1,10}$/.test(value)) {
          throw new HttpError(400, 'Prefix invoice hanya huruf/angka, maks 10 karakter');
        }
        updates[field] = field === 'invoice_prefix' ? value.toUpperCase() : value;
      }
    });

    if ('tax_rate' in body) {
      const rate = Number(body.tax_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new HttpError(400, 'Tarif pajak harus antara 0 dan 100');
      }
      updates.tax_rate = rate;
    }

    if ('tax_included' in body) updates.tax_included = toBool(body.tax_included, true);
    if ('allow_negative_stock' in body) {
      updates.allow_negative_stock = toBool(body.allow_negative_stock, false);
    }

    INT_FIELDS.forEach((field) => {
      if (field in body) {
        const value = Math.round(Number(body[field]));
        if (!Number.isFinite(value) || value < 0) {
          throw new HttpError(400, `Nilai ${field} tidak valid`);
        }
        updates[field] = value;
      }
    });

    const keys = Object.keys(updates);
    if (keys.length === 0) return res.json(current);

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = keys.map((key) => updates[key]);

    await pool.query(
      `UPDATE store_settings SET ${setClause}, updated_at = NOW() WHERE id = 1`,
      values
    );
    await logAudit(pool, {
      userId: req.user.id,
      action: 'update',
      entity: 'settings',
      entityId: 1,
      detail: updates,
    });
    res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

router.post('/qris-image', requireRole('admin'), imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'File gambar wajib diunggah');

    const current = await getSettings();
    if (current?.qris_image_path) {
      const oldName = path.basename(current.qris_image_path);
      const oldFile = path.join(uploadRoot, oldName);
      fs.promises.unlink(oldFile).catch(() => {});
    }

    const relative = publicPath(req.file.filename);
    await pool.query('UPDATE store_settings SET qris_image_path = $1, updated_at = NOW() WHERE id = 1', [
      relative,
    ]);
    await logAudit(pool, {
      userId: req.user.id,
      action: 'upload',
      entity: 'settings',
      entityId: 1,
      detail: { qris_image_path: relative },
    });
    res.json({ qris_image_path: relative });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { HttpError } = require('../middleware/error');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);

const uploadRoot = path.isAbsolute(UPLOAD_DIR)
  ? UPLOAD_DIR
  : path.join(__dirname, '..', UPLOAD_DIR);

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(uploadRoot);
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.bin';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${safeExt}`);
  },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new HttpError(400, 'Tipe file harus gambar (jpg, png, webp, gif)'));
    }
    return cb(null, true);
  },
});

const publicPath = (filename) => `/uploads/${filename}`;

module.exports = { imageUpload, uploadRoot, ensureDir, publicPath };

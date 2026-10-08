// Middleware error terakhir: jangan bocorkan stack trace ke klien.
const errorHandler = (err, req, res, _next) => {
  const requestId = `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;
  console.error(`[${requestId}] ${req.method} ${req.originalUrl} ::`, err.message || err);

  if (res.headersSent) return;

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Ukuran file terlalu besar', request_id: requestId });
  }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Data sudah ada (duplikat)', request_id: requestId });
  }

  if (err.code === '23503') {
    return res.status(400).json({ error: 'Data terkait tidak ditemukan', request_id: requestId });
  }

  return res.status(err.status || 500).json({
    error: err.expose ? err.message : 'Server error',
    request_id: requestId,
  });
};

// 404 untuk endpoint API yang tidak dikenal.
const notFoundHandler = (_req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
};

// Helper error dengan status & pesan yang boleh ditampilkan ke klien.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

module.exports = { errorHandler, notFoundHandler, HttpError };

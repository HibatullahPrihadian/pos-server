const toInt = (value, fallback = 0) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

// Normalisasi parameter pagination dari query string.
const getPagination = (query = {}, { defaultLimit = 25, maxLimit = 200 } = {}) => {
  const page = Math.max(1, toInt(query.page, 1));
  const rawLimit = toInt(query.limit, defaultLimit);
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const paginated = (rows, total, page, limit) => ({
  data: rows,
  pagination: {
    page,
    limit,
    total: Number(total) || 0,
    total_pages: limit > 0 ? Math.ceil((Number(total) || 0) / limit) : 0,
  },
});

module.exports = { toInt, getPagination, paginated };

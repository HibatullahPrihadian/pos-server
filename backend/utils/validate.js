// Helper validasi payload. Mengembalikan { value } atau { error }.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cleanString = (value, maxLength) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLength ? s.slice(0, maxLength) : s;
};

const requireString = (value, field, maxLength) => {
  const s = cleanString(value, maxLength);
  if (!s) return { error: `${field} wajib diisi` };
  return { value: s };
};

const isValidDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

module.exports = {
  DATE_RE,
  cleanString,
  requireString,
  isValidDate,
  toBool,
  toNumberOrNull,
};

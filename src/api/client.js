// Fetch wrapper terpusat: menyisipkan JWT, menangani error, dan mengurai JSON.
const TOKEN_KEY = 'pos_token';
// Mode usaha aktif (minimarket/fotokopi). Dikirim sebagai header X-Business;
// backend memakai 'minimarket' bila header tidak ada (kompatibel dengan klien lama).
// Disimpan di sessionStorage: pilihan berlaku selama sesi tab (F5 tidak hilang),
// sesi baru menampilkan pemilih mode lagi.
const BUSINESS_KEY = 'pos_business';
export const DEFAULT_BUSINESS = 'minimarket';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export const getBusiness = () => sessionStorage.getItem(BUSINESS_KEY) || DEFAULT_BUSINESS;
// Nilai mentah: null bila user belum memilih mode usaha pada sesi ini.
export const peekBusiness = () => sessionStorage.getItem(BUSINESS_KEY);
export const setStoredBusiness = (business) => {
  if (business) sessionStorage.setItem(BUSINESS_KEY, business);
  else sessionStorage.removeItem(BUSINESS_KEY);
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const buildUrl = (path, params) => {
  if (!params) return path;
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.append(key, value);
  });
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
};

const parse = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const request = async (method, path, { body, params, isForm, signal, headers: extraHeaders } = {}) => {
  const headers = { ...extraHeaders };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers['X-Business'] = getBusiness();
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(buildUrl(path, params), {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const data = await parse(res);

  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('pos:unauthorized'));
    }
    const message = (data && data.error) || `Permintaan gagal (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data;
};

export const api = {
  get: (path, params, options) => request('GET', path, { params, ...options }),
  post: (path, body, options) => request('POST', path, { body, ...options }),
  put: (path, body, options) => request('PUT', path, { body, ...options }),
  del: (path, options) => request('DELETE', path, { ...options }),
  upload: (path, formData, options) => request('POST', path, { body: formData, isForm: true, ...options }),
};

// Unduh CSV dari endpoint report/produk dengan menyertakan header JWT.
export const downloadFile = async (path, filename, params) => {
  const token = getToken();
  const res = await fetch(buildUrl(path, params), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Business': getBusiness(),
    },
  });
  if (!res.ok) {
    const data = await parse(res);
    throw new ApiError((data && data.error) || 'Gagal mengunduh file', res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

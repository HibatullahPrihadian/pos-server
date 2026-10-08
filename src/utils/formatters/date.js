export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const parseDateParts = (dateString) => {
  if (typeof dateString !== 'string') return null;
  const [year, month, day] = dateString.split('-');
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) return null;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year, month, day, monthName: MONTHS_ID[monthIndex] };
};

// Format tanggal backend (YYYY-MM-DD) tanpa konversi timezone.
export const formatDate = (dateString) => {
  if (!dateString) return '-';
  const iso = String(dateString).slice(0, 10);
  const parts = parseDateParts(iso);
  if (!parts) return dateString;
  return `${Number(parts.day)} ${parts.monthName} ${parts.year}`;
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const date = `${String(d.getDate()).padStart(2, '0')} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // Jam memakai zona browser; label eksplisit agar tak disangka jam server.
  const tz = -d.getTimezoneOffset() === 420 ? 'WIB' : `UTC${-d.getTimezoneOffset() >= 0 ? '+' : ''}${-d.getTimezoneOffset() / 60}`;
  return `${date} ${time} ${tz}`;
};

export const formatTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const firstOfMonthIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

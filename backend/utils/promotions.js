// Resolusi diskon promo berbasis periode.
// Semua uang BIGINT rupiah; pembulatan memakai Math.round (aturan seragam server).

// Offset menit zona waktu toko relatif terhadap server (mis. WIB = +420).
// Dipakai agar jam/hari promo dievaluasi dalam waktu toko, bukan waktu server
// (container default UTC). Set lewat env PROMO_TZ_OFFSET_MINUTES.
const STORE_TZ_OFFSET_MINUTES = (() => {
  const n = Number(process.env.PROMO_TZ_OFFSET_MINUTES);
  return Number.isFinite(n) ? n : 0;
})();

// Proyeksikan Date ke "waktu toko" lalu ambil komponen lokal (jam/hari/tanggal).
const storeParts = (now) => {
  const shifted = new Date(now.getTime() + STORE_TZ_OFFSET_MINUTES * 60000);
  return {
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    day: shifted.getUTCDay(),
    date: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`,
  };
};

// Harga efektif per unit untuk satu promo. `basePrice` = harga kandidat sebelum promo
// (normal/member/tier). Mengembalikan harga per unit setelah promo (integer >= 0).
const resolvePromoPrice = ({ basePrice, promo, qty }) => {
  const base = Number(basePrice);
  const q = Math.max(1, Math.round(Number(qty) || 1));
  const value = Number(promo.discount_value);

  if (promo.discount_type === 'percent') {
    const pct = Math.max(0, Math.min(100, value));
    return Math.max(0, Math.round((base * (100 - pct)) / 100));
  }

  if (promo.discount_type === 'amount') {
    return Math.max(0, base - value);
  }

  if (promo.discount_type === 'batch_price') {
    // discount_value = harga total untuk min_qty unit.
    // Sisa unit (qty % min_qty) dihargai harga dasar. Total dibagi qty lalu dibulatkan.
    const batch = Math.max(1, Math.round(Number(promo.min_qty) || 1));
    const fullBatches = Math.floor(q / batch);
    const remainder = q % batch;
    const total = fullBatches * value + remainder * base;
    return Math.max(0, Math.round(total / q));
  }

  return base;
};

// Normalisasi nilai TIME ('HH:MM:SS') menjadi menit sejak tengah malam.
const timeToMinutes = (value) => {
  if (value === null || value === undefined) return null;
  const [h, m] = String(value).split(':');
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

// Apakah `now` (JS Date) berada dalam rentang jam promo. Menangani rentang lewat
// tengah malam (mis. 22:00 -> 02:00) dengan membalik logika perbandingan.
const withinTimeWindow = (promo, now, parts = storeParts(now)) => {
  const start = timeToMinutes(promo.start_time);
  const end = timeToMinutes(promo.end_time);
  if (start === null && end === null) return true;
  const current = parts.minutes;
  if (start === null) return current <= end;
  if (end === null) return current >= start;
  if (start <= end) return current >= start && current <= end;
  // Rentang melewati tengah malam.
  return current >= start || current <= end;
};

// Apakah hari ini termasuk days_of_week (0=Minggu..6=Sabtu). NULL = tiap hari.
const withinDayWindow = (promo, now, parts = storeParts(now)) => {
  if (!Array.isArray(promo.days_of_week) || promo.days_of_week.length === 0) return true;
  return promo.days_of_week.map(Number).includes(parts.day);
};

// Apakah tanggal `now` berada dalam rentang start_date..end_date (inklusif).
const withinDateWindow = (promo, now, parts = storeParts(now)) => {
  const today = parts.date;
  if (promo.start_date && today < String(promo.start_date).slice(0, 10)) return false;
  if (promo.end_date && today > String(promo.end_date).slice(0, 10)) return false;
  return true;
};

// Pilih kandidat promo termurah untuk base price tertentu.
// Mengembalikan { price, promo } atau null bila tidak ada promo yang menurunkan harga.
const resolveBestPromo = ({ basePrice, promotions, qty }) => {
  let best = null;
  for (const promo of promotions || []) {
    const price = resolvePromoPrice({ basePrice, promo, qty });
    if (price < Number(basePrice) && (best === null || price < best.price)) {
      best = { price, promo };
    }
  }
  return best;
};

// Ambil promo aktif untuk sekumpulan produk sekaligus (menghindari N+1).
// Mengembalikan Map product_id -> array promo (belum difilter qty/unit; pemanggil
// mencocokkan per baris memakai `promoMatchesLine`).
const findPromotionsForProducts = async (client, { productIds, categoryIds, now = new Date() }) => {
  const ids = [...new Set((productIds || []).filter(Boolean).map(Number))];
  const catIds = [...new Set((categoryIds || []).filter(Boolean).map(Number))];
  if (ids.length === 0 && catIds.length === 0) return { byProduct: new Map(), byCategory: new Map() };

  const result = await client.query(
    `SELECT * FROM promotions
     WHERE is_active = TRUE
       AND (
         (scope = 'product' AND product_id = ANY($1::int[]))
         OR (scope = 'category' AND category_id = ANY($2::int[]))
       )`,
    [ids, catIds]
  );

  const byProduct = new Map();
  const byCategory = new Map();
  for (const promo of result.rows) {
    if (!withinDateWindow(promo, now) || !withinDayWindow(promo, now) || !withinTimeWindow(promo, now)) {
      continue;
    }
    if (promo.scope === 'product') {
      if (!byProduct.has(promo.product_id)) byProduct.set(promo.product_id, []);
      byProduct.get(promo.product_id).push(promo);
    } else {
      if (!byCategory.has(promo.category_id)) byCategory.set(promo.category_id, []);
      byCategory.get(promo.category_id).push(promo);
    }
  }
  return { byProduct, byCategory };
};

// Apakah promo cocok untuk satu baris (qty minimum + satuan). unit_id NULL = semua satuan.
const promoMatchesLine = (promo, { qty, unitId }) => {
  const q = Math.max(1, Math.round(Number(qty) || 1));
  if (Number(promo.min_qty) > q) return false;
  if (promo.unit_id === null || promo.unit_id === undefined) return true;
  return Number(promo.unit_id) === Number(unitId) || false;
};

module.exports = {
  resolvePromoPrice,
  resolveBestPromo,
  findPromotionsForProducts,
  promoMatchesLine,
  timeToMinutes,
  withinTimeWindow,
  withinDayWindow,
  withinDateWindow,
};

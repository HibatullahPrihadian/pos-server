const pool = require('../db');
const { chatCompletion, getModel } = require('./kenari');

// =========================================================
// Insight naratif laporan bulanan (kenari.id) dengan cache per periode.
// - Satu baris cache di report_insights: UNIQUE(business, from_date, to_date).
// - Kegagalan API/key/timeout -> { content: null, reason: 'ai_unavailable' }
//   (HTTP 200 agar frontend tetap membuka pratinjau; laporan lain normal).
// =========================================================

const pad2 = (n) => String(n).padStart(2, '0');
const toIsoDate = (value) => {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
};

// Periode sebelumnya dengan panjang yang sama, berakhir sehari sebelum `from`.
const previousRange = (from, to) => {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const days = Math.round((t - f) / 86400000) + 1;
  const prevTo = new Date(f.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: toIsoDate(prevFrom), to: toIsoDate(prevTo) };
};

// Delta persen (dibulatkan 1 desimal); null bila basis 0/absen.
const deltaPct = (current, previous) => {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const rangeDays = (from, to) => {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  return Math.round((t - f) / 86400000) + 1;
};

// ---------------------------------------------------------
// Minimarket
// ---------------------------------------------------------
const minimarketDaily = async (business, from, to) => {
  const sales = await pool.query(
    `SELECT s.created_at::date AS date, COUNT(*)::int AS txn_count,
            COALESCE(SUM(s.grand_total), 0)::bigint AS grand_total
     FROM sales s
     WHERE s.business = $3 AND s.status = 'completed'
       AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
     GROUP BY s.created_at::date ORDER BY s.created_at::date`,
    [from, to, business]
  );
  const refunds = await pool.query(
    `SELECT r.created_at::date AS date, COALESCE(SUM(r.total), 0)::bigint AS refund_total
     FROM returns r JOIN sales s ON s.id = r.sale_id
     WHERE s.business = $3 AND r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')
     GROUP BY r.created_at::date`,
    [from, to, business]
  );
  const refundMap = new Map(refunds.rows.map((r) => [toIsoDate(r.date), Number(r.refund_total)]));
  return sales.rows.map((r) => ({
    date: toIsoDate(r.date),
    txn_count: r.txn_count,
    grand_total: Number(r.grand_total),
    refund_total: refundMap.get(toIsoDate(r.date)) || 0,
  }));
};

// Total penjualan + laba rugi (ringkas) untuk satu rentang.
const minimarketTotals = async (business, from, to) => {
  const params = [from, to, business];
  const sales = await pool.query(
    `SELECT COUNT(*)::int AS txn_count, COALESCE(SUM(s.grand_total), 0)::bigint AS grand_total,
            COALESCE(SUM(s.tax_total), 0)::bigint AS tax_total
     FROM sales s
     WHERE s.business = $3 AND s.status = 'completed'
       AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')`,
    params
  );
  const profit = await pool.query(
    `SELECT COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
            COALESCE(SUM(si.cost_price * si.qty), 0)::bigint AS cogs,
            COALESCE(SUM(si.line_total - (si.cost_price * si.qty)), 0)::bigint AS gross_profit
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.business = $3 AND s.status = 'completed'
       AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')`,
    params
  );
  const returns = await pool.query(
    `SELECT COALESCE(SUM(ri.refund_amount), 0)::bigint AS return_refund,
            COALESCE(SUM(ri.qty * si.cost_price), 0)::bigint AS return_cogs
     FROM return_items ri
     JOIN returns r ON r.id = ri.return_id
     JOIN sales s ON s.id = r.sale_id
     LEFT JOIN sale_items si ON si.id = ri.sale_item_id
     WHERE s.business = $3 AND r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')`,
    params
  );
  const expense = await pool.query(
    `SELECT COALESCE(SUM(e.amount), 0)::bigint AS expense
     FROM expenses e
     WHERE e.business = $3 AND e.date >= $1::date AND e.date <= $2::date`,
    params
  );

  const txnCount = sales.rows[0].txn_count;
  const grandTotal = Number(sales.rows[0].grand_total);
  const grossProfit = Number(profit.rows[0].gross_profit);
  const returnRefund = Number(returns.rows[0].return_refund);
  const returnCogs = Number(returns.rows[0].return_cogs);
  const opExpense = Number(expense.rows[0].expense);

  return {
    txn_count: txnCount,
    grand_total: grandTotal,
    tax_total: Number(sales.rows[0].tax_total),
    refund_total: returnRefund,
    gross_profit: grossProfit,
    operating_expense: opExpense,
    net_profit: grossProfit - (returnRefund - returnCogs) - opExpense,
  };
};

const minimarketPayload = async (business, from, to) => {
  const prev = previousRange(from, to);
  const [daily, totals, prevTotals, byPayment, topProducts] = await Promise.all([
    minimarketDaily(business, from, to),
    minimarketTotals(business, from, to),
    minimarketTotals(business, prev.from, prev.to),
    pool.query(
      `SELECT sp.method, COUNT(DISTINCT sp.sale_id)::int AS txn_count, COALESCE(SUM(sp.amount), 0)::bigint AS total
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.business = $3 AND s.status = 'completed'
         AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY sp.method ORDER BY total DESC`,
      [from, to, business]
    ),
    pool.query(
      `SELECT p.name AS product_name, SUM(si.base_qty)::int AS qty_sold,
              COALESCE(SUM(si.line_total), 0)::bigint AS revenue,
              COALESCE(SUM(si.line_total - (si.cost_price * si.qty)), 0)::bigint AS gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.business = $3 AND s.status = 'completed'
         AND s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY p.name ORDER BY qty_sold DESC LIMIT 5`,
      [from, to, business]
    ),
  ]);

  return {
    usaha: business,
    periode: { from, to, hari: rangeDays(from, to) },
    ringkasan: {
      penjualan: totals.grand_total,
      transaksi: totals.txn_count,
      ppn: totals.tax_total,
      retur: totals.refund_total,
      laba_kotor: totals.gross_profit,
      beban_operasional: totals.operating_expense,
      laba_bersih: totals.net_profit,
    },
    vs_periode_sebelumnya: {
      periode: { from: prev.from, to: prev.to },
      penjualan: prevTotals.grand_total,
      transaksi: prevTotals.txn_count,
      laba_bersih: prevTotals.net_profit,
      delta: {
        penjualan_pct: deltaPct(totals.grand_total, prevTotals.grand_total),
        transaksi_pct: deltaPct(totals.txn_count, prevTotals.txn_count),
        laba_bersih_pct: deltaPct(totals.net_profit, prevTotals.net_profit),
      },
    },
    // [tanggal, transaksi, penjualan, retur] — cukup untuk tren/hari ekstrem.
    harian: daily.map((r) => [r.date, r.txn_count, r.grand_total, r.refund_total]),
    metode_bayar: byPayment.rows.map((r) => ({
      metode: r.method,
      transaksi: r.txn_count,
      total: Number(r.total),
    })),
    produk_teratas: topProducts.rows.map((r) => ({
      nama: r.product_name,
      qty: r.qty_sold,
      pendapatan: Number(r.revenue),
      laba_kotor: Number(r.gross_profit),
    })),
  };
};

// ---------------------------------------------------------
// Fotokopi (pendapatan jasa; antrian queue di luar scope)
// ---------------------------------------------------------
const fotokopiDaily = async (business, from, to) => {
  const result = await pool.query(
    `SELECT po.created_at::date AS date, COUNT(*)::int AS order_count,
            COALESCE(SUM(po.grand_total), 0)::bigint AS grand_total
     FROM print_orders po
     WHERE po.business = $1 AND po.payment_status = 'paid' AND po.status <> 'cancelled'
       AND po.created_at >= $2::date AND po.created_at < ($3::date + INTERVAL '1 day')
     GROUP BY po.created_at::date ORDER BY po.created_at::date`,
    [business, from, to]
  );
  return result.rows.map((r) => ({
    date: toIsoDate(r.date),
    order_count: r.order_count,
    grand_total: Number(r.grand_total),
  }));
};

const fotokopiTotals = async (business, from, to) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS order_count, COALESCE(SUM(po.grand_total), 0)::bigint AS grand_total,
            COALESCE(SUM(po.tax_total), 0)::bigint AS tax_total
     FROM print_orders po
     WHERE po.business = $1 AND po.payment_status = 'paid' AND po.status <> 'cancelled'
       AND po.created_at >= $2::date AND po.created_at < ($3::date + INTERVAL '1 day')`,
    [business, from, to]
  );
  const orderCount = result.rows[0].order_count;
  const grandTotal = Number(result.rows[0].grand_total);
  return {
    order_count: orderCount,
    grand_total: grandTotal,
    tax_total: Number(result.rows[0].tax_total),
    avg_per_order: orderCount > 0 ? Math.round(grandTotal / orderCount) : 0,
  };
};

const fotokopiPayload = async (business, from, to) => {
  const prev = previousRange(from, to);
  const [daily, totals, prevTotals, topServices] = await Promise.all([
    fotokopiDaily(business, from, to),
    fotokopiTotals(business, from, to),
    fotokopiTotals(business, prev.from, prev.to),
    pool.query(
      `SELECT ps.name AS service_name, ps.category,
              SUM(poi.qty)::int AS sheets, COALESCE(SUM(poi.line_total), 0)::bigint AS revenue
       FROM print_order_items poi
       JOIN print_orders po ON po.id = poi.order_id
       JOIN print_services ps ON ps.id = poi.service_id
       WHERE po.business = $1 AND po.payment_status = 'paid' AND po.status <> 'cancelled'
         AND po.created_at >= $2::date AND po.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY ps.name, ps.category ORDER BY revenue DESC LIMIT 5`,
      [business, from, to]
    ),
  ]);

  return {
    usaha: business,
    periode: { from, to, hari: rangeDays(from, to) },
    ringkasan: {
      pendapatan: totals.grand_total,
      pesanan_lunas: totals.order_count,
      ppn: totals.tax_total,
      rata_rata_per_pesanan: totals.avg_per_order,
    },
    vs_periode_sebelumnya: {
      periode: { from: prev.from, to: prev.to },
      pendapatan: prevTotals.grand_total,
      pesanan_lunas: prevTotals.order_count,
      rata_rata_per_pesanan: prevTotals.avg_per_order,
      delta: {
        pendapatan_pct: deltaPct(totals.grand_total, prevTotals.grand_total),
        pesanan_pct: deltaPct(totals.order_count, prevTotals.order_count),
      },
    },
    // [tanggal, pesanan lunas, pendapatan].
    harian: daily.map((r) => [r.date, r.order_count, r.grand_total]),
    jasa_teratas: topServices.rows.map((r) => ({
      nama: r.service_name,
      kategori: r.category || '',
      lembar: r.sheets,
      pendapatan: Number(r.revenue),
    })),
  };
};

// ---------------------------------------------------------
// Prompt (dipakai minimarket & fotokopi agar gaya narasi sama)
// ---------------------------------------------------------
const SYSTEM_PROMPT = [
  'Kamu adalah analis laporan untuk pemilik toko di Indonesia.',
  'Tulis narasi ringkas 4-6 poin Bahasa Indonesia yang MEMBACA data (bukan rekap angka dobel).',
  'Setiap poin satu baris diawali "• ". Tanpa judul, tanpa markdown lain, tanpa penutup.',
  'Bahasa praktis untuk pemilik toko: sebutkan perbandingan vs periode sebelumnya,',
  'hari tersibuk/terlemah dari deret harian, tren penjualan, mix metode bayar (atau jasa teratas),',
  'produk/jasa penyumbang terbesar, serta rasio laba & PPN bila relevan.',
  'Semua angka dalam Rupiah (boleh disingkat juta/miliar) dan persentase 1 desimal.',
  'Jangan mengarang angka yang tidak ada di payload; lewati poin yang datanya tidak tersedia.',
  'Bila suatu metrik naik/turun, sebutkan arah dan besarnya perubahan.',
].join(' ');

// Nasi bungkus data -> pesan user JSON padat (hemat token).
const buildUserPrompt = (payload) =>
  [
    'Berikut payload laporan toko (JSON). Hasilkan narasi 4-6 poin sesuai aturan sistem.',
    JSON.stringify(payload),
  ].join('\n\n');

// ---------------------------------------------------------
// API utama
// ---------------------------------------------------------
// getMonthlyInsight({ business, from, to, refresh }) ->
//   { content, model, cached, reason? } ; selalu resolve (tanpa throw).
const getMonthlyInsight = async ({ business, from, to, refresh = false }) => {
  const wantsRefresh = Boolean(refresh);

  if (!wantsRefresh) {
    try {
      const cached = await pool.query(
        'SELECT content, model FROM report_insights WHERE business = $1 AND from_date = $2::date AND to_date = $3::date',
        [business, from, to]
      );
      if (cached.rows[0]) {
        return { content: cached.rows[0].content, model: cached.rows[0].model, cached: true };
      }
    } catch {
      // Tabel belum ada/DB sesaat gagal -> coba generate; kegagalan berikutnya = fallback.
    }
  }

  let payload;
  try {
    payload =
      business === 'fotokopi'
        ? await fotokopiPayload(business, from, to)
        : await minimarketPayload(business, from, to);
  } catch {
    return { content: null, model: null, cached: false, reason: 'ai_unavailable' };
  }

  const content = await chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(payload) },
    ],
    { maxTokens: 4000, temperature: 0.4 }
  );

  if (!content) {
    return { content: null, model: null, cached: false, reason: 'ai_unavailable' };
  }

  const model = getModel();
  try {
    await pool.query(
      `INSERT INTO report_insights (business, from_date, to_date, content, model)
       VALUES ($1, $2::date, $3::date, $4, $5)
       ON CONFLICT (business, from_date, to_date)
       DO UPDATE SET content = $4, model = $5, created_at = NOW()`,
      [business, from, to, content, model]
    );
  } catch {
    // Cache gagal tersimpan tidak menghalangi narasi tampil.
  }

  return { content, model, cached: false };
};

module.exports = { getMonthlyInsight, minimarketPayload, fotokopiPayload, previousRange };

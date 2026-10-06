// Ringkasan piutang grosir (belum lunas & lewat jatuh tempo). Dipakai bersama oleh
// GET /api/invoices/summary dan KPI dashboard agar aturan tidak menyimpang.
// Batas "hari ini" mengikuti zona waktu toko (APP_TIMEZONE), konsisten dengan
// laporan lain, bukan CURRENT_DATE sesi DB (UTC).
const pool = require('../db');

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Jakarta';

// `business` opsional: bila diisi, piutang difilter per usaha (dashboard mode
// fotokopi tidak boleh ikut menampilkan piutang minimarket).
const getReceivableSummary = async (runner = pool, business = null) => {
  const result = await runner.query(
    `SELECT
       COALESCE(SUM(s.grand_total - s.paid_amount), 0)::bigint AS outstanding_total,
       COALESCE(SUM(CASE WHEN s.payment_status <> 'paid' THEN 1 ELSE 0 END), 0)::int AS unpaid_count,
       COALESCE(SUM(CASE WHEN s.payment_status <> 'paid' AND s.due_date IS NOT NULL
                              AND s.due_date < (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
                         THEN s.grand_total - s.paid_amount ELSE 0 END), 0)::bigint AS overdue_total,
       COALESCE(SUM(CASE WHEN s.payment_status <> 'paid' AND s.due_date IS NOT NULL
                              AND s.due_date < (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
                         THEN 1 ELSE 0 END), 0)::int AS overdue_count
     FROM sales s
     WHERE s.is_credit = TRUE AND s.status = 'completed'
       AND ($2::varchar IS NULL OR s.business = $2)`,
    [APP_TIMEZONE, business]
  );
  const row = result.rows[0];
  return {
    outstanding_total: Number(row.outstanding_total),
    unpaid_count: row.unpaid_count,
    overdue_total: Number(row.overdue_total),
    overdue_count: row.overdue_count,
  };
};

module.exports = { getReceivableSummary, APP_TIMEZONE };

// Check sekali jalan (tanpa framework) untuk payload & cache insight laporan
// bulanan. Jalankan dari folder backend:
//   DB_HOST=localhost DB_PORT=5433 DB_NAME=pos_minimarket DB_USER=postgres \
//   DB_PASSWORD=<pass> node checks/monthly-insight.js
// Verdict: query payload jalan untuk kedua usaha, bentuk payload sesuai harapan,
// dan getMonthlyInsight selalu resolve (narasi AI bila key terisi, fallback bila tidak).

const pool = require('../db');
const { ensureReportInsightsTable } = require('../utils/bootstrap');
const {
  getMonthlyInsight,
  minimarketPayload,
  fotokopiPayload,
  previousRange,
} = require('../utils/monthlyInsight');

const assert = (cond, msg) => {
  if (!cond) throw new Error(`GAGAL: ${msg}`);
  console.log(`OK: ${msg}`);
};

const pad2 = (n) => String(n).padStart(2, '0');
const today = new Date();
const from = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
const to = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

const run = async () => {
  await ensureReportInsightsTable();

  const prev = previousRange(from, to);
  assert(prev.to < from, `periode sebelumnya berakhir sebelum from (${prev.from}..${prev.to})`);

  const mini = await minimarketPayload('minimarket', from, to);
  assert(typeof mini.ringkasan.penjualan === 'number', 'payload minimarket: penjualan numerik');
  assert(Array.isArray(mini.harian), 'payload minimarket: deret harian ada');
  assert(Array.isArray(mini.metode_bayar), 'payload minimarket: metode bayar ada');
  assert(Array.isArray(mini.produk_teratas) && mini.produk_teratas.length <= 5, 'payload minimarket: top produk <= 5');

  const foto = await fotokopiPayload('fotokopi', from, to);
  assert(typeof foto.ringkasan.pendapatan === 'number', 'payload fotokopi: pendapatan numerik');
  assert(Array.isArray(foto.jasa_teratas), 'payload fotokopi: jasa teratas ada');

  for (const business of ['minimarket', 'fotokopi']) {
    const first = await getMonthlyInsight({ business, from, to });
    const second = await getMonthlyInsight({ business, from, to });
    if (first.content) {
      assert(second.cached === true, `${business}: panggilan kedua memakai cache`);
      console.log(`${business}: insight AI (${first.model}):\n${first.content}`);
    } else {
      assert(first.reason === 'ai_unavailable', `${business}: fallback ai_unavailable bila AI gagal`);
      console.log(`${business}: AI tidak tersedia (key kosong/gagal) -> fallback sesuai harapan`);
    }
  }

  await pool.end();
  console.log('\nSemua check lulus.');
};

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

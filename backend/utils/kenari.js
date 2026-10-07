// Klien kenari.id (OpenAI-compatible): POST {base}/chat/completions dengan
// Authorization: Bearer. Key hanya dari env backend — tidak pernah dikirim ke
// frontend dan tidak pernah dicetak ke log.
//
// Semua kegagalan (key kosong, HTTP non-OK, timeout, network) menghasilkan
// null; pemanggil menurunkan ke fallback catatan "insight tidak tersedia".

const DEFAULT_BASE_URL = 'https://kenari.id/v1';
const DEFAULT_MODEL = 'mimo-v2-6-flash:free';

const getModel = () => process.env.KENARI_MODEL || DEFAULT_MODEL;

// chatCompletion(messages, { maxTokens, temperature }) -> string | null
// maxTokens besar (default 4000): model `mimo` adalah model reasoning — token
// penalaran dihitung ke `max_tokens`. Budget kecil (600/1600) sering habis
// sebelum `content` terisi (finish_reason=length -> content null -> fallback
// terus-menerus). Generasi berhenti alami di ~1000 token saat narasi selesai,
// jadi ceiling tinggi hanya pengaman, bukan pemakaian rutin.
const chatCompletion = async (messages, { maxTokens = 4000, temperature = 0.4 } = {}) => {
  const key = (process.env.KENARI_API_KEY || '').trim();
  if (!key) return null;

  const base = (process.env.KENARI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  // Latensi umum 5–22s; lane gratis kadang ~40s (pengamatan: satu percobaan 38s)
  // — 60s memberi ruang tanpa membuang hasil yang hampir selesai.
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        temperature,
        max_tokens: maxTokens,
        // Model mimo = reasoning; tanpa batas ini penalaran bisa makan 20-60s
        // (timeout) atau seluruh max_tokens (content null). 'low' cukup untuk
        // narasi laporan: latensi turun ke ~5-15s, kualitas tetap memadai.
        reasoning_effort: 'low',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Log tanpa key: cukup status + cuplikan body untuk diagnosis (429/5xx).
      const body = await res.text().catch(() => '');
      console.warn(`[kenari] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(
        `[kenari] content kosong (finish=${choice?.finish_reason ?? '?'}, model=${data?.model ?? '?'})`
      );
      return null;
    }
    return content.trim();
  } catch (err) {
    console.warn(`[kenari] gagal: ${err?.name || 'Error'} ${String(err?.message || '').slice(0, 120)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { chatCompletion, getModel };

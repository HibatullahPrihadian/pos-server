// Tulis satu baris audit log. Aman dipanggil dengan client transaksi atau pool.
const logAudit = async (runner, { userId, action, entity, entityId = null, detail = null }) => {
  try {
    await runner.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, entity, entityId, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
};

module.exports = { logAudit };

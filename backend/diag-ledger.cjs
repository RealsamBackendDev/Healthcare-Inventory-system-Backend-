const { pool } = require('./src/database/connection');
const IN_T = "('receipt','import','opening_stock','transfer_in','transit_in','return_restock')";
const S = `CASE WHEN m.movement_type IN ${IN_T} THEN abs(m.quantity) ELSE -abs(m.quantity) END`;
const q = async (label, sql, params) => {
  try {
    const { rows } = await pool.query(sql, params || []);
    console.log(`--- ${label} (${rows.length})`);
    rows.forEach((r) => console.log('  ' + JSON.stringify(r)));
  } catch (e) {
    console.log(`--- ${label} ERROR ${e.message.slice(0, 160)}`);
  }
};
(async () => {
  await q('BATCHES_WITH_GAP', `WITH m AS (SELECT batch_id, SUM(${S}) q FROM stock_movements m GROUP BY 1)
    SELECT b.batch_number, b.status, b.quantity, COALESCE(m.q,0) ledger, (b.quantity-COALESCE(m.q,0)) gap,
           b.created_at, sl.name AS location
      FROM batches b LEFT JOIN m ON m.batch_id=b.id LEFT JOIN stock_locations sl ON sl.id=b.stock_location_id
     WHERE abs(b.quantity-COALESCE(m.q,0))>0.0001 ORDER BY b.created_at LIMIT 40`);
  await q('LOCATION_GAP', `WITH m AS (SELECT stock_location_id, SUM(${S}) q FROM stock_movements m GROUP BY 1),
      b AS (SELECT stock_location_id, SUM(quantity) q, count(*) n FROM batches GROUP BY 1)
    SELECT sl.name, sl.location_type, b.n batches, COALESCE(b.q,0) batch_qty, COALESCE(m.q,0) ledger_qty,
           COALESCE(b.q,0)-COALESCE(m.q,0) gap
      FROM stock_locations sl LEFT JOIN m ON m.stock_location_id=sl.id LEFT JOIN b ON b.stock_location_id=sl.id
     WHERE abs(COALESCE(b.q,0)-COALESCE(m.q,0))>0.0001 LIMIT 20`);
  const gaps = await pool.query(`WITH m AS (SELECT batch_id, SUM(${S}) q FROM stock_movements m GROUP BY 1)
    SELECT b.id FROM batches b LEFT JOIN m ON m.batch_id=b.id WHERE abs(b.quantity-COALESCE(m.q,0))>0.0001 LIMIT 1`);
  const batchId = gaps.rows[0] ? gaps.rows[0].id : null;
  if (batchId) {
    await q('MOVEMENTS_OF_GAP_BATCH', `SELECT movement_type, quantity, reason, actor_full_name, receipt_id,
             dispensing_record_id, adjustment_id, return_request_id, created_at
        FROM stock_movements WHERE batch_id=$1 ORDER BY created_at`, [batchId]);
    await q('BATCH_ROW', `SELECT b.batch_number, b.quantity, b.status, b.received_date, b.supplier_reference,
             b.created_at, b.updated_at, sl.name AS location
        FROM batches b JOIN stock_locations sl ON sl.id=b.stock_location_id WHERE b.id=$1`, [batchId]);
    await q('BATCHES_AT_GAP_LOCATION', `WITH m AS (SELECT batch_id, SUM(${S}) q FROM stock_movements m GROUP BY 1)
      SELECT b.batch_number, b.status, b.quantity, COALESCE(m.q,0) ledger,
             (b.quantity-COALESCE(m.q,0)) gap, b.created_at,
             (SELECT count(*) FROM stock_movements x WHERE x.batch_id=b.id) moves
        FROM batches b LEFT JOIN m ON m.batch_id=b.id
       WHERE b.stock_location_id = (SELECT stock_location_id FROM batches WHERE id=$1)
       ORDER BY abs(b.quantity-COALESCE(m.q,0)) DESC, b.created_at LIMIT 40`, [batchId]);
    await q('MOVEMENTS_BY_TYPE_AT_GAP_LOCATION', `SELECT m.movement_type, count(*) rows, SUM(${S}) signed
        FROM stock_movements m
       WHERE m.stock_location_id = (SELECT stock_location_id FROM batches WHERE id=$1) GROUP BY 1 ORDER BY 1`,
      [batchId]);
  }
  await q('BATCHES_WITHOUT_MOVEMENTS', `SELECT b.batch_number, b.quantity, b.status, b.created_at, sl.name AS location
      FROM batches b LEFT JOIN stock_locations sl ON sl.id=b.stock_location_id
     WHERE NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.batch_id=b.id) ORDER BY b.created_at LIMIT 20`);
  await q('MOVEMENT_SCOPE_MISMATCH', `SELECT m.id, m.movement_type, m.stock_location_id, b.batch_number,
             b.stock_location_id AS batch_location
      FROM stock_movements m JOIN batches b ON b.id=m.batch_id
     WHERE m.stock_location_id IS DISTINCT FROM b.stock_location_id LIMIT 20`);
  await q('BATCH_TOTALS', `SELECT count(*) batches, SUM(quantity) qty FROM batches`);
  await pool.end();
})().catch(async (e) => { console.log('DIAG_ERROR ' + e.message); await pool.end(); });

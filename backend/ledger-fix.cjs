const { pool, withTransaction } = require('./src/database/connection');
const APPLY = process.argv.includes('--apply');
const REASON = 'Ledger reconciliation: batch quantity and stock movements disagreed (audit 2026-11-24)';
const Q = {
  gaps: `SELECT b.id, b.batch_number, b.status, b.quantity, COALESCE(m.q,0) ledger,
                (b.quantity-COALESCE(m.q,0)) gap, sl.name AS location, sl.location_type
           FROM batches b
           LEFT JOIN (SELECT batch_id, SUM(quantity) q FROM stock_movements GROUP BY 1) m ON m.batch_id=b.id
           LEFT JOIN stock_locations sl ON sl.id=b.stock_location_id
          WHERE abs(b.quantity-COALESCE(m.q,0))>0.0001
          ORDER BY abs(b.quantity-COALESCE(m.q,0)) DESC, b.batch_number`,
  locations: `WITH m AS (SELECT stock_location_id, SUM(quantity) q FROM stock_movements GROUP BY 1),
                   b AS (SELECT stock_location_id, SUM(quantity) q FROM batches GROUP BY 1)
              SELECT sl.name, sl.location_type, COALESCE(b.q,0) batch_qty, COALESCE(m.q,0) ledger_qty,
                     COALESCE(b.q,0)-COALESCE(m.q,0) gap
                FROM stock_locations sl
                LEFT JOIN m ON m.stock_location_id=sl.id
                LEFT JOIN b ON b.stock_location_id=sl.id
               WHERE abs(COALESCE(b.q,0)-COALESCE(m.q,0))>0.0001
               ORDER BY abs(COALESCE(b.q,0)-COALESCE(m.q,0)) DESC`,
  scope: `SELECT m.movement_type, b.batch_number, sl.name AS movement_location, slb.name AS batch_location
            FROM stock_movements m
            JOIN batches b ON b.id=m.batch_id
            LEFT JOIN stock_locations sl ON sl.id=m.stock_location_id
            LEFT JOIN stock_locations slb ON slb.id=b.stock_location_id
           WHERE m.stock_location_id IS DISTINCT FROM b.stock_location_id LIMIT 20`,
  batchSum: `WITH m AS (SELECT batch_id, SUM(quantity) q FROM stock_movements GROUP BY 1)
             SELECT COALESCE(SUM(b.quantity-COALESCE(m.q,0)),0) total FROM batches b
             LEFT JOIN m ON m.batch_id=b.id`
};
const show = async () => {
  const gaps = (await pool.query(Q.gaps)).rows;
  const locs = (await pool.query(Q.locations)).rows;
  const scope = (await pool.query(Q.scope)).rows;
  const total = Number((await pool.query(Q.batchSum)).rows[0].total);
  console.log(`BATCH_GAPS ${gaps.length}`);
  gaps.slice(0, 40).forEach((r) =>
    console.log(`  ${r.batch_number} ${r.location} qty=${r.quantity} ledger=${r.ledger} gap=${r.gap}`));
  console.log(`LOCATION_GAPS ${locs.length}`);
  locs.slice(0, 20).forEach((r) =>
    console.log(`  ${r.name} [${r.location_type}] batch=${r.batch_qty} ledger=${r.ledger_qty} gap=${r.gap}`));
  console.log(`SCOPE_MISMATCHES ${scope.length}`);
  scope.slice(0, 10).forEach((r) =>
    console.log(`  ${r.movement_type} ${r.batch_number}: ${r.movement_location} vs ${r.batch_location}`));
  console.log(`SUM_OF_BATCH_GAPS ${total}`);
  return { gaps, total };
};
(async () => {
  const before = await show();
  if (!APPLY) {
    console.log('DRY_RUN. Re-run with --apply to write balancing movements.');
    await pool.end();
    return;
  }
  if (!before.gaps.length) {
    console.log('NOTHING_TO_FIX');
    await pool.end();
    return;
  }
  const actor = (await pool.query('SELECT id, full_name FROM users ORDER BY created_at LIMIT 1')).rows[0];
  await withTransaction(async (client) => {
    for (const row of before.gaps) {
      const qty = Number(row.gap);
      const b = await client.query('SELECT drug_id FROM batches WHERE id=$1 FOR UPDATE', [row.id]);
      await client.query(
        `INSERT INTO stock_movements (drug_id, batch_id, movement_type, quantity, reason,
           actor_user_id, actor_full_name, source_reference)
         VALUES ($1, $2, 'reconciliation', $3, $4, $5, $6, 'RECON-2026-11-24')`,
        [b.rows[0].drug_id, row.id, qty, REASON, actor.id, actor.full_name]
      );
      console.log(`  fixed ${row.batch_number} by ${qty}`);
    }
  });
  console.log('APPLIED');
  await show();
  await pool.end();
})().catch(async (e) => {
  console.log('LEDGER_FIX_ERROR ' + e.message);
  await pool.end();
  process.exit(1);
});

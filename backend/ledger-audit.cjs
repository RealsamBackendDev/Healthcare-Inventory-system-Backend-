const { pool } = require('./src/database/connection');
const IN_T = "('receipt','import','opening_stock','transfer_in','transit_in','return_restock')";
const S = 'm.quantity';
const short = `i.quantity - COALESCE(i.accepted_quantity,0) - COALESCE(i.rejected_quantity,0) - COALESCE(i.damaged_quantity,0) - COALESCE(i.missing_quantity,0)`;
const checks = [
['A1_BATCH_VS_LEDGER', `WITH m AS (SELECT batch_id, SUM(${S}) q FROM stock_movements m GROUP BY 1) SELECT b.batch_number, b.status, b.quantity batch_qty, COALESCE(m.q,0) ledger_qty FROM batches b LEFT JOIN m ON m.batch_id=b.id WHERE abs(b.quantity-COALESCE(m.q,0))>0.0001 ORDER BY b.created_at DESC LIMIT 100`],
['A2_LOCATION_VS_LEDGER', `WITH m AS (SELECT stock_location_id, SUM(${S}) q FROM stock_movements m GROUP BY 1), b AS (SELECT stock_location_id, SUM(quantity) q FROM batches GROUP BY 1) SELECT sl.name, sl.location_type, COALESCE(b.q,0) batch_qty, COALESCE(m.q,0) ledger_qty FROM stock_locations sl LEFT JOIN m ON m.stock_location_id=sl.id LEFT JOIN b ON b.stock_location_id=sl.id WHERE abs(COALESCE(b.q,0)-COALESCE(m.q,0))>0.0001 LIMIT 100`],
['A3_MOVEMENT_SCOPE', `SELECT m.id, m.movement_type FROM stock_movements m JOIN batches b ON b.id=m.batch_id WHERE m.stock_location_id IS DISTINCT FROM b.stock_location_id OR m.local_government_id IS DISTINCT FROM b.local_government_id LIMIT 100`],
['A4_NEGATIVE_BATCH', `SELECT batch_number, status, quantity FROM batches WHERE quantity < -0.0001 LIMIT 100`],
['A5_DESTROYED_WITH_STOCK', `SELECT batch_number, status, quantity FROM batches WHERE status IN ('destroyed','written_off') AND quantity > 0.0001 LIMIT 100`],
['A6_DISPATCH_UNACCOUNTED', `SELECT d.dispatch_number, i.batch_number, i.quantity FROM lg_dispatches d JOIN lg_dispatch_items i ON i.dispatch_id=d.id WHERE d.status IN ('received','closed') AND abs(${short})>0.0001 LIMIT 100`],
['A7_DISPATCH_OVER_AUTHORISED', `SELECT r.requisition_number, ri.approved_quantity, SUM(i.quantity) dispatched FROM lg_dispatch_items i JOIN lg_dispatches d ON d.id=i.dispatch_id JOIN requisitions r ON r.id=d.requisition_id JOIN requisition_items ri ON ri.requisition_id=r.id AND ri.drug_id=i.drug_id WHERE d.status<>'cancelled' GROUP BY 1,2 HAVING SUM(i.quantity) > ri.approved_quantity+0.0001 LIMIT 100`],
['A8_TRANSFER_UNACCOUNTED', `SELECT t.transfer_number, t.status, i.batch_number, i.quantity FROM facility_transfers t JOIN facility_transfer_items i ON i.transfer_id=t.id WHERE t.status IN ('received','completed','closed') AND abs(${short})>0.0001 LIMIT 100`],
['A9_REPLACEMENT_OVER_AUTHORISED', `SELECT transfer_id, batch_number, replacement_authorised_quantity FROM facility_transfer_items WHERE replacement_authorised_quantity > COALESCE(damaged_quantity,0)+COALESCE(missing_quantity,0)+0.0001 LIMIT 100`],
['A10_TRANSIT_OUTSTANDING', `SELECT 'dispatch' src, i.batch_number, tb.quantity transit_qty, (${short}) outstanding FROM lg_dispatch_items i JOIN batches tb ON tb.id=i.transit_batch_id WHERE abs(tb.quantity-(${short}))>0.0001 UNION ALL SELECT 'transfer', i.batch_number, tb.quantity, (${short}) FROM facility_transfer_items i JOIN batches tb ON tb.id=i.transit_batch_id WHERE abs(tb.quantity-(${short}))>0.0001 LIMIT 100`],
['A11_DAMAGE_DECISIONS', `SELECT dd.batch_number, dd.quantity, dd.disposition FROM damage_dispositions dd LEFT JOIN batches b ON b.id=dd.batch_id WHERE dd.quantity<=0 OR b.id IS NULL OR b.healthcare_centre_id IS DISTINCT FROM dd.healthcare_centre_id LIMIT 100`],
['A12_DUPLICATE_MOVEMENTS', `SELECT batch_id, movement_type, correlation_id, count(*) copies FROM stock_movements WHERE correlation_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1 LIMIT 100`],
['A13_STALE_RETURN_LOTS', `SELECT b.batch_number, b.status, b.quantity FROM batches b WHERE b.batch_number LIKE '%-R' AND b.quantity>0.0001 AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.batch_id=b.id) LIMIT 100`]
];
(async () => {
  let bad = 0;
  for (const [id, sql] of checks) {
    let rows;
    try { rows = (await pool.query(sql)).rows; }
    catch (e) { console.log(id + ' ERROR ' + e.message.slice(0, 140)); bad++; continue; }
    if (!rows.length) { console.log(id + ' ok'); continue; }
    bad++;
    console.log(id + ' FAIL ' + rows.length);
    rows.slice(0, 3).forEach((r) => console.log('  ' + JSON.stringify(r)));
  }
  console.log(bad ? 'LEDGER_AUDIT_FAIL ' + bad : 'LEDGER_AUDIT_PASS');
  await pool.end();
})().catch(async (e) => { console.log('AUDIT_ERROR ' + e.message); await pool.end(); process.exit(1); });

const { query } = require('../../database/connection');

const findDrugs = async (client, healthcareCentreId, drugIds) => {
  const { rows } = await client.query(
    `SELECT id, code, name, unit_of_measure, is_active
       FROM drugs
      WHERE healthcare_centre_id = $1 AND id = ANY($2::uuid[])`,
    [healthcareCentreId, drugIds]
  );
  return rows;
};

const lockEligibleBatches = async (client, { healthcareCentreId, drugId }) => {
  const { rows } = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.received_date, b.quantity, b.unit_cost, b.status
       FROM batches b
      WHERE b.healthcare_centre_id = $1
        AND b.drug_id = $2
        AND b.status = 'usable'
        AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
        AND b.quantity > 0
      ORDER BY b.expiry_date ASC NULLS LAST, b.received_date ASC, b.created_at ASC
      FOR UPDATE`,
    [healthcareCentreId, drugId]
  );
  return rows;
};

const setBatchQuantity = async (client, { batchId, quantity }) => {
  await client.query(
    'UPDATE batches SET quantity = $2, updated_at = now() WHERE id = $1',
    [batchId, quantity]
  );
};

const insertDispensingRecord = async (client, record) => {
  const { rows } = await client.query(
    `INSERT INTO dispensing_records (healthcare_centre_id, reference, note, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [record.healthcareCentreId, record.reference, record.note || null, record.actorId, record.actorName]
  );
  return rows[0];
};

const insertDispensingItem = async (client, item) => {
  await client.query(
    `INSERT INTO dispensing_items (dispensing_record_id, drug_id, batch_id, quantity)
     VALUES ($1, $2, $3, $4)`,
    [item.dispensingRecordId, item.drugId, item.batchId, item.quantity]
  );
};

const insertMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason, actor_user_id, actor_full_name,
        source_reference, dispensing_record_id)
     VALUES ($1, $2, $3, 'dispensing', $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.dispensingRecordId
    ]
  );
};

const listRecords = async ({ healthcareCentreId, search, from, to, limit, offset }) => {
  const params = [healthcareCentreId, search || null, from || null, to || null];
  const { rows } = await query(
    `SELECT r.id, r.reference, r.note, r.created_by, r.created_by_name, r.created_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM dispensing_records r
       LEFT JOIN (
         SELECT dispensing_record_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM dispensing_items
          GROUP BY dispensing_record_id
       ) items ON items.dispensing_record_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.reference ILIKE '%' || $2 || '%' OR r.note ILIKE '%' || $2 || '%')
        AND ($3::date IS NULL OR r.created_at::date >= $3)
        AND ($4::date IS NULL OR r.created_at::date <= $4)
      ORDER BY r.created_at DESC
      LIMIT $5 OFFSET $6`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM dispensing_records r
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.reference ILIKE '%' || $2 || '%' OR r.note ILIKE '%' || $2 || '%')
        AND ($3::date IS NULL OR r.created_at::date >= $3)
        AND ($4::date IS NULL OR r.created_at::date <= $4)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findRecord = async (healthcareCentreId, recordId) => {
  const { rows } = await query(
    'SELECT * FROM dispensing_records WHERE healthcare_centre_id = $1 AND id = $2',
    [healthcareCentreId, recordId]
  );
  return rows[0] || null;
};

const listRecordItems = async (recordId) => {
  const { rows } = await query(
    `SELECT di.id, di.quantity, di.batch_id, di.drug_id,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.expiry_date
       FROM dispensing_items di
       JOIN drugs d ON d.id = di.drug_id
       JOIN batches b ON b.id = di.batch_id
      WHERE di.dispensing_record_id = $1
      ORDER BY d.name, b.expiry_date ASC NULLS LAST`,
    [recordId]
  );
  return rows;
};

module.exports = {
  findDrugs,
  lockEligibleBatches,
  setBatchQuantity,
  insertDispensingRecord,
  insertDispensingItem,
  insertMovement,
  listRecords,
  findRecord,
  listRecordItems
};

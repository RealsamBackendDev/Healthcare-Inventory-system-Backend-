const { query } = require('../../database/connection');

const findActiveDrugs = async (client, healthcareCentreId, drugIds) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `SELECT id, code, name, unit_of_measure, is_active
       FROM drugs
      WHERE healthcare_centre_id = $1 AND id = ANY($2::uuid[])`,
    [healthcareCentreId, drugIds]
  );
  return rows;
};

const listActiveDrugCatalogue = async (healthcareCentreId) => {
  const { rows } = await query(
    'SELECT id, code, name, unit_of_measure FROM drugs WHERE healthcare_centre_id = $1 AND is_active = TRUE',
    [healthcareCentreId]
  );
  return rows;
};

const findBatchForUpdate = async (client, { healthcareCentreId, drugId, batchNumber }) => {
  const { rows } = await client.query(
    `SELECT id, batch_number, expiry_date, quantity, unit_cost, received_date, supplier_reference, status
       FROM batches
      WHERE healthcare_centre_id = $1 AND drug_id = $2 AND lower(batch_number) = lower($3)
      FOR UPDATE`,
    [healthcareCentreId, drugId, batchNumber]
  );
  return rows[0] || null;
};

const insertBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, drug_id, batch_number, expiry_date, quantity, unit_cost, received_date, supplier_reference, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, 'usable')
     RETURNING id, batch_number, expiry_date, quantity, unit_cost, received_date, supplier_reference, status`,
    [
      batch.healthcareCentreId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.receivedDate || null,
      batch.supplierReference || null
    ]
  );
  return rows[0];
};

const updateBatchAfterReceipt = async (client, { batchId, quantity, unitCost, expiryDate, supplierReference }) => {
  const { rows } = await client.query(
    `UPDATE batches
        SET quantity = $2,
            unit_cost = COALESCE($3, unit_cost),
            expiry_date = COALESCE($4::date, expiry_date),
            supplier_reference = COALESCE($5, supplier_reference),
            updated_at = now()
      WHERE id = $1
      RETURNING id, batch_number, expiry_date, quantity, unit_cost, received_date, supplier_reference, status`,
    [batchId, quantity, unitCost === undefined ? null : unitCost, expiryDate || null, supplierReference || null]
  );
  return rows[0];
};

const insertReceipt = async (client, receipt) => {
  const { rows } = await client.query(
    `INSERT INTO receipts
       (healthcare_centre_id, receipt_reference, supplier, source, received_date, total_items, note, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8, $9)
     RETURNING *`,
    [
      receipt.healthcareCentreId,
      receipt.receiptReference,
      receipt.supplier || null,
      receipt.source || 'manual',
      receipt.receivedDate || null,
      receipt.totalItems,
      receipt.note || null,
      receipt.actorId,
      receipt.actorName
    ]
  );
  return rows[0];
};

const insertReceiptItem = async (client, item) => {
  await client.query(
    `INSERT INTO receipt_items
       (receipt_id, drug_id, batch_id, batch_number, quantity, unit_cost, expiry_date, received_date, supplier_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, COALESCE($8::date, CURRENT_DATE), $9)`,
    [
      item.receiptId,
      item.drugId,
      item.batchId,
      item.batchNumber,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost,
      item.expiryDate || null,
      item.receivedDate || null,
      item.supplierReference || null
    ]
  );
};

const insertMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason, actor_user_id, actor_full_name,
        source_reference, receipt_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.movementType,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.receiptId || null
    ]
  );
};

const listReceipts = async ({ healthcareCentreId, search, from, to, limit, offset }) => {
  const params = [healthcareCentreId, search || null, from || null, to || null];
  const { rows } = await query(
    `SELECT r.id, r.receipt_reference, r.supplier, r.source, r.received_date, r.total_items, r.note,
            r.created_by, r.created_by_name, r.created_at,
            COALESCE(items.quantity, 0) AS total_quantity
       FROM receipts r
       LEFT JOIN (
         SELECT receipt_id, SUM(quantity) AS quantity FROM receipt_items GROUP BY receipt_id
       ) items ON items.receipt_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.receipt_reference ILIKE '%' || $2 || '%' OR r.supplier ILIKE '%' || $2 || '%')
        AND ($3::date IS NULL OR r.received_date >= $3)
        AND ($4::date IS NULL OR r.received_date <= $4)
      ORDER BY r.created_at DESC
      LIMIT $5 OFFSET $6`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM receipts r
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.receipt_reference ILIKE '%' || $2 || '%' OR r.supplier ILIKE '%' || $2 || '%')
        AND ($3::date IS NULL OR r.received_date >= $3)
        AND ($4::date IS NULL OR r.received_date <= $4)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findReceipt = async (healthcareCentreId, receiptId) => {
  const { rows } = await query(
    'SELECT * FROM receipts WHERE healthcare_centre_id = $1 AND id = $2',
    [healthcareCentreId, receiptId]
  );
  return rows[0] || null;
};

const listReceiptItems = async (receiptId) => {
  const { rows } = await query(
    `SELECT ri.id, ri.quantity, ri.unit_cost, ri.expiry_date, ri.received_date, ri.supplier_reference,
            ri.batch_number, ri.batch_id, d.id AS drug_id, d.code AS drug_code, d.name AS drug_name,
            d.unit_of_measure, b.status AS batch_status
       FROM receipt_items ri
       JOIN drugs d ON d.id = ri.drug_id
       JOIN batches b ON b.id = ri.batch_id
      WHERE ri.receipt_id = $1
      ORDER BY d.name`,
    [receiptId]
  );
  return rows;
};

module.exports = {
  findActiveDrugs,
  listActiveDrugCatalogue,
  findBatchForUpdate,
  insertBatch,
  updateBatchAfterReceipt,
  insertReceipt,
  insertReceiptItem,
  insertMovement,
  listReceipts,
  findReceipt,
  listReceiptItems
};

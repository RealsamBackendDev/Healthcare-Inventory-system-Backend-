const { query } = require('../../database/connection');

const findCentre = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT hc.id, hc.name, hc.code, hc.local_government_id
       FROM healthcare_centres hc
      WHERE hc.id = $1 AND hc.is_active = TRUE`,
    [healthcareCentreId]
  );
  return rows[0] || null;
};

const findFacilityLocation = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT id, local_government_id, healthcare_centre_id, name, code
       FROM stock_locations
      WHERE healthcare_centre_id = $1
        AND location_type = 'facility'
        AND is_active = TRUE
      LIMIT 1`,
    [healthcareCentreId]
  );
  return rows[0] || null;
};

const listNeighbourFacilities = async (localGovernmentId, excludeCentreId) => {
  const { rows } = await query(
    `SELECT hc.id, hc.name, hc.code,
            COALESCE(SUM(b.quantity), 0)::float AS total_quantity,
            count(DISTINCT b.drug_id)::int AS drug_count
       FROM healthcare_centres hc
       LEFT JOIN stock_locations sl ON sl.healthcare_centre_id = hc.id AND sl.location_type = 'facility'
       LEFT JOIN batches b ON b.stock_location_id = sl.id AND b.status = 'usable' AND b.quantity > 0
      WHERE hc.local_government_id = $1
        AND hc.is_active = TRUE
        AND hc.id <> $2
      GROUP BY hc.id, hc.name, hc.code
      ORDER BY hc.name`,
    [localGovernmentId, excludeCentreId]
  );
  return rows;
};

const listFacilityStock = async (stockLocationId) => {
  const { rows } = await query(
    `SELECT d.id AS drug_id, d.code, d.name, d.unit_of_measure,
            COALESCE(SUM(b.quantity), 0)::float AS quantity
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.stock_location_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND d.is_active = TRUE
      GROUP BY d.id, d.code, d.name, d.unit_of_measure
      ORDER BY d.name`,
    [stockLocationId]
  );
  return rows;
};

const findDrugs = async (localGovernmentId, drugIds) => {
  if (drugIds.length === 0) {
    return [];
  }
  const { rows } = await query(
    `SELECT id, code, name, unit_of_measure, is_active
       FROM drugs
      WHERE local_government_id = $1 AND id = ANY($2::uuid[])`,
    [localGovernmentId, drugIds]
  );
  return rows;
};

const lockAvailableBatches = async (client, stockLocationId, drugId) => {
  const { rows } = await client.query(
    `SELECT id, batch_number, expiry_date, quantity, unit_cost
       FROM batches
      WHERE stock_location_id = $1
        AND drug_id = $2
        AND status = 'usable'
        AND quantity > 0
        AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
      ORDER BY expiry_date NULLS LAST, received_date, created_at
      FOR UPDATE`,
    [stockLocationId, drugId]
  );
  return rows;
};

const decrementBatch = async (client, batchId, quantity) => {
  const { rows } = await client.query(
    `UPDATE batches
        SET quantity = quantity - $2,
            updated_at = now()
      WHERE id = $1 AND quantity >= $2
      RETURNING id, quantity`,
    [batchId, quantity]
  );
  return rows[0] || null;
};

const incrementBatch = async (client, batchId, quantity) => {
  await client.query(
    'UPDATE batches SET quantity = quantity + $2, updated_at = now() WHERE id = $1',
    [batchId, quantity]
  );
};

const insertInboundBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'usable')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   expiry_date = COALESCE(EXCLUDED.expiry_date, batches.expiry_date),
                   updated_at = now()
     RETURNING id`,
    [
      batch.healthcareCentreId,
      batch.localGovernmentId,
      batch.stockLocationId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.supplierReference || null
    ]
  );
  return rows[0];
};

const insertMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.movementType,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null
    ]
  );
};

const insertRequest = async (client, request) => {
  const { rows } = await client.query(
    `INSERT INTO facility_transfers
       (local_government_id, transfer_number, status, from_healthcare_centre_id, from_centre_name,
        to_healthcare_centre_id, to_centre_name, notes, item_count, total_quantity,
        created_by, created_by_name, request_note, requested_by, requested_by_name, requested_at)
     VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $10, $11, now())
     RETURNING *`,
    [
      request.localGovernmentId,
      request.transferNumber,
      request.fromCentreId,
      request.fromCentreName,
      request.toCentreId,
      request.toCentreName,
      request.notes || null,
      request.itemCount,
      request.totalQuantity,
      request.actorId,
      request.actorName,
      request.requestNote || null
    ]
  );
  return rows[0];
};

const insertRequestItem = async (client, item) => {
  await client.query(
    `INSERT INTO facility_transfer_request_items (transfer_id, drug_id, quantity)
     VALUES ($1, $2, $3)`,
    [item.transferId, item.drugId, item.quantity]
  );
};

const listRequestItems = async (executor, transferId) => {
  const { rows } = await executor.query(
    `SELECT ri.id, ri.drug_id, ri.quantity::float AS quantity,
            d.code, d.name, d.unit_of_measure
       FROM facility_transfer_request_items ri
       JOIN drugs d ON d.id = ri.drug_id
      WHERE ri.transfer_id = $1
      ORDER BY d.name`,
    [transferId]
  );
  return rows;
};

const insertTransferLine = async (client, line) => {
  await client.query(
    `INSERT INTO facility_transfer_items
       (transfer_id, drug_id, source_batch_id, batch_number, expiry_date, quantity, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      line.transferId,
      line.drugId,
      line.sourceBatchId,
      line.batchNumber,
      line.expiryDate || null,
      line.quantity,
      line.unitCost === null || line.unitCost === undefined ? null : line.unitCost
    ]
  );
};

const listTransferLines = async (executor, transferId) => {
  const { rows } = await executor.query(
    `SELECT ti.drug_id, ti.source_batch_id, ti.batch_number, ti.expiry_date,
            ti.quantity::float AS quantity, ti.unit_cost,
            d.code, d.name, d.unit_of_measure
       FROM facility_transfer_items ti
       JOIN drugs d ON d.id = ti.drug_id
      WHERE ti.transfer_id = $1
      ORDER BY d.name`,
    [transferId]
  );
  return rows;
};

const findRequest = async (executor, transferId) => {
  const { rows } = await executor.query(
    `SELECT * FROM facility_transfers WHERE id = $1`,
    [transferId]
  );
  return rows[0] || null;
};

const lockRequest = async (client, transferId) => {
  const { rows } = await client.query(
    'SELECT * FROM facility_transfers WHERE id = $1 FOR UPDATE',
    [transferId]
  );
  return rows[0] || null;
};

const listOutgoingRequests = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT * FROM facility_transfers
      WHERE to_healthcare_centre_id = $1
        AND requested_at IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 50`,
    [healthcareCentreId]
  );
  return rows;
};

const listIncomingRequests = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT * FROM facility_transfers
      WHERE from_healthcare_centre_id = $1
        AND status = 'requested'
      ORDER BY created_at ASC
      LIMIT 50`,
    [healthcareCentreId]
  );
  return rows;
};

const setRequestApproved = async (client, request) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = 'in_transit',
            item_count = $2,
            total_quantity = $3,
            decided_by = $4,
            decided_by_name = $5,
            decided_at = now(),
            decision_note = $6,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      request.transferId,
      request.itemCount,
      request.totalQuantity,
      request.actorId,
      request.actorName,
      request.note || null
    ]
  );
  return rows[0];
};

const setRequestDeclined = async (client, request) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = 'declined',
            decided_by = $2,
            decided_by_name = $3,
            decided_at = now(),
            decision_note = $4,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [request.transferId, request.actorId, request.actorName, request.note || null]
  );
  return rows[0];
};

const setRequestReceived = async (client, request) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = 'received',
            received_by = $2,
            received_by_name = $3,
            received_at = now(),
            received_note = $4,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [request.transferId, request.actorId, request.actorName, request.note || null]
  );
  return rows[0];
};

const cancelRequest = async (client, request) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = 'cancelled',
            cancelled_by = $2,
            cancelled_by_name = $3,
            cancelled_at = now(),
            cancel_reason = $4,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [request.transferId, request.actorId, request.actorName, request.note || null]
  );
  return rows[0];
};

module.exports = {
  findCentre,
  findFacilityLocation,
  listNeighbourFacilities,
  listFacilityStock,
  findDrugs,
  lockAvailableBatches,
  decrementBatch,
  incrementBatch,
  insertInboundBatch,
  insertMovement,
  insertRequest,
  insertRequestItem,
  listRequestItems,
  insertTransferLine,
  listTransferLines,
  findRequest,
  lockRequest,
  listOutgoingRequests,
  listIncomingRequests,
  setRequestApproved,
  setRequestDeclined,
  setRequestReceived,
  cancelRequest
};

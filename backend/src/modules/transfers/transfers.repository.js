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
       (transfer_id, drug_id, source_batch_id, batch_number, expiry_date, quantity, unit_cost, transit_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      line.transferId,
      line.drugId,
      line.sourceBatchId,
      line.batchNumber,
      line.expiryDate || null,
      line.quantity,
      line.unitCost === null || line.unitCost === undefined ? null : line.unitCost,
      line.transitBatchId || null
    ]
  );
};

const listTransferLines = async (executor, transferId) => {
  const { rows } = await executor.query(
    `SELECT ti.id, ti.drug_id, ti.source_batch_id, ti.transit_batch_id, ti.batch_number, ti.expiry_date,
            ti.quantity::float AS quantity, ti.unit_cost,
            ti.accepted_quantity, ti.damaged_quantity, ti.missing_quantity,
            ti.discrepancy_status, ti.discrepancy_resolution, ti.discrepancy_note,
            ti.replacement_authorised_quantity, ti.replacement_transfer_id,
            rt.transfer_number AS replacement_transfer_number,
            d.code, d.name, d.unit_of_measure
       FROM facility_transfer_items ti
       JOIN drugs d ON d.id = ti.drug_id
       LEFT JOIN facility_transfers rt ON rt.id = ti.replacement_transfer_id
      WHERE ti.transfer_id = $1
      ORDER BY d.name, ti.batch_number`,
    [transferId]
  );
  return rows;
};

const insertQuarantineBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'quarantined')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
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

const updateTransferLineReceipt = async (client, entry) => {
  const { rows } = await client.query(
    `UPDATE facility_transfer_items
        SET accepted_quantity = accepted_quantity + $2,
            damaged_quantity = damaged_quantity + $3,
            missing_quantity = missing_quantity + $4
      WHERE id = $1
      RETURNING accepted_quantity, damaged_quantity, missing_quantity`,
    [entry.lineId, entry.acceptedQuantity, entry.damagedQuantity, entry.missingQuantity]
  );
  return rows[0] || null;
};

const openTransferLineDiscrepancy = async (client, entry) => {
  await client.query(
    `UPDATE facility_transfer_items
        SET discrepancy_status = 'open',
            discrepancy_note = COALESCE($2, discrepancy_note)
      WHERE id = $1
        AND discrepancy_status = 'none'`,
    [entry.lineId, entry.reason || null]
  );
};

const insertTransferReceipt = async (client, receipt) => {
  const { rows } = await client.query(
    `INSERT INTO facility_transfer_receipts
       (local_government_id, healthcare_centre_id, transfer_id, note,
        accepted_quantity, damaged_quantity, missing_quantity, received_by, received_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      receipt.localGovernmentId,
      receipt.healthcareCentreId,
      receipt.transferId,
      receipt.note || null,
      receipt.acceptedQuantity,
      receipt.damagedQuantity,
      receipt.missingQuantity,
      receipt.actorId,
      receipt.actorName
    ]
  );
  return rows[0];
};

const insertTransferReceiptItem = async (client, item) => {
  await client.query(
    `INSERT INTO facility_transfer_receipt_items
       (receipt_id, transfer_item_id, drug_id,
        accepted_quantity, damaged_quantity, missing_quantity, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      item.receiptId,
      item.lineId,
      item.drugId,
      item.acceptedQuantity,
      item.damagedQuantity,
      item.missingQuantity,
      item.reason || null
    ]
  );
};

const listTransferReceipts = async (executor, transferId) => {
  const { rows } = await executor.query(
    `SELECT id, note, accepted_quantity::float AS accepted_quantity,
            damaged_quantity::float AS damaged_quantity, missing_quantity::float AS missing_quantity,
            received_by_name, received_at
       FROM facility_transfer_receipts
      WHERE transfer_id = $1
      ORDER BY received_at, created_at`,
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

const lockShortageLine = async (client, transferId, lineId) => {
  const { rows } = await client.query(
    `SELECT ti.id, ti.drug_id, ti.quantity::float AS quantity, ti.transit_batch_id,
            ti.missing_quantity::float AS missing_quantity, ti.damaged_quantity::float AS damaged_quantity,
            ti.discrepancy_status, d.name, d.code, d.unit_of_measure
       FROM facility_transfer_items ti
       JOIN drugs d ON d.id = ti.drug_id
      WHERE ti.id = $1
        AND ti.transfer_id = $2
      FOR UPDATE OF ti`,
    [lineId, transferId]
  );
  return rows[0] || null;
};

const resolveShortageLine = async (client, entry) => {
  const { rows } = await client.query(
    `UPDATE facility_transfer_items
        SET discrepancy_status = 'resolved',
            discrepancy_resolution = $2,
            discrepancy_note = $3,
            replacement_authorised_quantity = $4,
            replacement_transfer_id = $5,
            resolved_at = now(),
            resolved_by = $6,
            resolved_by_name = $7
      WHERE id = $1
      RETURNING id, discrepancy_status, discrepancy_resolution, replacement_authorised_quantity,
                replacement_transfer_id, resolved_at, resolved_by_name`,
    [
      entry.lineId,
      entry.resolution,
      entry.note,
      entry.replacementQuantity || 0,
      entry.replacementTransferId || null,
      entry.actorId,
      entry.actorName
    ]
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
    `SELECT ft.*,
            (SELECT count(*)::int FROM facility_transfer_items ti
              WHERE ti.transfer_id = ft.id
                AND ti.discrepancy_status = 'open') AS open_discrepancies
       FROM facility_transfers ft
      WHERE ft.to_healthcare_centre_id = $1
        AND ft.requested_at IS NOT NULL
      ORDER BY ft.created_at DESC
      LIMIT 50`,
    [healthcareCentreId]
  );
  return rows;
};

const listIncomingRequests = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT ft.*,
            (SELECT count(*)::int FROM facility_transfer_items ti
              WHERE ti.transfer_id = ft.id
                AND ti.discrepancy_status = 'open') AS open_discrepancies
       FROM facility_transfers ft
      WHERE ft.from_healthcare_centre_id = $1
        AND ft.status = 'requested'
      ORDER BY ft.created_at ASC
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

const setRequestPartiallyReceived = async (client, request) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = 'partially_received',
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
  insertQuarantineBatch,
  insertMovement,
  updateTransferLineReceipt,
  openTransferLineDiscrepancy,
  insertTransferReceipt,
  insertTransferReceiptItem,
  listTransferReceipts,
  lockShortageLine,
  resolveShortageLine,
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
  setRequestPartiallyReceived,
  setRequestReceived,
  cancelRequest
};

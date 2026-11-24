const { query } = require('../../database/connection');
const { ConflictError } = require('../../shared/errors/AppError');

const findWarehouse = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT id, name, code
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'lg_warehouse'
        AND is_active = TRUE`,
    [localGovernmentId]
  );
  return rows[0] || null;
};

const findFacilityLocation = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT id, local_government_id
       FROM stock_locations
      WHERE healthcare_centre_id = $1
        AND location_type = 'facility'
        AND is_active = TRUE`,
    [healthcareCentreId]
  );
  return rows[0] || null;
};

const warehouseStock = async ({ localGovernmentId, warehouseId, search }) => {
  const { rows } = await query(
    `SELECT d.id AS drug_id, d.code, d.name, d.unit_of_measure,
            COALESCE(SUM(b.quantity), 0) AS usable_quantity,
            count(b.id)::int AS batch_count,
            MIN(b.expiry_date) AS nearest_expiry
       FROM drugs d
       LEFT JOIN batches b
              ON b.drug_id = d.id
             AND b.stock_location_id = $2
             AND b.status = 'usable'
             AND b.quantity > 0
             AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
      WHERE d.local_government_id = $1
        AND d.is_active = TRUE
        AND ($3::text IS NULL OR d.name ILIKE '%' || $3 || '%' OR d.code ILIKE '%' || $3 || '%')
      GROUP BY d.id, d.code, d.name, d.unit_of_measure
      ORDER BY d.name`,
    [localGovernmentId, warehouseId, search || null]
  );
  return rows;
};

const warehouseBatches = async ({ warehouseId, drugId }) => {
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.unit_cost, b.received_date,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.stock_location_id = $1
        AND ($2::uuid IS NULL OR b.drug_id = $2)
        AND b.status = 'usable'
        AND b.quantity > 0
      ORDER BY b.expiry_date NULLS LAST, b.received_date, b.created_at`,
    [warehouseId, drugId || null]
  );
  return rows;
};

const findDrugs = async (localGovernmentId, drugIds) => {
  const { rows } = await query(
    `SELECT id, code, name, unit_of_measure, is_active
       FROM drugs
      WHERE local_government_id = $1
        AND id = ANY($2::uuid[])`,
    [localGovernmentId, drugIds]
  );
  return rows;
};

const insertReceipt = async (client, receipt) => {
  const { rows } = await client.query(
    `INSERT INTO lg_receipts
       (local_government_id, receipt_number, supplier_name, supplier_reference, notes, received_by, received_by_name, idempotency_key, order_id, order_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, receipt_number, received_at`,
    [
      receipt.localGovernmentId,
      receipt.receiptNumber,
      receipt.supplierName || null,
      receipt.supplierReference || null,
      receipt.notes || null,
      receipt.actorId,
      receipt.actorName,
      receipt.idempotencyKey || null,
      receipt.orderId || null,
      receipt.orderNumber || null
    ]
  );
  return rows[0];
};

const insertWarehouseBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   expiry_date = COALESCE(batches.expiry_date, EXCLUDED.expiry_date),
                   unit_cost = COALESCE(EXCLUDED.unit_cost, batches.unit_cost),
                   supplier_reference = COALESCE(EXCLUDED.supplier_reference, batches.supplier_reference),
                   updated_at = now()
     WHERE (batches.expiry_date IS NULL
            OR EXCLUDED.expiry_date IS NULL
            OR batches.expiry_date = EXCLUDED.expiry_date)
       AND (batches.unit_cost IS NULL
            OR EXCLUDED.unit_cost IS NULL
            OR batches.unit_cost = EXCLUDED.unit_cost)
     RETURNING id, batch_number, quantity`,
    [
      batch.localGovernmentId,
      batch.warehouseId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.supplierReference || null
    ]
  );
  if (rows.length === 0) {
    throw new ConflictError(
      `Batch ${batch.batchNumber} is already recorded at this warehouse with a different expiry date or unit cost. Use a separate batch number for this delivery, or match the expiry and cost of the existing lot.`,
      'BATCH_LOT_MISMATCH'
    );
  }
  return rows[0];
};

const insertReceiptItem = async (client, item) => {
  await client.query(
    `INSERT INTO lg_receipt_items (receipt_id, drug_id, batch_id, batch_number, expiry_date, quantity, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      item.receiptId,
      item.drugId,
      item.batchId || null,
      item.batchNumber,
      item.expiryDate || null,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost
    ]
  );
};

const listReceipts = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT r.id, r.receipt_number, r.supplier_name, r.supplier_reference, r.received_by_name, r.received_at,
            r.order_number,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM lg_receipts r
       LEFT JOIN (
         SELECT receipt_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM lg_receipt_items
          GROUP BY receipt_id
       ) items ON items.receipt_id = r.id
      WHERE r.local_government_id = $1
      ORDER BY r.received_at DESC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const listRequisitions = async ({ localGovernmentId, status, search, limit, offset }) => {
  const params = [localGovernmentId, status || null, search || null];
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.status, r.source, r.notes, r.review_reason,
            r.created_by_name, r.submitted_at, r.reviewed_by_name, r.reviewed_at, r.created_at,
            hc.id AS healthcare_centre_id, hc.name AS centre_name, hc.code AS centre_code,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity,
            COALESCE(items.approved_quantity, 0) AS approved_total,
            COALESCE(items.replacement_quantity, 0) AS replacement_total,
            COALESCE(items.closed_short_quantity, 0) AS closed_short_total,
            COALESCE(supply.dispatched_quantity, 0) AS dispatched_total,
            COALESCE(supply.accepted_quantity, 0) AS accepted_total,
            COALESCE(supply.in_transit_quantity, 0) AS transit_total,
            COALESCE(supply.missing_quantity, 0) AS missing_total,
            COALESCE(supply.damaged_quantity, 0) AS damaged_total,
            COALESCE(supply.written_off_quantity, 0) AS written_off_total,
            COALESCE(supply.open_quantity, 0) AS open_total
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity,
                SUM(approved_quantity) AS approved_quantity,
                SUM(replacement_authorised_quantity) AS replacement_quantity,
                SUM(closed_short_quantity) AS closed_short_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
       LEFT JOIN (
         SELECT disp.requisition_id,
                SUM(di.quantity) AS dispatched_quantity,
                SUM(di.accepted_quantity) AS accepted_quantity,
                SUM(di.missing_quantity) AS missing_quantity,
                SUM(di.rejected_quantity) AS rejected_quantity,
                SUM(di.damaged_quantity) AS damaged_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'resolved' AND di.discrepancy_resolution = 'written_off'
                         THEN di.missing_quantity + di.rejected_quantity + di.damaged_quantity ELSE 0 END) AS written_off_quantity,
                SUM(CASE WHEN disp.status IN ('dispatched', 'partially_received')
                         THEN di.quantity - di.accepted_quantity - di.damaged_quantity
                              - di.missing_quantity - di.rejected_quantity
                         ELSE 0 END) AS in_transit_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'open'
                         THEN di.missing_quantity + di.rejected_quantity + di.damaged_quantity
                         ELSE 0 END) AS open_quantity
           FROM lg_dispatch_items di
           JOIN lg_dispatches disp ON disp.id = di.dispatch_id
          WHERE disp.status <> 'cancelled'
          GROUP BY disp.requisition_id
       ) supply ON supply.requisition_id = r.id
      WHERE r.local_government_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::text IS NULL OR r.requisition_number ILIKE '%' || $3 || '%'
             OR hc.name ILIKE '%' || $3 || '%')
      ORDER BY r.created_at DESC
      LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
      WHERE r.local_government_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::text IS NULL OR r.requisition_number ILIKE '%' || $3 || '%'
             OR hc.name ILIKE '%' || $3 || '%')`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findRequisition = async (localGovernmentId, requisitionId) => {
  const { rows } = await query(
    `SELECT r.*, hc.name AS centre_name, hc.code AS centre_code
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
      WHERE r.local_government_id = $1
        AND r.id = $2`,
    [localGovernmentId, requisitionId]
  );
  return rows[0] || null;
};

const lockRequisition = async (client, localGovernmentId, requisitionId) => {
  const { rows } = await client.query(
    `SELECT r.*, hc.name AS centre_name, hc.code AS centre_code
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
      WHERE r.local_government_id = $1
        AND r.id = $2
        FOR UPDATE OF r`,
    [localGovernmentId, requisitionId]
  );
  return rows[0] || null;
};

const listRequisitionItems = async (requisitionId) => {
  const { rows } = await query(
    `SELECT ri.id, ri.drug_id, ri.requested_quantity, ri.approved_quantity, ri.suggested_quantity,
            ri.replacement_authorised_quantity, ri.closed_short_quantity,
            ri.is_auto_generated,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            COALESCE(agg.dispatched_quantity, 0) AS dispatched_quantity,
            COALESCE(agg.accepted_quantity, 0) AS accepted_quantity,
            COALESCE(agg.damaged_quantity, 0) AS damaged_quantity,
            COALESCE(agg.missing_quantity, 0) AS missing_quantity,
            COALESCE(agg.rejected_quantity, 0) AS rejected_quantity,
            COALESCE(agg.written_off_quantity, 0) AS written_off_quantity,
            COALESCE(agg.open_quantity, 0) AS open_quantity,
            COALESCE(agg.in_transit_quantity, 0) AS in_transit_quantity
       FROM requisition_items ri
       JOIN drugs d ON d.id = ri.drug_id
       LEFT JOIN (
         SELECT di.drug_id, disp.requisition_id,
                SUM(di.quantity) AS dispatched_quantity,
                SUM(di.accepted_quantity) AS accepted_quantity,
                SUM(di.damaged_quantity) AS damaged_quantity,
                SUM(di.missing_quantity) AS missing_quantity,
                SUM(di.rejected_quantity) AS rejected_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'resolved' AND di.discrepancy_resolution = 'written_off'
                         THEN di.missing_quantity + di.rejected_quantity + di.damaged_quantity ELSE 0 END) AS written_off_quantity,
                SUM(CASE WHEN disp.status IN ('dispatched', 'partially_received')
                         THEN di.quantity - di.accepted_quantity - di.damaged_quantity
                              - di.missing_quantity - di.rejected_quantity
                         ELSE 0 END) AS in_transit_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'open'
                         THEN di.missing_quantity + di.rejected_quantity + di.damaged_quantity
                         ELSE 0 END) AS open_quantity
           FROM lg_dispatch_items di
           JOIN lg_dispatches disp ON disp.id = di.dispatch_id
          WHERE disp.status <> 'cancelled'
          GROUP BY di.drug_id, disp.requisition_id
       ) agg ON agg.drug_id = ri.drug_id AND agg.requisition_id = ri.requisition_id
      WHERE ri.requisition_id = $1
      ORDER BY d.name`,
    [requisitionId]
  );
  return rows;
};

const listRequisitionEvents = async (requisitionId) => {
  const { rows } = await query(
    `SELECT id, event_type, actor_full_name, comment, created_at
       FROM requisition_events
      WHERE requisition_id = $1
      ORDER BY created_at ASC`,
    [requisitionId]
  );
  return rows;
};

const insertRequisitionEvent = async (client, event) => {
  await client.query(
    `INSERT INTO requisition_events (requisition_id, event_type, actor_user_id, actor_full_name, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.requisitionId, event.eventType, event.actorId, event.actorName, event.comment || null]
  );
};

const markReviewed = async (client, { localGovernmentId, requisitionId, status, actorId, actorName, reason }) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = $3, reviewed_by = $4, reviewed_by_name = $5, reviewed_at = now(),
            review_reason = $6, updated_at = now()
      WHERE local_government_id = $1
        AND id = $2
      RETURNING *`,
    [localGovernmentId, requisitionId, status, actorId, actorName, reason || null]
  );
  return rows[0];
};

const updateApprovedQuantities = async (client, { requisitionId, items }) => {
  for (const item of items) {
    await client.query(
      `UPDATE requisition_items
          SET approved_quantity = $3
        WHERE requisition_id = $1
          AND drug_id = $2`,
      [requisitionId, item.drugId, item.approvedQuantity]
    );
  }
};

const lockAvailableBatches = async (client, warehouseId, drugId) => {
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
    [warehouseId, drugId]
  );
  return rows;
};

const decrementBatch = async (client, batchId, quantity) => {
  const { rows } = await client.query(
    `UPDATE batches
        SET quantity = quantity - $2, updated_at = now()
      WHERE id = $1
        AND quantity >= $2
      RETURNING id, quantity`,
    [batchId, quantity]
  );
  return rows[0] || null;
};

const findDispatchByKey = async (localGovernmentId, idempotencyKey) => {
  const { rows } = await query(
    `SELECT id FROM lg_dispatches
      WHERE local_government_id = $1
        AND idempotency_key = $2
      LIMIT 1`,
    [localGovernmentId, idempotencyKey]
  );
  return rows[0] || null;
};

const insertDispatch = async (client, dispatch) => {
  const { rows } = await client.query(
    `INSERT INTO lg_dispatches
       (local_government_id, requisition_id, healthcare_centre_id, dispatch_number, status, notes,
        dispatched_by, dispatched_by_name, idempotency_key)
     VALUES ($1, $2, $3, $4, 'dispatched', $5, $6, $7, $8)
     RETURNING id, dispatch_number, dispatched_at`,
    [
      dispatch.localGovernmentId,
      dispatch.requisitionId,
      dispatch.healthcareCentreId,
      dispatch.dispatchNumber,
      dispatch.notes || null,
      dispatch.actorId,
      dispatch.actorName,
      dispatch.idempotencyKey || null
    ]
  );
  return rows[0];
};

const insertDispatchItem = async (client, item) => {
  const { rows } = await client.query(
    `INSERT INTO lg_dispatch_items
       (dispatch_id, drug_id, batch_id, batch_number, expiry_date, quantity, unit_cost, transit_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      item.dispatchId,
      item.drugId,
      item.batchId || null,
      item.batchNumber,
      item.expiryDate || null,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost,
      item.transitBatchId || null
    ]
  );
  return rows[0];
};

const listDispatches = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT d.id, d.dispatch_number, d.status, d.notes, d.dispatched_by_name, d.dispatched_at,
            d.received_by_name, d.received_at, d.requisition_id,
            hc.name AS centre_name, hc.code AS centre_code,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
       LEFT JOIN (
         SELECT dispatch_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM lg_dispatch_items
          GROUP BY dispatch_id
       ) items ON items.dispatch_id = d.id
      WHERE d.local_government_id = $1
      ORDER BY d.dispatched_at DESC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const findDispatch = async (localGovernmentId, dispatchId) => {
  const { rows } = await query(
    `SELECT d.*, hc.name AS centre_name, hc.code AS centre_code
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
      WHERE d.local_government_id = $1
        AND d.id = $2`,
    [localGovernmentId, dispatchId]
  );
  return rows[0] || null;
};

const listDispatchItems = async (dispatchId) => {
  const { rows } = await query(
    `SELECT di.id, di.drug_id, di.batch_id, di.batch_number, di.expiry_date, di.quantity, di.unit_cost,
            di.transit_batch_id, di.accepted_quantity, di.damaged_quantity, di.missing_quantity,
            di.rejected_quantity, di.discrepancy_reason,
            di.discrepancy_status, di.discrepancy_resolution, di.discrepancy_note,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure
       FROM lg_dispatch_items di
       JOIN drugs d ON d.id = di.drug_id
      WHERE di.dispatch_id = $1
      ORDER BY d.name`,
    [dispatchId]
  );
  return rows;
};

const findDeliveryForRequisition = async (healthcareCentreId, requisitionId) => {
  const { rows } = await query(
    `SELECT d.*, hc.name AS centre_name
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
      WHERE d.healthcare_centre_id = $1
        AND d.requisition_id = $2
        AND d.status IN ('dispatched', 'partially_received', 'received')
      ORDER BY d.dispatched_at DESC
      LIMIT 1`,
    [healthcareCentreId, requisitionId]
  );
  return rows[0] || null;
};

const lockDispatchForRequisition = async (client, healthcareCentreId, requisitionId) => {
  const { rows } = await client.query(
    `SELECT *
       FROM lg_dispatches
      WHERE healthcare_centre_id = $1
        AND requisition_id = $2
        AND status IN ('dispatched', 'received')
      ORDER BY dispatched_at DESC
      LIMIT 1
      FOR UPDATE`,
    [healthcareCentreId, requisitionId]
  );
  return rows[0] || null;
};

const findDispatchForCentre = async (healthcareCentreId, dispatchId) => {
  const { rows } = await query(
    `SELECT d.*, hc.name AS centre_name
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
      WHERE d.healthcare_centre_id = $1
        AND d.id = $2`,
    [healthcareCentreId, dispatchId]
  );
  return rows[0] || null;
};

const lockDispatchById = async (client, healthcareCentreId, dispatchId) => {
  const { rows } = await client.query(
    `SELECT d.*, hc.name AS centre_name
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
      WHERE d.healthcare_centre_id = $1
        AND d.id = $2
        FOR UPDATE OF d`,
    [healthcareCentreId, dispatchId]
  );
  return rows[0] || null;
};

const listIncomingDispatches = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT d.id, d.dispatch_number, d.status, d.notes, d.dispatched_by_name, d.dispatched_at,
            d.requisition_id,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity,
            COALESCE(items.pending_quantity, 0) AS pending_quantity
       FROM lg_dispatches d
       LEFT JOIN (
         SELECT dispatch_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity,
                SUM(GREATEST(
                      quantity - accepted_quantity - damaged_quantity - missing_quantity
                        - rejected_quantity, 0)) AS pending_quantity
           FROM lg_dispatch_items
          GROUP BY dispatch_id
       ) items ON items.dispatch_id = d.id
      WHERE d.healthcare_centre_id = $1
        AND d.status IN ('dispatched', 'partially_received')
      ORDER BY d.dispatched_at DESC`,
    [healthcareCentreId]
  );
  return rows;
};

const markDispatchAccounted = async (client, receipt) => {
  const { rows } = await client.query(
    `UPDATE lg_dispatches
        SET status = $2, received_by = $3, received_by_name = $4, received_at = now(),
            received_note = $5, accepted_quantity = $6, damaged_quantity = $7, missing_quantity = $8,
            rejected_quantity = $9
      WHERE id = $1
      RETURNING id, status, accepted_quantity, damaged_quantity, missing_quantity, rejected_quantity,
                received_at`,
    [
      receipt.dispatchId,
      receipt.status,
      receipt.actorId,
      receipt.actorName,
      receipt.note || null,
      receipt.acceptedQuantity,
      receipt.damagedQuantity,
      receipt.missingQuantity,
      receipt.rejectedQuantity || 0
    ]
  );
  return rows[0];
};

const updateDispatchItemReceipt = async (client, item) => {
  const { rows } = await client.query(
    `UPDATE lg_dispatch_items
        SET accepted_quantity = accepted_quantity + $2,
            damaged_quantity = damaged_quantity + $3,
            missing_quantity = missing_quantity + $4,
            rejected_quantity = rejected_quantity + $5,
            discrepancy_reason = COALESCE($6, discrepancy_reason)
      WHERE id = $1
      RETURNING id, drug_id, batch_id, batch_number, expiry_date, quantity, unit_cost,
                accepted_quantity, damaged_quantity, missing_quantity, rejected_quantity`,
    [
      item.itemId,
      item.acceptedQuantity,
      item.damagedQuantity,
      item.missingQuantity,
      item.rejectedQuantity,
      item.reason || null
    ]
  );
  return rows[0] || null;
};

const insertDispatchReceipt = async (client, receipt) => {
  const { rows } = await client.query(
    `INSERT INTO lg_dispatch_receipts
       (local_government_id, healthcare_centre_id, dispatch_id, requisition_id, note,
        received_by, received_by_name, accepted_quantity, damaged_quantity, missing_quantity,
        rejected_quantity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      receipt.localGovernmentId,
      receipt.healthcareCentreId,
      receipt.dispatchId,
      receipt.requisitionId,
      receipt.note || null,
      receipt.actorId,
      receipt.actorName,
      receipt.acceptedQuantity || 0,
      receipt.damagedQuantity || 0,
      receipt.missingQuantity || 0,
      receipt.rejectedQuantity || 0
    ]
  );
  return rows[0];
};

const markRequisitionReceived = async (client, { requisitionId, healthcareCentreId }) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE id = $1
        AND healthcare_centre_id = $2
        AND status = 'approved'
      RETURNING id, requisition_number, status`,
    [requisitionId, healthcareCentreId]
  );
  return rows[0] || null;
};

const insertFacilityBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'usable')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   expiry_date = COALESCE(EXCLUDED.expiry_date, batches.expiry_date),
                   updated_at = now()
     WHERE (batches.expiry_date IS NULL
            OR EXCLUDED.expiry_date IS NULL
            OR batches.expiry_date = EXCLUDED.expiry_date)
       AND (batches.unit_cost IS NULL
            OR EXCLUDED.unit_cost IS NULL
            OR batches.unit_cost = EXCLUDED.unit_cost)
     RETURNING id, batch_number, quantity`,
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
  if (rows.length === 0) {
    throw new ConflictError(
      `Batch ${batch.batchNumber} is already recorded in this store with a different expiry date or unit cost. Please use a separate batch number or match the existing lot.`,
      'BATCH_LOT_MISMATCH'
    );
  }
  return rows[0];
};

const insertApproval = async (client, approval) => {
  const { rows } = await client.query(
    `INSERT INTO lg_threshold_approvals
       (local_government_id, approval_type, status, summary, payload, quantity, value,
        requested_by, requested_by_name, expires_at)
     VALUES ($1, $2, 'pending', $3, $4::jsonb, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      approval.localGovernmentId,
      approval.approvalType,
      approval.summary || null,
      JSON.stringify(approval.payload),
      approval.quantity === undefined ? null : approval.quantity,
      approval.value === undefined ? null : approval.value,
      approval.actorId,
      approval.actorName,
      approval.expiresAt || null
    ]
  );
  return rows[0];
};

const listApprovals = async (localGovernmentId, status) => {
  const { rows } = await query(
    `SELECT a.*,
            CASE WHEN a.status = 'pending' AND a.expires_at IS NOT NULL AND a.expires_at < now()
                 THEN 'expired' ELSE a.status END AS effective_status
       FROM lg_threshold_approvals a
      WHERE a.local_government_id = $1
        AND ($2::text IS NULL OR
             ($2 = 'pending' AND a.status = 'pending')
             OR ($2 <> 'pending' AND a.status = $2))
      ORDER BY a.requested_at DESC
      LIMIT 100`,
    [localGovernmentId, status || null]
  );
  return rows;
};

const findApproval = async (localGovernmentId, approvalId) => {
  const { rows } = await query(
    `SELECT a.*,
            CASE WHEN a.status = 'pending' AND a.expires_at IS NOT NULL AND a.expires_at < now()
                 THEN 'expired' ELSE a.status END AS effective_status
       FROM lg_threshold_approvals a
      WHERE a.local_government_id = $1
        AND a.id = $2`,
    [localGovernmentId, approvalId]
  );
  return rows[0] || null;
};

const lockApproval = async (client, localGovernmentId, approvalId) => {
  const { rows } = await client.query(
    `SELECT * FROM lg_threshold_approvals
      WHERE local_government_id = $1
        AND id = $2
      FOR UPDATE`,
    [localGovernmentId, approvalId]
  );
  return rows[0] || null;
};

const setApprovalStatus = async (client, { approvalId, status, decidedById, decidedByName, reason, referenceType, referenceId }) => {
  const { rows } = await client.query(
    `UPDATE lg_threshold_approvals
        SET status = $2,
            decided_by = COALESCE($3, decided_by),
            decided_by_name = COALESCE($4, decided_by_name),
            decided_at = CASE WHEN $2 IN ('approved', 'rejected', 'expired') THEN now() ELSE decided_at END,
            reason = COALESCE($5, reason),
            reference_type = COALESCE($6, reference_type),
            reference_id = COALESCE($7, reference_id),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      approvalId,
      status,
      decidedById || null,
      decidedByName || null,
      reason || null,
      referenceType || null,
      referenceId || null
    ]
  );
  return rows[0];
};

const reportsSummary = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM requisitions
         WHERE local_government_id = $1 AND status = 'pending_approval') AS pending_requests,
       (SELECT count(*)::int FROM requisitions
         WHERE local_government_id = $1 AND status = 'approved') AS approved_requests,
       (SELECT count(*)::int FROM lg_dispatches
         WHERE local_government_id = $1 AND status = 'dispatched') AS in_transit,
       (SELECT COALESCE(SUM(di.quantity - di.accepted_quantity - di.damaged_quantity - di.missing_quantity), 0)
          FROM lg_dispatch_items di
          JOIN lg_dispatches d ON d.id = di.dispatch_id
         WHERE d.local_government_id = $1
           AND d.status = 'dispatched') AS in_transit_quantity,
       (SELECT count(*)::int FROM lg_dispatches
         WHERE local_government_id = $1 AND status = 'received') AS received_dispatches,
       (SELECT count(*)::int FROM lg_receipts
         WHERE local_government_id = $1) AS receipt_count,
       (SELECT COALESCE(SUM(b.quantity), 0)
          FROM batches b
          JOIN stock_locations sl ON sl.id = b.stock_location_id
         WHERE sl.local_government_id = $1
           AND sl.location_type = 'lg_warehouse'
           AND b.status = 'usable'
           AND b.quantity > 0
           AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)) AS warehouse_quantity,
       (SELECT COALESCE(SUM(b.quantity * COALESCE(b.unit_cost, 0)), 0)
          FROM batches b
          JOIN stock_locations sl ON sl.id = b.stock_location_id
         WHERE sl.local_government_id = $1
           AND sl.location_type = 'lg_warehouse'
           AND b.status = 'usable'
           AND b.quantity > 0) AS warehouse_value,
       (SELECT count(*)::int FROM stock_locations
         WHERE local_government_id = $1 AND location_type = 'facility' AND is_active) AS facility_count`,
    [localGovernmentId]
  );
  return rows[0];
};

const demandReportRows = async ({ localGovernmentId, from, to, status }) => {
  const { rows } = await query(
    `SELECT r.requisition_number, hc.name AS centre_name, hc.code AS centre_code, r.status,
            r.created_at, r.submitted_at, r.reviewed_by_name, r.reviewed_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity,
            COALESCE(items.approved_quantity, 0) AS approved_quantity,
            COALESCE(items.closed_short_quantity, 0) AS closed_short_quantity,
            COALESCE(supply.dispatched_quantity, 0) AS dispatched_quantity,
            COALESCE(supply.accepted_quantity, 0) AS accepted_quantity,
            COALESCE(supply.in_transit_quantity, 0) AS in_transit_quantity,
            COALESCE(supply.missing_quantity, 0) AS missing_quantity,
            COALESCE(supply.damaged_quantity, 0) AS damaged_quantity,
            COALESCE(supply.open_discrepancies, 0)::int AS open_discrepancies
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity,
                SUM(approved_quantity) AS approved_quantity,
                SUM(closed_short_quantity) AS closed_short_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
       LEFT JOIN (
         SELECT disp.requisition_id,
                SUM(di.quantity) AS dispatched_quantity,
                SUM(di.accepted_quantity) AS accepted_quantity,
                SUM(di.missing_quantity) AS missing_quantity,
                SUM(di.damaged_quantity) AS damaged_quantity,
                SUM(CASE WHEN disp.status IN ('dispatched', 'partially_received')
                         THEN di.quantity - di.accepted_quantity - di.damaged_quantity - di.missing_quantity
                         ELSE 0 END) AS in_transit_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'open' THEN 1 ELSE 0 END) AS open_discrepancies
           FROM lg_dispatch_items di
           JOIN lg_dispatches disp ON disp.id = di.dispatch_id
          WHERE disp.status <> 'cancelled'
          GROUP BY disp.requisition_id
       ) supply ON supply.requisition_id = r.id
      WHERE r.local_government_id = $1
        AND ($2::date IS NULL OR r.created_at::date >= $2)
        AND ($3::date IS NULL OR r.created_at::date <= $3)
        AND ($4::text IS NULL OR r.status = $4)
      ORDER BY r.created_at DESC`,
    [localGovernmentId, from || null, to || null, status || null]
  );
  return rows;
};

const warehouseReportRows = async ({ localGovernmentId, warehouseId }) => {
  const { rows } = await query(
    `SELECT d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            COALESCE(SUM(b.quantity), 0) AS quantity,
            COALESCE(SUM(b.quantity * COALESCE(b.unit_cost, 0)), 0) AS value,
            count(b.id)::int AS batch_count,
            MIN(b.expiry_date) AS nearest_expiry,
            COALESCE(MAX(supply.in_transit_quantity), 0) AS in_transit_quantity,
            COALESCE(MAX(supply.open_discrepancies), 0)::int AS open_discrepancies
       FROM drugs d
       LEFT JOIN batches b
              ON b.drug_id = d.id
             AND b.stock_location_id = $2
             AND b.status = 'usable'
             AND b.quantity > 0
       LEFT JOIN (
         SELECT di.drug_id,
                SUM(CASE WHEN disp.status IN ('dispatched', 'partially_received')
                         THEN di.quantity - di.accepted_quantity - di.damaged_quantity - di.missing_quantity
                         ELSE 0 END) AS in_transit_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'open' THEN 1 ELSE 0 END) AS open_discrepancies
           FROM lg_dispatch_items di
           JOIN lg_dispatches disp ON disp.id = di.dispatch_id
          WHERE disp.local_government_id = $1
            AND disp.status <> 'cancelled'
          GROUP BY di.drug_id
       ) supply ON supply.drug_id = d.id
      WHERE d.local_government_id = $1
        AND d.is_active = TRUE
      GROUP BY d.id, d.code, d.name, d.unit_of_measure
      ORDER BY d.name`,
    [localGovernmentId, warehouseId]
  );
  return rows;
};

const dispatchReportRows = async ({ localGovernmentId, from, to, status }) => {
  const { rows } = await query(
    `SELECT d.dispatch_number, hc.name AS centre_name, hc.code AS centre_code, d.status,
            d.dispatched_at, d.dispatched_by_name, d.received_at, d.received_by_name,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity,
            COALESCE(items.accepted_quantity, 0) AS accepted_quantity,
            COALESCE(items.damaged_quantity, 0) AS damaged_quantity,
            COALESCE(items.missing_quantity, 0) AS missing_quantity,
            COALESCE(items.in_transit_quantity, 0) AS in_transit_quantity,
            COALESCE(items.open_discrepancies, 0)::int AS open_discrepancies
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
       LEFT JOIN (
         SELECT dispatch_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity,
                SUM(accepted_quantity) AS accepted_quantity,
                SUM(damaged_quantity) AS damaged_quantity,
                SUM(missing_quantity) AS missing_quantity,
                SUM(quantity - accepted_quantity - damaged_quantity - missing_quantity) AS in_transit_quantity,
                SUM(CASE WHEN discrepancy_status = 'open' THEN 1 ELSE 0 END) AS open_discrepancies
           FROM lg_dispatch_items
          GROUP BY dispatch_id
       ) items ON items.dispatch_id = d.id
      WHERE d.local_government_id = $1
        AND ($2::date IS NULL OR d.dispatched_at::date >= $2)
        AND ($3::date IS NULL OR d.dispatched_at::date <= $3)
        AND ($4::text IS NULL OR d.status = $4)
      ORDER BY d.dispatched_at DESC`,
    [localGovernmentId, from || null, to || null, status || null]
  );
  return rows;
};

const receiptReportRows = async ({ localGovernmentId, from, to }) => {
  const { rows } = await query(
    `SELECT r.receipt_number, r.supplier_name, r.supplier_reference, r.received_by_name, r.received_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity,
            COALESCE(items.total_value, 0) AS total_value
       FROM lg_receipts r
       LEFT JOIN (
         SELECT receipt_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity,
                SUM(quantity * COALESCE(unit_cost, 0)) AS total_value
           FROM lg_receipt_items
          GROUP BY receipt_id
       ) items ON items.receipt_id = r.id
      WHERE r.local_government_id = $1
        AND ($2::date IS NULL OR r.received_at::date >= $2)
        AND ($3::date IS NULL OR r.received_at::date <= $3)
      ORDER BY r.received_at DESC`,
    [localGovernmentId, from || null, to || null]
  );
  return rows;
};

const damageReportRows = async ({ localGovernmentId, from, to }) => {
  const { rows } = await query(
    `SELECT dd.created_at, dd.quantity::float AS quantity, dd.disposition, dd.loss_bearer,
            dd.replacement_owed, dd.agreed_with_name, dd.note, dd.recorded_by_name,
            dd.return_status, dd.return_outcome, dd.return_received_at,
            b.batch_number, b.unit_cost,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            hc.name AS centre_name, hc.code AS centre_code
       FROM damage_dispositions dd
       JOIN batches b ON b.id = dd.batch_id
       JOIN drugs d ON d.id = dd.drug_id
       JOIN healthcare_centres hc ON hc.id = dd.healthcare_centre_id
      WHERE dd.local_government_id = $1
        AND ($2::date IS NULL OR dd.created_at::date >= $2)
        AND ($3::date IS NULL OR dd.created_at::date <= $3)
      ORDER BY dd.created_at DESC`,
    [localGovernmentId, from || null, to || null]
  );
  return rows;
};

const insertTransferMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference, requisition_id)
     VALUES ($1, $2, $3, 'transfer_in', $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.requisitionId || null
    ]
  );
};

const insertReceiptMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference, correlation_id)
     VALUES (NULL, $1, $2, 'receipt', $3, $4, $5, $6, $7, $8)`,
    [
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.correlationId || null
    ]
  );
};

const warehouseMovements = async ({ localGovernmentId, warehouseId, limit, drugId, movementType, from, to }) => {
  const { rows } = await query(
    `SELECT sm.id, sm.movement_type, sm.quantity, sm.reason, sm.source_reference,
            sm.actor_full_name, sm.created_at, sm.requisition_id,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.expiry_date, b.stock_location_id,
            sl.name AS location_name, sl.location_type
       FROM stock_movements sm
       JOIN drugs d ON d.id = sm.drug_id
       JOIN batches b ON b.id = sm.batch_id
       LEFT JOIN stock_locations sl ON sl.id = b.stock_location_id
      WHERE sm.local_government_id = $1
        AND (b.stock_location_id = $2 OR sl.location_type = 'in_transit')
        AND ($3::uuid IS NULL OR sm.drug_id = $3)
        AND ($4::text IS NULL OR sm.movement_type = $4)
        AND ($5::date IS NULL OR sm.created_at::date >= $5)
        AND ($6::date IS NULL OR sm.created_at::date <= $6)
      ORDER BY sm.created_at DESC, sm.id
      LIMIT $7`,
    [
      localGovernmentId,
      warehouseId,
      drugId || null,
      movementType || null,
      from || null,
      to || null,
      limit
    ]
  );
  return rows;
};

const ledgerReconciliation = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `WITH movement_totals AS (
       SELECT m.batch_id, SUM(m.quantity) AS movement_quantity, COUNT(*)::int AS movement_count
         FROM stock_movements m
        WHERE m.local_government_id = $1
          AND m.batch_id IS NOT NULL
        GROUP BY m.batch_id
     )
     SELECT b.id AS batch_id, b.batch_number, b.quantity AS batch_quantity, b.status,
            d.code AS drug_code, d.name AS drug_name,
            sl.name AS location_name, sl.location_type,
            COALESCE(mt.movement_quantity, 0) AS movement_quantity,
            COALESCE(mt.movement_count, 0) AS movement_count,
            b.quantity - COALESCE(mt.movement_quantity, 0) AS difference
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
       LEFT JOIN movement_totals mt ON mt.batch_id = b.id
      WHERE b.local_government_id = $1
        AND (b.quantity <> 0 OR COALESCE(mt.movement_quantity, 0) <> 0)
      ORDER BY ABS(b.quantity - COALESCE(mt.movement_quantity, 0)) DESC, d.name, b.batch_number
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const findOrCreateTransitLocation = async (client, localGovernmentId) => {
  const existing = await client.query(
    `SELECT id, local_government_id, name
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'in_transit'
      LIMIT 1`,
    [localGovernmentId]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  await client.query(
    `INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
     SELECT lg.id, NULL, 'in_transit', lg.name || ' stock in transit', lg.code || '-TRANSIT'
       FROM local_governments lg
      WHERE lg.id = $1
     ON CONFLICT DO NOTHING`,
    [localGovernmentId]
  );

  const { rows } = await client.query(
    `SELECT id, local_government_id, name
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'in_transit'
      LIMIT 1`,
    [localGovernmentId]
  );
  return rows[0];
};

const insertTransitBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, 'usable')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   updated_at = now()
     WHERE (batches.expiry_date IS NULL
            OR EXCLUDED.expiry_date IS NULL
            OR batches.expiry_date = EXCLUDED.expiry_date)
       AND (batches.unit_cost IS NULL
            OR EXCLUDED.unit_cost IS NULL
            OR batches.unit_cost = EXCLUDED.unit_cost)
     RETURNING id, batch_number, quantity`,
    [
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
  if (rows.length === 0) {
    throw new ConflictError(
      `Batch ${batch.batchNumber} is already moving with a different expiry date or unit cost. Please refresh and try again.`,
      'BATCH_LOT_MISMATCH'
    );
  }
  return rows[0];
};

const insertLocationMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference, requisition_id)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      movement.drugId,
      movement.batchId,
      movement.movementType,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.requisitionId || null
    ]
  );
};

const releaseTransitQuantity = async (client, entry) => {
  const quantity = Number(entry.quantity || 0);
  if (!entry.transitBatchId || quantity <= 0) {
    return true;
  }

  const { rows } = await client.query(
    `UPDATE batches
        SET quantity = quantity - $2, updated_at = now()
      WHERE id = $1
        AND quantity >= $2
      RETURNING id`,
    [entry.transitBatchId, quantity]
  );
  if (!rows[0]) {
    return false;
  }

  await insertLocationMovement(client, {
    drugId: entry.drugId,
    batchId: entry.transitBatchId,
    movementType: entry.movementType || 'transit_out',
    quantity: -quantity,
    reason: entry.reason,
    actorId: entry.actorId,
    actorName: entry.actorName,
    sourceReference: entry.sourceReference,
    requisitionId: entry.requisitionId
  });
  return true;
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
     WHERE (batches.expiry_date IS NULL
            OR EXCLUDED.expiry_date IS NULL
            OR batches.expiry_date = EXCLUDED.expiry_date)
       AND (batches.unit_cost IS NULL
            OR EXCLUDED.unit_cost IS NULL
            OR batches.unit_cost = EXCLUDED.unit_cost)
     RETURNING id, batch_number, quantity, status`,
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
  if (rows.length === 0) {
    throw new ConflictError(
      `Quarantined batch ${batch.batchNumber} is already recorded with a different expiry date or unit cost. Please match the existing lot.`,
      'BATCH_LOT_MISMATCH'
    );
  }
  return rows[0];
};

const openDispatchItemDiscrepancy = async (client, itemId) => {
  await client.query(
    `UPDATE lg_dispatch_items
        SET discrepancy_status = 'open'
      WHERE id = $1
        AND (missing_quantity > 0 OR rejected_quantity > 0 OR damaged_quantity > 0)`,
    [itemId]
  );
};

const countOpenDiscrepancies = async (client, requisitionId) => {
  const { rows } = await client.query(
    `SELECT count(*)::int AS total
       FROM lg_dispatch_items di
       JOIN lg_dispatches d ON d.id = di.dispatch_id
      WHERE d.requisition_id = $1
        AND d.status <> 'cancelled'
        AND di.discrepancy_status = 'open'`,
    [requisitionId]
  );
  return rows[0].total;
};

const listRequisitionDiscrepancies = async (requisitionId) => {
  const { rows } = await query(
    `SELECT di.id, di.dispatch_id, di.drug_id, di.quantity, di.missing_quantity,
            di.rejected_quantity, di.damaged_quantity,
            di.discrepancy_status, di.discrepancy_resolution, di.discrepancy_reason,
            di.discrepancy_note, di.resolved_at, di.resolved_by_name,
            d.dispatch_number, dr.code AS drug_code, dr.name AS drug_name, dr.unit_of_measure
       FROM lg_dispatch_items di
       JOIN lg_dispatches d ON d.id = di.dispatch_id
       JOIN drugs dr ON dr.id = di.drug_id
      WHERE d.requisition_id = $1
        AND d.status <> 'cancelled'
        AND di.discrepancy_status <> 'none'
      ORDER BY di.discrepancy_status DESC, dr.name`,
    [requisitionId]
  );
  return rows;
};

const lockDiscrepancyItem = async (client, itemId, localGovernmentId) => {
  const { rows } = await client.query(
    `SELECT di.id, di.dispatch_id, di.drug_id, di.missing_quantity, di.rejected_quantity,
            di.damaged_quantity, di.transit_batch_id, di.discrepancy_status,
            d.requisition_id, d.healthcare_centre_id, d.dispatch_number,
            dr.name AS drug_name, dr.code AS drug_code
       FROM lg_dispatch_items di
       JOIN lg_dispatches d ON d.id = di.dispatch_id
       JOIN drugs dr ON dr.id = di.drug_id
      WHERE di.id = $1
        AND d.local_government_id = $2
        AND d.status <> 'cancelled'
      FOR UPDATE OF di`,
    [itemId, localGovernmentId]
  );
  return rows[0] || null;
};

const resolveDiscrepancyItem = async (client, entry) => {
  const { rows } = await client.query(
    `UPDATE lg_dispatch_items
        SET discrepancy_status = 'resolved',
            discrepancy_resolution = $2,
            discrepancy_note = $3,
            resolved_at = now(),
            resolved_by = $4,
            resolved_by_name = $5
      WHERE id = $1
      RETURNING id, discrepancy_status, discrepancy_resolution, resolved_at, resolved_by_name`,
    [entry.itemId, entry.resolution, entry.note, entry.actorId, entry.actorName]
  );
  return rows[0] || null;
};

const requisitionDiscrepancyBalances = async (client, requisitionId) => {
  const { rows } = await client.query(
    `SELECT ri.id, ri.approved_quantity,
            ri.replacement_authorised_quantity, ri.closed_short_quantity,
            COALESCE(agg.accepted_quantity, 0) AS accepted_quantity,
            COALESCE(agg.written_off_quantity, 0) AS written_off_quantity,
            COALESCE(agg.open_count, 0)::int AS open_count
       FROM requisition_items ri
       LEFT JOIN (
         SELECT di.drug_id, disp.requisition_id,
                SUM(di.accepted_quantity) AS accepted_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'resolved'
                          AND di.discrepancy_resolution = 'written_off'
                         THEN di.missing_quantity + di.rejected_quantity + di.damaged_quantity ELSE 0 END) AS written_off_quantity,
                SUM(CASE WHEN di.discrepancy_status = 'open' THEN 1 ELSE 0 END) AS open_count
           FROM lg_dispatch_items di
           JOIN lg_dispatches disp ON disp.id = di.dispatch_id
          WHERE disp.status <> 'cancelled'
          GROUP BY di.drug_id, disp.requisition_id
       ) agg ON agg.drug_id = ri.drug_id AND agg.requisition_id = ri.requisition_id
      WHERE ri.requisition_id = $1`,
    [requisitionId]
  );
  return rows;
};

const bumpRequisitionItemCounters = async (client, { requisitionId, drugId, replacement, closedShort }) => {
  const { rows } = await client.query(
    `UPDATE requisition_items
        SET replacement_authorised_quantity = replacement_authorised_quantity + $3,
            closed_short_quantity = closed_short_quantity + $4
      WHERE requisition_id = $1
        AND drug_id = $2
      RETURNING id, replacement_authorised_quantity, closed_short_quantity`,
    [requisitionId, drugId, replacement || 0, closedShort || 0]
  );
  return rows[0] || null;
};

const insertShortClosure = async (client, closure) => {
  const { rows } = await client.query(
    `INSERT INTO requisition_short_closures
       (requisition_id, requisition_item_id, drug_id, quantity, reason, closed_by, closed_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, quantity, created_at`,
    [
      closure.requisitionId,
      closure.requisitionItemId,
      closure.drugId,
      closure.quantity,
      closure.reason,
      closure.actorId,
      closure.actorName
    ]
  );
  return rows[0];
};

const listConsolidationCandidates = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.created_at,
            hc.name AS centre_name, hc.code AS centre_code,
            COALESCE(items.item_count, 0)::int AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
      WHERE r.local_government_id = $1
        AND r.status = 'approved'
        AND NOT EXISTS (
          SELECT 1
            FROM lg_consolidation_sources s
            JOIN lg_consolidations c ON c.id = s.consolidation_id
           WHERE s.requisition_id = r.id
             AND c.status IN ('draft', 'finalized')
        )
      ORDER BY hc.name, r.created_at`,
    [localGovernmentId]
  );
  return rows;
};

const findRequisitionsForConsolidation = async (localGovernmentId, requisitionIds) => {
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.status,
            hc.id AS healthcare_centre_id, hc.name AS centre_name, hc.code AS centre_code,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, SUM(requested_quantity) AS total_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
      WHERE r.local_government_id = $1
        AND r.id = ANY($2::uuid[])
      ORDER BY hc.name`,
    [localGovernmentId, requisitionIds]
  );
  return rows;
};

const findConsolidatedRequisitions = async (requisitionIds) => {
  const { rows } = await query(
    `SELECT s.requisition_id, c.reference, c.status
       FROM lg_consolidation_sources s
       JOIN lg_consolidations c ON c.id = s.consolidation_id
      WHERE s.requisition_id = ANY($1::uuid[])
        AND c.status IN ('draft', 'finalized')`,
    [requisitionIds]
  );
  return rows;
};

const consolidationDemandRows = async (localGovernmentId, warehouseId, requisitionIds) => {
  const { rows } = await query(
    `SELECT d.id AS drug_id, d.code, d.name, d.unit_of_measure,
            SUM(ri.requested_quantity) AS requested_quantity,
            COALESCE((
              SELECT SUM(b.quantity)
                FROM batches b
               WHERE b.drug_id = d.id
                 AND b.stock_location_id = $2
                 AND b.status = 'usable'
                 AND b.quantity > 0
                 AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
            ), 0) AS warehouse_quantity
       FROM requisition_items ri
       JOIN requisitions r ON r.id = ri.requisition_id
       JOIN drugs d ON d.id = ri.drug_id
      WHERE r.local_government_id = $1
        AND ri.requisition_id = ANY($3::uuid[])
      GROUP BY d.id, d.code, d.name, d.unit_of_measure
      ORDER BY d.name`,
    [localGovernmentId, warehouseId, requisitionIds]
  );
  return rows;
};

const insertConsolidation = async (client, consolidation) => {
  const { rows } = await client.query(
    `INSERT INTO lg_consolidations
       (local_government_id, reference, status, notes, item_count, source_count,
        total_quantity, gap_quantity, created_by, created_by_name)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      consolidation.localGovernmentId,
      consolidation.reference,
      consolidation.notes || null,
      consolidation.itemCount,
      consolidation.sourceCount,
      consolidation.totalQuantity,
      consolidation.gapQuantity,
      consolidation.actorId,
      consolidation.actorName
    ]
  );
  return rows[0];
};

const insertConsolidationSource = async (client, source) => {
  await client.query(
    `INSERT INTO lg_consolidation_sources
       (consolidation_id, requisition_id, healthcare_centre_id, centre_name, requisition_number, requested_quantity)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      source.consolidationId,
      source.requisitionId,
      source.healthcareCentreId,
      source.centreName,
      source.requisitionNumber,
      source.requestedQuantity
    ]
  );
};

const insertConsolidationItem = async (client, item) => {
  await client.query(
    `INSERT INTO lg_consolidation_items
       (consolidation_id, drug_id, requested_quantity, warehouse_quantity, gap_quantity)
     VALUES ($1, $2, $3, $4, $5)`,
    [item.consolidationId, item.drugId, item.requestedQuantity, item.warehouseQuantity, item.gapQuantity]
  );
};

const listConsolidations = async (localGovernmentId, status) => {
  const { rows } = await query(
    `SELECT *
       FROM lg_consolidations
      WHERE local_government_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [localGovernmentId, status || null]
  );
  return rows;
};

const findConsolidation = async (localGovernmentId, consolidationId) => {
  const { rows } = await query(
    `SELECT * FROM lg_consolidations WHERE local_government_id = $1 AND id = $2`,
    [localGovernmentId, consolidationId]
  );
  return rows[0] || null;
};

const lockConsolidation = async (client, localGovernmentId, consolidationId) => {
  const { rows } = await client.query(
    `SELECT * FROM lg_consolidations
      WHERE local_government_id = $1 AND id = $2
      FOR UPDATE`,
    [localGovernmentId, consolidationId]
  );
  return rows[0] || null;
};

const listConsolidationItems = async (consolidationId) => {
  const { rows } = await query(
    `SELECT i.*, d.code, d.name, d.unit_of_measure
       FROM lg_consolidation_items i
       JOIN drugs d ON d.id = i.drug_id
      WHERE i.consolidation_id = $1
      ORDER BY d.name`,
    [consolidationId]
  );
  return rows;
};

const listConsolidationSources = async (consolidationId) => {
  const { rows } = await query(
    `SELECT * FROM lg_consolidation_sources
      WHERE consolidation_id = $1
      ORDER BY centre_name`,
    [consolidationId]
  );
  return rows;
};

const updateConsolidationStatus = async (client, { consolidationId, status, actorId, actorName }) => {
  const { rows } = await client.query(
    `UPDATE lg_consolidations
        SET status = $2,
            updated_at = now(),
            finalized_by = CASE WHEN $2 = 'finalized' THEN $3 ELSE finalized_by END,
            finalized_by_name = CASE WHEN $2 = 'finalized' THEN $4 ELSE finalized_by_name END,
            finalized_at = CASE WHEN $2 = 'finalized' THEN now() ELSE finalized_at END,
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancelled_by END,
            cancelled_by_name = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancelled_by_name END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
      WHERE id = $1
      RETURNING *`,
    [consolidationId, status, actorId || null, actorName || null]
  );
  return rows[0];
};

const deleteConsolidationSources = async (client, consolidationId) => {
  await client.query('DELETE FROM lg_consolidation_sources WHERE consolidation_id = $1', [consolidationId]);
};

const insertOrder = async (client, order) => {
  const { rows } = await client.query(
    `INSERT INTO lg_orders
       (local_government_id, consolidation_id, consolidation_reference, order_number, status, notes,
        item_count, total_quantity, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      order.localGovernmentId,
      order.consolidationId || null,
      order.consolidationReference || null,
      order.orderNumber,
      order.notes || null,
      order.itemCount,
      order.totalQuantity,
      order.actorId,
      order.actorName
    ]
  );
  return rows[0];
};

const insertOrderItem = async (client, item) => {
  await client.query(
    `INSERT INTO lg_order_items
       (order_id, drug_id, quantity, requested_quantity, warehouse_quantity)
     VALUES ($1, $2, $3, $4, $5)`,
    [item.orderId, item.drugId, item.quantity, item.requestedQuantity, item.warehouseQuantity]
  );
};

const listOrders = async (localGovernmentId, status) => {
  const { rows } = await query(
    `SELECT *
       FROM lg_orders
      WHERE local_government_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [localGovernmentId, status || null]
  );
  return rows;
};

const findOrder = async (localGovernmentId, orderId) => {
  const { rows } = await query(
    `SELECT * FROM lg_orders WHERE local_government_id = $1 AND id = $2`,
    [localGovernmentId, orderId]
  );
  return rows[0] || null;
};

const findOrderByConsolidation = async (localGovernmentId, consolidationId) => {
  const { rows } = await query(
    `SELECT *
       FROM lg_orders
      WHERE local_government_id = $1
        AND consolidation_id = $2
        AND status <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1`,
    [localGovernmentId, consolidationId]
  );
  return rows[0] || null;
};

const lockOrder = async (client, localGovernmentId, orderId) => {
  const { rows } = await client.query(
    `SELECT * FROM lg_orders
      WHERE local_government_id = $1 AND id = $2
      FOR UPDATE`,
    [localGovernmentId, orderId]
  );
  return rows[0] || null;
};

const listOrderItems = async (orderId) => {
  const { rows } = await query(
    `SELECT i.*, d.code, d.name, d.unit_of_measure,
            COALESCE((
              SELECT SUM(ri.quantity)
                FROM lg_receipt_items ri
                JOIN lg_receipts r ON r.id = ri.receipt_id
               WHERE r.order_id = i.order_id
                 AND ri.drug_id = i.drug_id
            ), 0) AS received_quantity
       FROM lg_order_items i
       JOIN drugs d ON d.id = i.drug_id
      WHERE i.order_id = $1
      ORDER BY d.name`,
    [orderId]
  );
  return rows;
};

const orderReceivedQuantities = async (orderId) => {
  const { rows } = await query(
    `SELECT ri.drug_id, SUM(ri.quantity) AS received_quantity
       FROM lg_receipt_items ri
       JOIN lg_receipts r ON r.id = ri.receipt_id
      WHERE r.order_id = $1
      GROUP BY ri.drug_id`,
    [orderId]
  );
  return rows;
};

const listOrderReceipts = async (orderId) => {
  const { rows } = await query(
    `SELECT r.id, r.receipt_number, r.supplier_name, r.supplier_reference, r.received_by_name, r.received_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM lg_receipts r
       LEFT JOIN (
         SELECT receipt_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM lg_receipt_items
          GROUP BY receipt_id
       ) items ON items.receipt_id = r.id
      WHERE r.order_id = $1
      ORDER BY r.received_at`,
    [orderId]
  );
  return rows;
};

const listOrderSources = async (orderId) => {
  const { rows } = await query(
    `SELECT s.requisition_id, s.requisition_number, s.centre_name, s.requested_quantity
       FROM lg_orders o
       JOIN lg_consolidation_sources s ON s.consolidation_id = o.consolidation_id
      WHERE o.id = $1
      ORDER BY s.centre_name, s.requisition_number`,
    [orderId]
  );
  return rows;
};

const updateOrderStatus = async (
  client,
  { orderId, status, actorId, actorName, reason, note }
) => {
  const { rows } = await client.query(
    `UPDATE lg_orders
        SET status = $2,
            updated_at = now(),
            submitted_by = CASE WHEN $2 = 'submitted' THEN $3 ELSE submitted_by END,
            submitted_by_name = CASE WHEN $2 = 'submitted' THEN $4 ELSE submitted_by_name END,
            submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,
            fulfilled_by = CASE WHEN $2 IN ('fulfilled', 'received') THEN $3 ELSE fulfilled_by END,
            fulfilled_by_name = CASE WHEN $2 IN ('fulfilled', 'received') THEN $4 ELSE fulfilled_by_name END,
            fulfilled_at = CASE WHEN $2 IN ('fulfilled', 'received') THEN now() ELSE fulfilled_at END,
            fulfilled_note = CASE
              WHEN $2 = 'fulfilled' THEN $6
              WHEN $2 = 'received' THEN $6
              ELSE fulfilled_note
            END,
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancelled_by END,
            cancelled_by_name = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancelled_by_name END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
            cancel_reason = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancel_reason END
      WHERE id = $1
      RETURNING *`,
    [orderId, status, actorId || null, actorName || null, reason || null, note || null]
  );
  return rows[0];
};

const listFacilityCentres = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT id, name, code
       FROM healthcare_centres
      WHERE local_government_id = $1
        AND is_active = TRUE
      ORDER BY name`,
    [localGovernmentId]
  );
  return rows;
};

const findFacilityCentre = async (localGovernmentId, healthcareCentreId) => {
  const { rows } = await query(
    `SELECT id, name, code
       FROM healthcare_centres
      WHERE local_government_id = $1
        AND id = $2
        AND is_active = TRUE`,
    [localGovernmentId, healthcareCentreId]
  );
  return rows[0] || null;
};

const insertFacilityTransfer = async (client, transfer) => {
  const { rows } = await client.query(
    `INSERT INTO facility_transfers
       (local_government_id, transfer_number, status, from_healthcare_centre_id, from_centre_name,
        to_healthcare_centre_id, to_centre_name, notes, item_count, total_quantity,
        created_by, created_by_name)
     VALUES ($1, $2, 'in_transit', $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      transfer.localGovernmentId,
      transfer.transferNumber,
      transfer.fromCentreId,
      transfer.fromCentreName,
      transfer.toCentreId,
      transfer.toCentreName,
      transfer.notes || null,
      transfer.itemCount,
      transfer.totalQuantity,
      transfer.actorId,
      transfer.actorName
    ]
  );
  return rows[0];
};

const insertFacilityTransferItem = async (client, item) => {
  await client.query(
    `INSERT INTO facility_transfer_items
       (transfer_id, drug_id, source_batch_id, batch_number, expiry_date, quantity, unit_cost, transit_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      item.transferId,
      item.drugId,
      item.sourceBatchId || null,
      item.batchNumber,
      item.expiryDate || null,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost,
      item.transitBatchId || null
    ]
  );
};

const listFacilityTransfers = async (localGovernmentId, status) => {
  const { rows } = await query(
    `SELECT *
       FROM facility_transfers
      WHERE local_government_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [localGovernmentId, status || null]
  );
  return rows;
};

const findFacilityTransfer = async (localGovernmentId, transferId) => {
  const { rows } = await query(
    `SELECT * FROM facility_transfers WHERE local_government_id = $1 AND id = $2`,
    [localGovernmentId, transferId]
  );
  return rows[0] || null;
};

const findFacilityTransferById = async (transferId) => {
  const { rows } = await query(`SELECT * FROM facility_transfers WHERE id = $1`, [transferId]);
  return rows[0] || null;
};

const lockFacilityTransfer = async (client, transferId) => {
  const { rows } = await client.query(
    `SELECT * FROM facility_transfers WHERE id = $1 FOR UPDATE`,
    [transferId]
  );
  return rows[0] || null;
};

const listFacilityTransferItems = async (transferId) => {
  const { rows } = await query(
    `SELECT i.*, d.code, d.name, d.unit_of_measure
       FROM facility_transfer_items i
       JOIN drugs d ON d.id = i.drug_id
      WHERE i.transfer_id = $1
      ORDER BY d.name, i.expiry_date NULLS LAST`,
    [transferId]
  );
  return rows;
};

const listIncomingFacilityTransfers = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT *
       FROM facility_transfers
      WHERE to_healthcare_centre_id = $1
        AND status = 'in_transit'
      ORDER BY created_at DESC`,
    [healthcareCentreId]
  );
  return rows;
};

const updateFacilityTransferStatus = async (
  client,
  { transferId, status, actorId, actorName, reason, note }
) => {
  const { rows } = await client.query(
    `UPDATE facility_transfers
        SET status = $2,
            updated_at = now(),
            received_by = CASE WHEN $2 = 'received' THEN $3 ELSE received_by END,
            received_by_name = CASE WHEN $2 = 'received' THEN $4 ELSE received_by_name END,
            received_at = CASE WHEN $2 = 'received' THEN now() ELSE received_at END,
            received_note = CASE WHEN $2 = 'received' THEN $6 ELSE received_note END,
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancelled_by END,
            cancelled_by_name = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancelled_by_name END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
            cancel_reason = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancel_reason END
      WHERE id = $1
      RETURNING *`,
    [transferId, status, actorId || null, actorName || null, reason || null, note || null]
  );
  return rows[0];
};

const incrementBatch = async (client, batchId, quantity) => {
  await client.query(
    `UPDATE batches
        SET quantity = quantity + $2, updated_at = now()
      WHERE id = $1`,
    [batchId, quantity]
  );
};

const insertTransferOutMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference)
     VALUES ($1, $2, $3, 'transfer_out', $4, $5, $6, $7, $8)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null
    ]
  );
};

const receiptSummaryByKey = async (localGovernmentId, idempotencyKey) => {
  const { rows } = await query(
    `SELECT r.id, r.receipt_number, r.received_at,
            count(i.id)::int AS item_count,
            COALESCE(SUM(i.quantity), 0) AS total_quantity,
            COALESCE(SUM(i.quantity * COALESCE(i.unit_cost, 0)), 0) AS total_value
       FROM lg_receipts r
       LEFT JOIN lg_receipt_items i ON i.receipt_id = r.id
      WHERE r.local_government_id = $1
        AND r.idempotency_key = $2
      GROUP BY r.id, r.receipt_number, r.received_at
      LIMIT 1`,
    [localGovernmentId, idempotencyKey]
  );
  return rows[0] || null;
};

module.exports = {
  findWarehouse,
  findFacilityLocation,
  warehouseStock,
  warehouseBatches,
  findDrugs,
  insertReceipt,
  receiptSummaryByKey,
  insertWarehouseBatch,
  insertReceiptItem,
  listReceipts,
  listRequisitions,
  findRequisition,
  lockRequisition,
  listRequisitionItems,
  listRequisitionEvents,
  insertRequisitionEvent,
  markReviewed,
  updateApprovedQuantities,
  lockAvailableBatches,
  decrementBatch,
  findDispatchByKey,
  insertDispatch,
  insertDispatchItem,
  listDispatches,
  findDispatch,
  listDispatchItems,
  findDeliveryForRequisition,
  lockDispatchForRequisition,
  findDispatchForCentre,
  lockDispatchById,
  listIncomingDispatches,
  markDispatchAccounted,
  updateDispatchItemReceipt,
  insertDispatchReceipt,
  markRequisitionReceived,
  insertFacilityBatch,
  insertTransferMovement,
  insertReceiptMovement,
  findOrCreateTransitLocation,
  insertTransitBatch,
  insertLocationMovement,
  releaseTransitQuantity,
  insertQuarantineBatch,
  openDispatchItemDiscrepancy,
  countOpenDiscrepancies,
  listRequisitionDiscrepancies,
  lockDiscrepancyItem,
  resolveDiscrepancyItem,
  requisitionDiscrepancyBalances,
  bumpRequisitionItemCounters,
  insertShortClosure,
  insertApproval,
  listApprovals,
  findApproval,
  lockApproval,
  setApprovalStatus,
  reportsSummary,
  demandReportRows,
  warehouseReportRows,
  dispatchReportRows,
  receiptReportRows,
  damageReportRows,
  listConsolidationCandidates,
  findRequisitionsForConsolidation,
  findConsolidatedRequisitions,
  consolidationDemandRows,
  insertConsolidation,
  insertConsolidationSource,
  insertConsolidationItem,
  listConsolidations,
  findConsolidation,
  lockConsolidation,
  listConsolidationItems,
  listConsolidationSources,
  updateConsolidationStatus,
  deleteConsolidationSources,
  insertOrder,
  insertOrderItem,
  listOrders,
  findOrder,
  findOrderByConsolidation,
  lockOrder,
  listOrderItems,
  orderReceivedQuantities,
  listOrderReceipts,
  listOrderSources,
  updateOrderStatus,
  listFacilityCentres,
  findFacilityCentre,
  insertFacilityTransfer,
  insertFacilityTransferItem,
  listFacilityTransfers,
  findFacilityTransfer,
  findFacilityTransferById,
  lockFacilityTransfer,
  listFacilityTransferItems,
  listIncomingFacilityTransfers,
  updateFacilityTransferStatus,
  incrementBatch,
  insertTransferOutMovement,
  ledgerReconciliation,
  warehouseMovements
};

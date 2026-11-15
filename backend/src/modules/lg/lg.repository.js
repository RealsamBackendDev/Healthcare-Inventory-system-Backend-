const { query } = require('../../database/connection');

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
       (local_government_id, receipt_number, supplier_name, supplier_reference, notes, received_by, received_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, receipt_number, received_at`,
    [
      receipt.localGovernmentId,
      receipt.receiptNumber,
      receipt.supplierName || null,
      receipt.supplierReference || null,
      receipt.notes || null,
      receipt.actorId,
      receipt.actorName
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
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
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
    `SELECT ri.id, ri.drug_id, ri.requested_quantity, ri.is_auto_generated,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure
       FROM requisition_items ri
       JOIN drugs d ON d.id = ri.drug_id
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

const insertDispatch = async (client, dispatch) => {
  const { rows } = await client.query(
    `INSERT INTO lg_dispatches
       (local_government_id, requisition_id, healthcare_centre_id, dispatch_number, status, notes,
        dispatched_by, dispatched_by_name)
     VALUES ($1, $2, $3, $4, 'dispatched', $5, $6, $7)
     RETURNING id, dispatch_number, dispatched_at`,
    [
      dispatch.localGovernmentId,
      dispatch.requisitionId,
      dispatch.healthcareCentreId,
      dispatch.dispatchNumber,
      dispatch.notes || null,
      dispatch.actorId,
      dispatch.actorName
    ]
  );
  return rows[0];
};

const insertDispatchItem = async (client, item) => {
  await client.query(
    `INSERT INTO lg_dispatch_items
       (dispatch_id, drug_id, batch_id, batch_number, expiry_date, quantity, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      item.dispatchId,
      item.drugId,
      item.batchId || null,
      item.batchNumber,
      item.expiryDate || null,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost
    ]
  );
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
    `SELECT di.id, di.drug_id, di.batch_number, di.expiry_date, di.quantity, di.unit_cost,
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
        AND d.status IN ('dispatched', 'received')
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

const listIncomingDispatches = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT d.id, d.dispatch_number, d.status, d.notes, d.dispatched_by_name, d.dispatched_at,
            d.requisition_id,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM lg_dispatches d
       LEFT JOIN (
         SELECT dispatch_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM lg_dispatch_items
          GROUP BY dispatch_id
       ) items ON items.dispatch_id = d.id
      WHERE d.healthcare_centre_id = $1
        AND d.status = 'dispatched'
      ORDER BY d.dispatched_at DESC`,
    [healthcareCentreId]
  );
  return rows;
};

const markDispatchReceived = async (client, { dispatchId, actorId, actorName }) => {
  const { rows } = await client.query(
    `UPDATE lg_dispatches
        SET status = 'received', received_by = $2, received_by_name = $3, received_at = now()
      WHERE id = $1
      RETURNING id, status, received_at`,
    [dispatchId, actorId, actorName]
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
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
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
            MIN(b.expiry_date) AS nearest_expiry
       FROM drugs d
       LEFT JOIN batches b
              ON b.drug_id = d.id
             AND b.stock_location_id = $2
             AND b.status = 'usable'
             AND b.quantity > 0
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
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM lg_dispatches d
       JOIN healthcare_centres hc ON hc.id = d.healthcare_centre_id
       LEFT JOIN (
         SELECT dispatch_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
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
    `SELECT i.*, d.code, d.name, d.unit_of_measure
       FROM lg_order_items i
       JOIN drugs d ON d.id = i.drug_id
      WHERE i.order_id = $1
      ORDER BY d.name`,
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
            fulfilled_by = CASE WHEN $2 = 'fulfilled' THEN $3 ELSE fulfilled_by END,
            fulfilled_by_name = CASE WHEN $2 = 'fulfilled' THEN $4 ELSE fulfilled_by_name END,
            fulfilled_at = CASE WHEN $2 = 'fulfilled' THEN now() ELSE fulfilled_at END,
            fulfilled_note = CASE WHEN $2 = 'fulfilled' THEN $6 ELSE fulfilled_note END,
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
       (transfer_id, drug_id, source_batch_id, batch_number, expiry_date, quantity, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      item.transferId,
      item.drugId,
      item.sourceBatchId || null,
      item.batchNumber,
      item.expiryDate || null,
      item.quantity,
      item.unitCost === undefined ? null : item.unitCost
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

module.exports = {
  findWarehouse,
  findFacilityLocation,
  warehouseStock,
  warehouseBatches,
  findDrugs,
  insertReceipt,
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
  lockAvailableBatches,
  decrementBatch,
  insertDispatch,
  insertDispatchItem,
  listDispatches,
  findDispatch,
  listDispatchItems,
  findDeliveryForRequisition,
  lockDispatchForRequisition,
  listIncomingDispatches,
  markDispatchReceived,
  markRequisitionReceived,
  insertFacilityBatch,
  insertTransferMovement,
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
  lockOrder,
  listOrderItems,
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
  insertTransferOutMovement
};

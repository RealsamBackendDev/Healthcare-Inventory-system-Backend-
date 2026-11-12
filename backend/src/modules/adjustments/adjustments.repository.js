const { query } = require('../../database/connection');

const listAdjustments = async ({ healthcareCentreId, status, drugId, from, to, limit, offset }) => {
  const params = [healthcareCentreId, status || null, drugId || null, from || null, to || null];
  const { rows } = await query(
    `SELECT a.id, a.drug_id, a.batch_id, a.adjustment_type, a.quantity, a.reason, a.reference, a.status,
            a.requested_by, a.requested_by_name, a.reviewed_by, a.reviewed_by_name, a.reviewed_at, a.applied_at,
            a.review_comment, a.created_at,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.unit_cost, b.quantity AS batch_quantity
       FROM stock_adjustments a
       JOIN drugs d ON d.id = a.drug_id
       JOIN batches b ON b.id = a.batch_id
      WHERE a.healthcare_centre_id = $1
        AND ($2::text IS NULL OR a.status = $2)
        AND ($3::uuid IS NULL OR a.drug_id = $3)
        AND ($4::date IS NULL OR a.created_at::date >= $4)
        AND ($5::date IS NULL OR a.created_at::date <= $5)
      ORDER BY a.created_at DESC
      LIMIT $6 OFFSET $7`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM stock_adjustments a
      WHERE a.healthcare_centre_id = $1
        AND ($2::text IS NULL OR a.status = $2)
        AND ($3::uuid IS NULL OR a.drug_id = $3)
        AND ($4::date IS NULL OR a.created_at::date >= $4)
        AND ($5::date IS NULL OR a.created_at::date <= $5)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findAdjustment = async (healthcareCentreId, adjustmentId) => {
  const { rows } = await query(
    `SELECT a.*, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.unit_cost, b.quantity AS batch_quantity
       FROM stock_adjustments a
       JOIN drugs d ON d.id = a.drug_id
       JOIN batches b ON b.id = a.batch_id
      WHERE a.healthcare_centre_id = $1 AND a.id = $2`,
    [healthcareCentreId, adjustmentId]
  );
  return rows[0] || null;
};

const lockAdjustment = async (client, healthcareCentreId, adjustmentId) => {
  const { rows } = await client.query(
    `SELECT * FROM stock_adjustments
      WHERE healthcare_centre_id = $1 AND id = $2
      FOR UPDATE`,
    [healthcareCentreId, adjustmentId]
  );
  return rows[0] || null;
};

const insertAdjustment = async (client, adjustment) => {
  const { rows } = await client.query(
    `INSERT INTO stock_adjustments
       (healthcare_centre_id, drug_id, batch_id, adjustment_type, quantity, reason, reference, status,
        requested_by, requested_by_name, reviewed_by, reviewed_by_name, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $8 = 'approved' THEN now() ELSE NULL END)
     RETURNING *`,
    [
      adjustment.healthcareCentreId,
      adjustment.drugId,
      adjustment.batchId,
      adjustment.adjustmentType,
      adjustment.quantity,
      adjustment.reason,
      adjustment.reference || null,
      adjustment.status,
      adjustment.actorId,
      adjustment.actorName,
      adjustment.reviewedById || null,
      adjustment.reviewedByName || null
    ]
  );
  return rows[0];
};

const setReview = async (client, { adjustmentId, status, reviewerId, reviewerName, comment, applied }) => {
  const { rows } = await client.query(
    `UPDATE stock_adjustments
        SET status = $2,
            reviewed_by = $3,
            reviewed_by_name = $4,
            reviewed_at = now(),
            review_comment = $5,
            applied_at = CASE WHEN $6::boolean THEN now() ELSE applied_at END
      WHERE id = $1
      RETURNING *`,
    [adjustmentId, status, reviewerId, reviewerName, comment || null, Boolean(applied)]
  );
  return rows[0];
};

const markApplied = async (client, adjustmentId) => {
  await client.query('UPDATE stock_adjustments SET applied_at = now() WHERE id = $1', [adjustmentId]);
};

const lockBatch = async (client, healthcareCentreId, batchId) => {
  const { rows } = await client.query(
    `SELECT b.*, d.name AS drug_name, d.code AS drug_code, d.unit_of_measure, d.is_active AS drug_active
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1 AND b.id = $2
      FOR UPDATE OF b`,
    [healthcareCentreId, batchId]
  );
  return rows[0] || null;
};

const setBatchQuantity = async (client, { batchId, quantity }) => {
  await client.query('UPDATE batches SET quantity = $2, updated_at = now() WHERE id = $1', [batchId, quantity]);
};

const setBatchStatus = async (client, { batchId, status }) => {
  await client.query('UPDATE batches SET status = $2, updated_at = now() WHERE id = $1', [batchId, status]);
};

const insertAdjustmentMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason, actor_user_id, actor_full_name,
        source_reference, adjustment_id)
     VALUES ($1, $2, $3, 'adjustment', $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.adjustmentId
    ]
  );
};

const insertReturnMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason, actor_user_id, actor_full_name,
        source_reference, return_request_id)
     VALUES ($1, $2, $3, 'return', $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId,
      movement.drugId,
      movement.batchId,
      movement.quantity,
      movement.reason,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null,
      movement.returnRequestId
    ]
  );
};

const listReturns = async ({ healthcareCentreId, status, from, to, limit, offset }) => {
  const params = [healthcareCentreId, status || null, from || null, to || null];
  const { rows } = await query(
    `SELECT r.id, r.request_number, r.reason, r.reference, r.status, r.requested_by_name,
            r.reviewed_by_name, r.reviewed_at, r.review_comment, r.created_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM return_requests r
       LEFT JOIN (
         SELECT return_request_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM return_request_items
          GROUP BY return_request_id
       ) items ON items.return_request_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::date IS NULL OR r.created_at::date >= $3)
        AND ($4::date IS NULL OR r.created_at::date <= $4)
      ORDER BY r.created_at DESC
      LIMIT $5 OFFSET $6`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM return_requests r
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::date IS NULL OR r.created_at::date >= $3)
        AND ($4::date IS NULL OR r.created_at::date <= $4)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findReturn = async (healthcareCentreId, returnId) => {
  const { rows } = await query(
    'SELECT * FROM return_requests WHERE healthcare_centre_id = $1 AND id = $2',
    [healthcareCentreId, returnId]
  );
  return rows[0] || null;
};

const lockReturn = async (client, healthcareCentreId, returnId) => {
  const { rows } = await client.query(
    `SELECT * FROM return_requests
      WHERE healthcare_centre_id = $1 AND id = $2
      FOR UPDATE`,
    [healthcareCentreId, returnId]
  );
  return rows[0] || null;
};

const insertReturnRequest = async (client, request) => {
  const { rows } = await client.query(
    `INSERT INTO return_requests
       (healthcare_centre_id, request_number, reason, reference, status, requested_by, requested_by_name)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING *`,
    [
      request.healthcareCentreId,
      request.requestNumber,
      request.reason,
      request.reference || null,
      request.actorId,
      request.actorName
    ]
  );
  return rows[0];
};

const insertReturnItem = async (client, item) => {
  const { rows } = await client.query(
    `INSERT INTO return_request_items (return_request_id, drug_id, batch_id, quantity, disposition)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [item.returnRequestId, item.drugId, item.batchId, item.quantity, item.disposition]
  );
  return rows[0];
};

const listReturnItems = async (returnId) => {
  const { rows } = await query(
    `SELECT ri.id, ri.quantity, ri.disposition, ri.batch_id, ri.drug_id,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.status AS batch_status, b.quantity AS batch_quantity
       FROM return_request_items ri
       JOIN drugs d ON d.id = ri.drug_id
       JOIN batches b ON b.id = ri.batch_id
      WHERE ri.return_request_id = $1
      ORDER BY d.name`,
    [returnId]
  );
  return rows;
};

const setReturnReview = async (client, { returnId, status, reviewerId, reviewerName, comment }) => {
  const { rows } = await client.query(
    `UPDATE return_requests
        SET status = $2, reviewed_by = $3, reviewed_by_name = $4, reviewed_at = now(), review_comment = $5
      WHERE id = $1
      RETURNING *`,
    [returnId, status, reviewerId, reviewerName, comment || null]
  );
  return rows[0];
};

module.exports = {
  listAdjustments,
  findAdjustment,
  lockAdjustment,
  insertAdjustment,
  setReview,
  markApplied,
  lockBatch,
  setBatchQuantity,
  setBatchStatus,
  insertAdjustmentMovement,
  insertReturnMovement,
  listReturns,
  findReturn,
  lockReturn,
  insertReturnRequest,
  insertReturnItem,
  listReturnItems,
  setReturnReview
};

const { query } = require('../../database/connection');

const listRequisitions = async ({ healthcareCentreId, status, search, from, to, limit, offset }) => {
  const params = [healthcareCentreId, status || null, search || null, from || null, to || null];
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.status, r.source, r.notes, r.review_reason,
            r.created_by, r.created_by_name, r.submitted_at, r.reviewed_by_name, r.reviewed_at,
            r.closed_at, r.parent_requisition_id, r.superseded_by_requisition_id, r.created_at, r.updated_at,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM requisitions r
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count, SUM(requested_quantity) AS total_quantity
           FROM requisition_items
          GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::text IS NULL OR r.requisition_number ILIKE '%' || $3 || '%' OR r.created_by_name ILIKE '%' || $3 || '%')
        AND ($4::date IS NULL OR r.created_at::date >= $4)
        AND ($5::date IS NULL OR r.created_at::date <= $5)
      ORDER BY r.created_at DESC
      LIMIT $6 OFFSET $7`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM requisitions r
      WHERE r.healthcare_centre_id = $1
        AND ($2::text IS NULL OR r.status = $2)
        AND ($3::text IS NULL OR r.requisition_number ILIKE '%' || $3 || '%' OR r.created_by_name ILIKE '%' || $3 || '%')
        AND ($4::date IS NULL OR r.created_at::date >= $4)
        AND ($5::date IS NULL OR r.created_at::date <= $5)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findDrugs = async (client, healthcareCentreId, drugIds) => {
  const { rows } = await client.query(
    `SELECT id, code, name, unit_of_measure, minimum_stock_level, is_active
       FROM drugs
      WHERE healthcare_centre_id = $1 AND id = ANY($2::uuid[])`,
    [healthcareCentreId, drugIds]
  );
  return rows;
};

const findRequisition = async (healthcareCentreId, requisitionId) => {
  const { rows } = await query(
    'SELECT * FROM requisitions WHERE healthcare_centre_id = $1 AND id = $2',
    [healthcareCentreId, requisitionId]
  );
  return rows[0] || null;
};

const lockRequisition = async (client, healthcareCentreId, requisitionId) => {
  const { rows } = await client.query(
    `SELECT * FROM requisitions
      WHERE healthcare_centre_id = $1 AND id = $2
      FOR UPDATE`,
    [healthcareCentreId, requisitionId]
  );
  return rows[0] || null;
};

const listItems = async (requisitionId) => {
  const { rows } = await query(
    `SELECT ri.id, ri.drug_id, ri.requested_quantity, ri.is_auto_generated,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure, d.minimum_stock_level, d.is_active,
            COALESCE(stock.usable_quantity, 0) AS usable_quantity
       FROM requisition_items ri
       JOIN drugs d ON d.id = ri.drug_id
       LEFT JOIN (
         SELECT drug_id, SUM(quantity) AS usable_quantity
           FROM batches
          WHERE healthcare_centre_id = (SELECT healthcare_centre_id FROM requisitions WHERE id = $1)
            AND status = 'usable'
            AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
          GROUP BY drug_id
       ) stock ON stock.drug_id = ri.drug_id
      WHERE ri.requisition_id = $1
      ORDER BY d.name`,
    [requisitionId]
  );
  return rows;
};

const listEvents = async (requisitionId) => {
  const { rows } = await query(
    `SELECT id, event_type, actor_full_name, comment, created_at
       FROM requisition_events
      WHERE requisition_id = $1
      ORDER BY created_at ASC`,
    [requisitionId]
  );
  return rows;
};

const insertRequisition = async (client, requisition) => {
  const { rows } = await client.query(
    `INSERT INTO requisitions
       (healthcare_centre_id, requisition_number, status, source, notes, created_by, created_by_name, parent_requisition_id)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      requisition.healthcareCentreId,
      requisition.requisitionNumber,
      requisition.source,
      requisition.notes || null,
      requisition.actorId,
      requisition.actorName,
      requisition.parentRequisitionId || null
    ]
  );
  return rows[0];
};

const updateNotes = async (client, { requisitionId, notes }) => {
  const { rows } = await client.query(
    'UPDATE requisitions SET notes = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [requisitionId, notes]
  );
  return rows[0];
};

const replaceItems = async (client, { requisitionId, items }) => {
  await client.query('DELETE FROM requisition_items WHERE requisition_id = $1', [requisitionId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO requisition_items (requisition_id, drug_id, requested_quantity, is_auto_generated)
       VALUES ($1, $2, $3, $4)`,
      [requisitionId, item.drugId, item.requestedQuantity, Boolean(item.isAutoGenerated)]
    );
  }
};

const insertItem = async (client, item) => {
  await client.query(
    `INSERT INTO requisition_items (requisition_id, drug_id, requested_quantity, is_auto_generated)
     VALUES ($1, $2, $3, $4)`,
    [item.requisitionId, item.drugId, item.requestedQuantity, Boolean(item.isAutoGenerated)]
  );
};

const deleteRequisition = async (client, requisitionId) => {
  await client.query('DELETE FROM requisitions WHERE id = $1', [requisitionId]);
};

const insertEvent = async (client, event) => {
  await client.query(
    `INSERT INTO requisition_events (requisition_id, event_type, actor_user_id, actor_full_name, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.requisitionId, event.eventType, event.actorId, event.actorName, event.comment || null]
  );
};

const markSubmitted = async (client, requisitionId) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = 'pending_approval', submitted_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [requisitionId]
  );
  return rows[0];
};

const markReviewed = async (client, { requisitionId, status, actorId, actorName, reason }) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = $2, reviewed_by = $3, reviewed_by_name = $4, reviewed_at = now(),
            review_reason = $5, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [requisitionId, status, actorId, actorName, reason || null]
  );
  return rows[0];
};

const markCancelled = async (client, { requisitionId, reason }) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = 'cancelled', review_reason = COALESCE($2, review_reason), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [requisitionId, reason || null]
  );
  return rows[0];
};

const markClosed = async (client, requisitionId) => {
  const { rows } = await client.query(
    `UPDATE requisitions
        SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [requisitionId]
  );
  return rows[0];
};

const markSuperseded = async (client, { requisitionId, supersededBy }) => {
  await client.query('UPDATE requisitions SET superseded_by_requisition_id = $2 WHERE id = $1', [
    requisitionId,
    supersededBy
  ]);
};

const findShortages = async (healthcareCentreId) => {
  const { rows } = await query(
    `WITH usable AS (
       SELECT drug_id, SUM(quantity) AS usable_quantity
         FROM batches
        WHERE healthcare_centre_id = $1
          AND status = 'usable'
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        GROUP BY drug_id
     ),
     open_cover AS (
       SELECT ri.drug_id, SUM(ri.requested_quantity) AS covered_quantity
         FROM requisition_items ri
         JOIN requisitions r ON r.id = ri.requisition_id
        WHERE r.healthcare_centre_id = $1
          AND r.status IN ('draft', 'pending_approval', 'approved')
        GROUP BY ri.drug_id
     )
     SELECT d.id AS drug_id, d.code, d.name, d.unit_of_measure, d.minimum_stock_level,
            COALESCE(usable.usable_quantity, 0) AS usable_quantity,
            COALESCE(open_cover.covered_quantity, 0) AS covered_quantity,
            (d.minimum_stock_level - COALESCE(usable.usable_quantity, 0) - COALESCE(open_cover.covered_quantity, 0)) AS suggested_quantity
       FROM drugs d
       LEFT JOIN usable ON usable.drug_id = d.id
       LEFT JOIN open_cover ON open_cover.drug_id = d.id
      WHERE d.healthcare_centre_id = $1
        AND d.is_active = TRUE
        AND (d.minimum_stock_level - COALESCE(usable.usable_quantity, 0) - COALESCE(open_cover.covered_quantity, 0)) > 0.000000001
      ORDER BY d.name`,
    [healthcareCentreId]
  );
  return rows;
};

module.exports = {
  listRequisitions,
  findDrugs,
  findRequisition,
  lockRequisition,
  listItems,
  listEvents,
  insertRequisition,
  updateNotes,
  replaceItems,
  insertItem,
  deleteRequisition,
  insertEvent,
  markSubmitted,
  markReviewed,
  markCancelled,
  markClosed,
  markSuperseded,
  findShortages
};

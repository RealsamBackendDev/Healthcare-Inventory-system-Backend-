const { query } = require('../../database/connection');

const requestSelect = `
  SELECT vr.*,
         v.legal_name AS vendor_name,
         v.vendor_code,
         v.status AS vendor_status
    FROM vendor_requests vr
    JOIN vendors v ON v.id = vr.vendor_id
`;

const listRequests = async ({ localGovernmentId, status, vendorId, limit, offset }) => {
  const params = [localGovernmentId, status || null, vendorId || null];
  const filter = `
    AND ($2::text IS NULL OR vr.status = $2)
    AND ($3::uuid IS NULL OR vr.vendor_id = $3::uuid)
  `;
  const { rows } = await query(
    `${requestSelect} WHERE vr.local_government_id = $1 ${filter}
      ORDER BY vr.created_at DESC LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM vendor_requests vr WHERE vr.local_government_id = $1 ${filter}`,
    params
  );
  return { rows, total: countRows[0].total };
};

const listVendorRequests = async ({ vendorId, status, limit, offset }) => {
  const params = [vendorId, status || null];
  const filter = `AND ($2::text IS NULL OR vr.status = $2)`;
  const { rows } = await query(
    `${requestSelect} WHERE vr.vendor_id = $1 ${filter}
      ORDER BY vr.created_at DESC LIMIT $3 OFFSET $4`,
    [...params, limit, offset]
  );
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM vendor_requests vr WHERE vr.vendor_id = $1 ${filter}`,
    params
  );
  return { rows, total: countRows[0].total };
};

const findRequest = async (localGovernmentId, requestId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `${requestSelect} WHERE vr.local_government_id = $1 AND vr.id = $2`,
    [localGovernmentId, requestId]
  );
  return rows[0] || null;
};

const findVendorRequest = async (vendorId, requestId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `${requestSelect} WHERE vr.vendor_id = $1 AND vr.id = $2`,
    [vendorId, requestId]
  );
  return rows[0] || null;
};

const lockRequest = async (client, requestId) => {
  const { rows } = await client.query(
    'SELECT * FROM vendor_requests WHERE id = $1 FOR UPDATE',
    [requestId]
  );
  return rows[0] || null;
};

const insertRequest = async (client, values) => {
  const { rows } = await client.query(
    `INSERT INTO vendor_requests
       (state_id, local_government_id, vendor_id, consolidation_id, consolidation_reference,
        notes, item_count, requested_quantity, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, reference`,
    [
      values.stateId,
      values.localGovernmentId,
      values.vendorId,
      values.consolidationId || null,
      values.consolidationReference || null,
      values.notes || null,
      values.itemCount,
      values.requestedQuantity,
      values.actorId || null,
      values.actorName || null
    ]
  );
  return rows[0];
};

const insertRequestItem = async (client, item) => {
  const { rows } = await client.query(
    `INSERT INTO vendor_request_items
       (request_id, state_drug_id, drug_name, strength, dosage_form, unit_of_measure,
        requested_quantity, unit_price)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      item.requestId,
      item.stateDrugId,
      item.drugName,
      item.strength || null,
      item.dosageForm || null,
      item.unitOfMeasure || null,
      item.requestedQuantity,
      item.unitPrice === undefined ? null : item.unitPrice
    ]
  );
  return rows[0];
};

const listRequestItemsForUpdate = async (client, requestId) => {
  const { rows } = await client.query(
    `SELECT * FROM vendor_request_items
      WHERE request_id = $1
      ORDER BY drug_name
      FOR UPDATE`,
    [requestId]
  );
  return rows;
};

const deleteRequestItem = async (client, itemId) => {
  await client.query('DELETE FROM vendor_request_items WHERE id = $1', [itemId]);
};

const updateItemPrice = async (client, { itemId, unitPrice }) => {
  await client.query(
    `UPDATE vendor_request_items
        SET unit_price = $2,
            updated_at = now()
      WHERE id = $1`,
    [itemId, unitPrice]
  );
};

const updateRequestPricing = async (client, { requestId, requestedValue }) => {
  await client.query(
    `UPDATE vendor_requests
        SET requested_value = $2,
            updated_at = now()
      WHERE id = $1`,
    [requestId, requestedValue]
  );
};

const updateRequestDemand = async (client, { requestId, itemCount, requestedQuantity }) => {
  await client.query(
    `UPDATE vendor_requests
        SET item_count = $2,
            requested_quantity = $3,
            updated_at = now()
      WHERE id = $1`,
    [requestId, itemCount, requestedQuantity]
  );
};

const listRequestItems = async (requestId) => {
  const { rows } = await query(
    `SELECT * FROM vendor_request_items WHERE request_id = $1 ORDER BY drug_name`,
    [requestId]
  );
  return rows;
};

const findRequestItem = async (client, requestId, itemId) => {
  const { rows } = await client.query(
    `SELECT * FROM vendor_request_items
      WHERE request_id = $1 AND id = $2
      FOR UPDATE`,
    [requestId, itemId]
  );
  return rows[0] || null;
};

const updateRequestItem = async (client, { itemId, confirmedQuantity, unitPrice }) => {
  await client.query(
    `UPDATE vendor_request_items
        SET confirmed_quantity = $2,
            unit_price = $3,
            updated_at = now()
      WHERE id = $1`,
    [itemId, confirmedQuantity, unitPrice]
  );
};

const updateRequestTotals = async (client, { requestId, confirmedQuantity, confirmedValue }) => {
  await client.query(
    `UPDATE vendor_requests
        SET confirmed_quantity = $2,
            confirmed_value = $3,
            updated_at = now()
      WHERE id = $1`,
    [requestId, confirmedQuantity, confirmedValue]
  );
};

const setRequestStatus = async (client, { requestId, status, actorId, actorName, notes }) => {
  const { rows } = await client.query(
    `UPDATE vendor_requests
        SET status = $2,
            notes = COALESCE($3, notes),
            updated_at = now(),
            sent_by = CASE WHEN $2 = 'sent' THEN $4 ELSE sent_by END,
            sent_by_name = CASE WHEN $2 = 'sent' THEN $5 ELSE sent_by_name END,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
            accepted_by = CASE WHEN $2 = 'accepted' THEN $4 ELSE accepted_by END,
            accepted_by_name = CASE WHEN $2 = 'accepted' THEN $5 ELSE accepted_by_name END,
            accepted_at = CASE WHEN $2 = 'accepted' THEN now() ELSE accepted_at END,
            responded_by = CASE WHEN $2 IN ('confirmed', 'declined') THEN $4 ELSE responded_by END,
            responded_by_name = CASE WHEN $2 IN ('confirmed', 'declined') THEN $5 ELSE responded_by_name END,
            responded_at = CASE WHEN $2 IN ('confirmed', 'declined') THEN now() ELSE responded_at END,
            vendor_note = CASE WHEN $2 = 'confirmed' THEN $3 ELSE vendor_note END,
            declined_reason = CASE WHEN $2 = 'declined' THEN $3 ELSE declined_reason END,
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancelled_by END,
            cancelled_by_name = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancelled_by_name END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
            cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END
      WHERE id = $1
      RETURNING *`,
    [requestId, status, notes || null, actorId || null, actorName || null]
  );
  return rows[0];
};

const insertEvent = async (
  client,
  { requestId, action, fromStatus, toStatus, notes, actorType, actorId, actorName }
) => {
  await client.query(
    `INSERT INTO vendor_request_events
       (request_id, action, from_status, to_status, notes, actor_type, actor_user_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      requestId,
      action,
      fromStatus || null,
      toStatus || null,
      notes || null,
      actorType,
      actorId || null,
      actorName || null
    ]
  );
};

const listRequestEvents = async (requestId) => {
  const { rows } = await query(
    `SELECT action, from_status, to_status, notes, actor_type, actor_name, created_at
       FROM vendor_request_events
      WHERE request_id = $1
      ORDER BY created_at`,
    [requestId]
  );
  return rows;
};

const listConsolidationCandidates = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT c.id, c.reference, c.item_count, c.total_quantity, c.gap_quantity,
            c.finalized_at, c.finalized_by_name
       FROM lg_consolidations c
      WHERE c.local_government_id = $1
        AND c.status = 'finalized'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_requests vr
           WHERE vr.consolidation_id = c.id
             AND vr.status <> 'cancelled'
        )
      ORDER BY c.finalized_at DESC NULLS LAST
      LIMIT 50`,
    [localGovernmentId]
  );
  return rows;
};

const findConsolidationForRequest = async (localGovernmentId, consolidationId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `SELECT * FROM lg_consolidations
      WHERE local_government_id = $1 AND id = $2`,
    [localGovernmentId, consolidationId]
  );
  return rows[0] || null;
};

const consolidationRequestItems = async (consolidationId) => {
  const { rows } = await query(
    `SELECT i.drug_id, i.requested_quantity, i.warehouse_quantity, i.gap_quantity,
            d.code AS drug_code, d.name AS drug_name, d.strength, d.dosage_form,
            d.unit_of_measure, d.state_drug_id
       FROM lg_consolidation_items i
       JOIN drugs d ON d.id = i.drug_id
      WHERE i.consolidation_id = $1
      ORDER BY d.name`,
    [consolidationId]
  );
  return rows;
};

const vendorPrices = async (vendorId, stateDrugIds) => {
  if (!stateDrugIds.length) {
    return [];
  }
  const { rows } = await query(
    `SELECT state_drug_id, MIN(unit_price) AS unit_price
       FROM vendor_stock
      WHERE vendor_id = $1
        AND is_active = TRUE
        AND quantity_available > 0
        AND state_drug_id = ANY($2::uuid[])
      GROUP BY state_drug_id`,
    [vendorId, stateDrugIds]
  );
  return rows;
};

module.exports = {
  listRequests,
  listVendorRequests,
  findRequest,
  findVendorRequest,
  lockRequest,
  insertRequest,
  insertRequestItem,
  listRequestItems,
  listRequestItemsForUpdate,
  deleteRequestItem,
  updateItemPrice,
  updateRequestPricing,
  updateRequestDemand,
  findRequestItem,
  updateRequestItem,
  updateRequestTotals,
  setRequestStatus,
  insertEvent,
  listRequestEvents,
  listConsolidationCandidates,
  findConsolidationForRequest,
  consolidationRequestItems,
  vendorPrices
};

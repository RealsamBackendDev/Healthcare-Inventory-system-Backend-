const { query } = require('../../database/connection');

const stockCte = `
  stock AS (
    SELECT b.drug_id,
           COALESCE(SUM(CASE WHEN b.status = 'usable' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
                             THEN b.quantity ELSE 0 END), 0) AS usable_quantity,
           COALESCE(SUM(CASE WHEN b.status IN ('quarantined', 'blocked', 'recalled', 'returned_pending_inspection')
                             THEN b.quantity ELSE 0 END), 0) AS blocked_quantity,
           COALESCE(SUM(CASE WHEN b.status = 'expired'
                                  OR (b.status = 'usable' AND b.expiry_date < CURRENT_DATE)
                             THEN b.quantity ELSE 0 END), 0) AS expired_quantity,
           count(b.id)::int AS batch_count
      FROM batches b
     WHERE b.healthcare_centre_id = $1
     GROUP BY b.drug_id
  )
`;

const getStockOverview = async (healthcareCentreId) => {
  const { rows } = await query(
    `WITH ${stockCte}
     SELECT
       (SELECT count(*)::int FROM drugs WHERE healthcare_centre_id = $1 AND is_active = TRUE) AS active_drugs,
       COALESCE((SELECT SUM(usable_quantity) FROM stock), 0) AS usable_quantity,
       COALESCE((SELECT SUM(blocked_quantity) FROM stock), 0) AS blocked_quantity,
       COALESCE((SELECT SUM(expired_quantity) FROM stock), 0) AS expired_quantity,
       COALESCE((SELECT count(*) FROM drugs d LEFT JOIN stock s ON s.drug_id = d.id
                  WHERE d.healthcare_centre_id = $1 AND d.is_active = TRUE
                    AND COALESCE(s.usable_quantity, 0) <= 0), 0)::int AS out_of_stock,
       COALESCE((SELECT count(*) FROM drugs d LEFT JOIN stock s ON s.drug_id = d.id
                  WHERE d.healthcare_centre_id = $1 AND d.is_active = TRUE
                    AND COALESCE(s.usable_quantity, 0) > 0
                    AND COALESCE(s.usable_quantity, 0) <= d.minimum_stock_level), 0)::int AS low_stock`,
    [healthcareCentreId]
  );
  return rows[0];
};

const getExpiryOverview = async (healthcareCentreId, days) => {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'usable' AND quantity > 0
                            AND expiry_date >= CURRENT_DATE
                            AND expiry_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
                         THEN 1 ELSE 0 END), 0)::int AS near_expiry_batches,
       COALESCE(SUM(CASE WHEN status = 'usable' AND quantity > 0
                            AND expiry_date >= CURRENT_DATE
                            AND expiry_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
                         THEN quantity ELSE 0 END), 0) AS near_expiry_quantity,
       COALESCE(SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
                            AND status <> 'destroyed' THEN 1 ELSE 0 END), 0)::int AS expired_batches,
       COALESCE(SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
                            AND status <> 'destroyed' THEN quantity ELSE 0 END), 0) AS expired_quantity
     FROM batches
     WHERE healthcare_centre_id = $1`,
    [healthcareCentreId, days]
  );
  return rows[0];
};

const getPendingCounts = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM requisitions
         WHERE healthcare_centre_id = $1 AND status = 'pending_approval') AS pending_requisitions,
       (SELECT count(*)::int FROM stock_adjustments
         WHERE healthcare_centre_id = $1 AND status = 'pending') AS pending_adjustments,
       (SELECT count(*)::int FROM return_requests
         WHERE healthcare_centre_id = $1 AND status = 'pending') AS pending_returns`,
    [healthcareCentreId]
  );
  return rows[0];
};

const getRecentMovements = async (healthcareCentreId, limit) => {
  const { rows } = await query(
    `SELECT sm.id, sm.movement_type, sm.quantity, sm.reason, sm.actor_full_name, sm.created_at,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure, b.batch_number
       FROM stock_movements sm
       JOIN drugs d ON d.id = sm.drug_id
       JOIN batches b ON b.id = sm.batch_id
      WHERE sm.healthcare_centre_id = $1
      ORDER BY sm.created_at DESC
      LIMIT $2`,
    [healthcareCentreId, limit]
  );
  return rows;
};

const getLowStockItems = async (healthcareCentreId, limit) => {
  const { rows } = await query(
    `WITH ${stockCte}
     SELECT d.id, d.code, d.name, d.unit_of_measure, d.minimum_stock_level,
            COALESCE(s.usable_quantity, 0) AS usable_quantity
       FROM drugs d
       LEFT JOIN stock s ON s.drug_id = d.id
      WHERE d.healthcare_centre_id = $1
        AND d.is_active = TRUE
        AND COALESCE(s.usable_quantity, 0) <= d.minimum_stock_level
      ORDER BY COALESCE(s.usable_quantity, 0) ASC, d.name ASC
      LIMIT $2`,
    [healthcareCentreId, limit]
  );
  return rows;
};

const getUpcomingExpiries = async (healthcareCentreId, days, limit) => {
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity,
            (b.expiry_date - CURRENT_DATE) AS days_to_expiry,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= CURRENT_DATE
        AND b.expiry_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
      ORDER BY b.expiry_date ASC
      LIMIT $3`,
    [healthcareCentreId, days, limit]
  );
  return rows;
};

const getRecentRequisitions = async (healthcareCentreId, limit) => {
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.status, r.source, r.created_by_name, r.created_at,
            COALESCE(items.item_count, 0) AS item_count
       FROM requisitions r
       LEFT JOIN (
         SELECT requisition_id, count(*)::int AS item_count FROM requisition_items GROUP BY requisition_id
       ) items ON items.requisition_id = r.id
      WHERE r.healthcare_centre_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2`,
    [healthcareCentreId, limit]
  );
  return rows;
};

const inventoryRows = async (healthcareCentreId, { search }) => {
  const { rows } = await query(
    `WITH ${stockCte}
     SELECT d.code, d.name, d.strength, d.dosage_form, d.unit_of_measure, d.minimum_stock_level, d.is_active,
            COALESCE(s.usable_quantity, 0) AS usable_quantity,
            COALESCE(s.blocked_quantity, 0) AS blocked_quantity,
            COALESCE(s.expired_quantity, 0) AS expired_quantity,
            CASE WHEN NOT d.is_active THEN 'inactive'
                 WHEN COALESCE(s.usable_quantity, 0) <= 0 THEN 'out_of_stock'
                 WHEN COALESCE(s.usable_quantity, 0) <= d.minimum_stock_level THEN 'low_stock'
                 ELSE 'in_stock' END AS stock_status
       FROM drugs d
       LEFT JOIN stock s ON s.drug_id = d.id
      WHERE d.healthcare_centre_id = $1
        AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR d.code ILIKE '%' || $2 || '%')
      ORDER BY d.name`,
    [healthcareCentreId, search || null]
  );
  return rows;
};

const movementRows = async (healthcareCentreId, { from, to, drugId, movementType, userId }) => {
  const { rows } = await query(
    `SELECT sm.created_at, sm.movement_type, sm.quantity, sm.reason, sm.source_reference, sm.actor_full_name,
            d.code AS drug_code, d.name AS drug_name, b.batch_number
       FROM stock_movements sm
       JOIN drugs d ON d.id = sm.drug_id
       JOIN batches b ON b.id = sm.batch_id
      WHERE sm.healthcare_centre_id = $1
        AND ($2::date IS NULL OR sm.created_at::date >= $2)
        AND ($3::date IS NULL OR sm.created_at::date <= $3)
        AND ($4::uuid IS NULL OR sm.drug_id = $4)
        AND ($5::text IS NULL OR sm.movement_type = $5)
        AND ($6::uuid IS NULL OR sm.actor_user_id = $6)
      ORDER BY sm.created_at DESC`,
    [healthcareCentreId, from || null, to || null, drugId || null, movementType || null, userId || null]
  );
  return rows;
};

const dispensingRows = async (healthcareCentreId, { from, to, drugId, userId }) => {
  const { rows } = await query(
    `SELECT r.created_at, r.reference, r.note, r.created_by_name,
            d.code AS drug_code, d.name AS drug_name, b.batch_number, di.quantity
       FROM dispensing_items di
       JOIN dispensing_records r ON r.id = di.dispensing_record_id
       JOIN drugs d ON d.id = di.drug_id
       JOIN batches b ON b.id = di.batch_id
      WHERE r.healthcare_centre_id = $1
        AND ($2::date IS NULL OR r.created_at::date >= $2)
        AND ($3::date IS NULL OR r.created_at::date <= $3)
        AND ($4::uuid IS NULL OR di.drug_id = $4)
        AND ($5::uuid IS NULL OR r.created_by = $5)
      ORDER BY r.created_at DESC, d.name`,
    [healthcareCentreId, from || null, to || null, drugId || null, userId || null]
  );
  return rows;
};

const expiryRows = async (healthcareCentreId, { status, days }) => {
  const { rows } = await query(
    `SELECT b.expiry_date, (b.expiry_date - CURRENT_DATE) AS days_remaining,
            d.code AS drug_code, d.name AS drug_name, b.batch_number, b.quantity, b.status, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND b.expiry_date IS NOT NULL
        AND ($2::text IS NULL
             OR ($2 = 'expired' AND b.expiry_date < CURRENT_DATE)
             OR ($2 = 'near_expiry' AND b.expiry_date >= CURRENT_DATE
                 AND b.expiry_date <= CURRENT_DATE + ($3::int * INTERVAL '1 day'))
             OR ($2 = 'all'))
        AND b.status <> 'destroyed'
      ORDER BY b.expiry_date ASC, d.name ASC`,
    [healthcareCentreId, status || null, days || 90]
  );
  return rows;
};

const requisitionRows = async (healthcareCentreId, { from, to, status }) => {
  const { rows } = await query(
    `SELECT r.created_at, r.requisition_number, r.status, r.source, r.created_by_name,
            r.submitted_at, r.reviewed_by_name, r.reviewed_at, r.review_reason,
            count(ri.id)::int AS item_count,
            COALESCE(SUM(ri.requested_quantity), 0) AS total_quantity
       FROM requisitions r
       LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::date IS NULL OR r.created_at::date >= $2)
        AND ($3::date IS NULL OR r.created_at::date <= $3)
        AND ($4::text IS NULL OR r.status = $4)
      GROUP BY r.id
      ORDER BY r.created_at DESC`,
    [healthcareCentreId, from || null, to || null, status || null]
  );
  return rows;
};

const adjustmentRows = async (healthcareCentreId, { from, to, status, drugId }) => {
  const { rows } = await query(
    `SELECT a.created_at, a.adjustment_type, a.quantity, a.status, a.reason, a.reference,
            a.requested_by_name, a.reviewed_by_name, a.reviewed_at, a.applied_at,
            d.code AS drug_code, d.name AS drug_name, b.batch_number, b.unit_cost
       FROM stock_adjustments a
       JOIN drugs d ON d.id = a.drug_id
       JOIN batches b ON b.id = a.batch_id
      WHERE a.healthcare_centre_id = $1
        AND ($2::date IS NULL OR a.created_at::date >= $2)
        AND ($3::date IS NULL OR a.created_at::date <= $3)
        AND ($4::text IS NULL OR a.status = $4)
        AND ($5::uuid IS NULL OR a.drug_id = $5)
      ORDER BY a.created_at DESC`,
    [healthcareCentreId, from || null, to || null, status || null, drugId || null]
  );
  return rows;
};

const returnRows = async (healthcareCentreId, { from, to, status }) => {
  const { rows } = await query(
    `SELECT r.created_at, r.request_number, r.status, r.reason, r.reference, r.requested_by_name,
            r.reviewed_by_name, r.reviewed_at, r.review_comment,
            COALESCE(items.item_count, 0) AS item_count,
            COALESCE(items.total_quantity, 0) AS total_quantity
       FROM return_requests r
       LEFT JOIN (
         SELECT return_request_id, count(*)::int AS item_count, SUM(quantity) AS total_quantity
           FROM return_request_items
          GROUP BY return_request_id
       ) items ON items.return_request_id = r.id
      WHERE r.healthcare_centre_id = $1
        AND ($2::date IS NULL OR r.created_at::date >= $2)
        AND ($3::date IS NULL OR r.created_at::date <= $3)
        AND ($4::text IS NULL OR r.status = $4)
      ORDER BY r.created_at DESC`,
    [healthcareCentreId, from || null, to || null, status || null]
  );
  return rows;
};

const auditRows = async (healthcareCentreId, { from, to, action, userId }) => {
  const { rows } = await query(
    `SELECT created_at, actor_full_name, actor_user_id, action, entity_type, entity_id, summary, reason
       FROM audit_events
      WHERE healthcare_centre_id = $1
        AND ($2::date IS NULL OR created_at::date >= $2)
        AND ($3::date IS NULL OR created_at::date <= $3)
        AND ($4::text IS NULL OR action ILIKE '%' || $4 || '%')
        AND ($5::uuid IS NULL OR actor_user_id = $5)
      ORDER BY created_at DESC`,
    [healthcareCentreId, from || null, to || null, action || null, userId || null]
  );
  return rows;
};

const listUsers = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email
       FROM users u
       JOIN user_memberships m ON m.user_id = u.id
      WHERE m.healthcare_centre_id = $1
      ORDER BY u.full_name`,
    [healthcareCentreId]
  );
  return rows;
};

const listDrugs = async (healthcareCentreId) => {
  const { rows } = await query(
    'SELECT id, code, name FROM drugs WHERE healthcare_centre_id = $1 ORDER BY name',
    [healthcareCentreId]
  );
  return rows;
};

module.exports = {
  getStockOverview,
  getExpiryOverview,
  getPendingCounts,
  getRecentMovements,
  getLowStockItems,
  getUpcomingExpiries,
  getRecentRequisitions,
  inventoryRows,
  movementRows,
  dispensingRows,
  expiryRows,
  requisitionRows,
  adjustmentRows,
  returnRows,
  auditRows,
  listUsers,
  listDrugs
};

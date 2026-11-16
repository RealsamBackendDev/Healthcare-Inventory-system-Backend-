const { query } = require('../../../database/connection');

const alertLowStock = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT hc.id AS centre_id, hc.name AS centre_name, hc.code AS centre_code,
            d.id AS drug_id, d.name AS drug_name, d.code AS drug_code, d.unit_of_measure,
            COALESCE(SUM(b.quantity), 0)::float AS quantity,
            d.minimum_stock_level::float AS minimum_stock_level
       FROM healthcare_centres hc
       JOIN drugs d ON d.local_government_id = $1 AND d.is_active = TRUE
       LEFT JOIN stock_locations sl ON sl.healthcare_centre_id = hc.id AND sl.location_type = 'facility'
       LEFT JOIN batches b ON b.stock_location_id = sl.id AND b.drug_id = d.id AND b.status = 'usable'
      WHERE hc.local_government_id = $1 AND hc.is_active = TRUE
      GROUP BY hc.id, hc.name, hc.code, d.id, d.name, d.code, d.unit_of_measure, d.minimum_stock_level
     HAVING COALESCE(SUM(b.quantity), 0) < d.minimum_stock_level
      ORDER BY (d.minimum_stock_level - COALESCE(SUM(b.quantity), 0)) DESC, hc.name, d.name
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const alertNearExpiry = async (localGovernmentId, days, limit) => {
  const { rows } = await query(
    `SELECT hc.id AS centre_id, hc.name AS centre_name,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            (b.expiry_date - CURRENT_DATE)::int AS days_remaining
       FROM batches b
       JOIN stock_locations sl ON sl.id = b.stock_location_id AND sl.location_type = 'facility'
       JOIN healthcare_centres hc ON hc.id = sl.healthcare_centre_id AND hc.is_active = TRUE
       JOIN drugs d ON d.id = b.drug_id
      WHERE hc.local_government_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date <= CURRENT_DATE + $2::int
      ORDER BY b.expiry_date ASC, hc.name, d.name
      LIMIT $3`,
    [localGovernmentId, days, limit]
  );
  return rows;
};

const alertPendingRequisitions = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT r.id, r.requisition_number, r.status, r.submitted_at, r.created_at,
            hc.name AS centre_name, hc.code AS centre_code,
            COALESCE(SUM(ri.requested_quantity), 0)::float AS total_quantity
       FROM requisitions r
       JOIN healthcare_centres hc ON hc.id = r.healthcare_centre_id
       LEFT JOIN requisition_items ri ON ri.requisition_id = r.id
      WHERE r.local_government_id = $1 AND r.status = 'pending_approval'
      GROUP BY r.id, r.requisition_number, r.status, r.submitted_at, r.created_at, hc.name, hc.code
      ORDER BY r.created_at ASC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const alertPendingApprovals = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT a.id, a.approval_type, a.summary, a.requested_by_name, a.requested_at,
            a.quantity::float AS quantity, a.value::float AS value, a.expires_at
       FROM lg_threshold_approvals a
      WHERE a.local_government_id = $1 AND a.status = 'pending'
      ORDER BY a.requested_at ASC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const alertOpenOrders = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.status, o.created_at, o.total_quantity::float AS total_quantity
       FROM lg_orders o
      WHERE o.local_government_id = $1 AND o.status IN ('draft', 'submitted')
      ORDER BY o.created_at ASC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const alertDraftConsolidations = async (localGovernmentId, limit) => {
  const { rows } = await query(
    `SELECT c.id, c.reference, c.created_at, c.total_quantity::float AS total_quantity
       FROM lg_consolidations c
      WHERE c.local_government_id = $1 AND c.status = 'draft'
      ORDER BY c.created_at ASC
      LIMIT $2`,
    [localGovernmentId, limit]
  );
  return rows;
};

const alertCounts = async (localGovernmentId, nearExpiryDays) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM (
          SELECT hc.id, d.id
            FROM healthcare_centres hc
            JOIN drugs d ON d.local_government_id = $1 AND d.is_active = TRUE
            LEFT JOIN stock_locations sl ON sl.healthcare_centre_id = hc.id AND sl.location_type = 'facility'
            LEFT JOIN batches b ON b.stock_location_id = sl.id AND b.drug_id = d.id AND b.status = 'usable'
           WHERE hc.local_government_id = $1 AND hc.is_active = TRUE
           GROUP BY hc.id, d.id, d.minimum_stock_level
          HAVING COALESCE(SUM(b.quantity), 0) < d.minimum_stock_level
        ) low) AS low_stock,
       (SELECT count(*)::int
          FROM batches b
          JOIN stock_locations sl ON sl.id = b.stock_location_id AND sl.location_type = 'facility'
          JOIN healthcare_centres hc ON hc.id = sl.healthcare_centre_id AND hc.is_active = TRUE
         WHERE hc.local_government_id = $1
           AND b.status = 'usable'
           AND b.quantity > 0
           AND b.expiry_date IS NOT NULL
           AND b.expiry_date <= CURRENT_DATE + $2::int) AS expiring,
       (SELECT count(*)::int FROM requisitions r
         WHERE r.local_government_id = $1 AND r.status = 'pending_approval') AS requisitions,
       (SELECT count(*)::int FROM lg_threshold_approvals a
         WHERE a.local_government_id = $1 AND a.status = 'pending') AS approvals,
       (SELECT count(*)::int FROM lg_orders o
         WHERE o.local_government_id = $1 AND o.status IN ('draft', 'submitted')) AS orders,
       (SELECT count(*)::int FROM lg_consolidations c
         WHERE c.local_government_id = $1 AND c.status = 'draft') AS consolidations`,
    [localGovernmentId, nearExpiryDays]
  );
  return rows[0];
};

module.exports = {
  alertLowStock,
  alertNearExpiry,
  alertPendingRequisitions,
  alertPendingApprovals,
  alertOpenOrders,
  alertDraftConsolidations,
  alertCounts
};

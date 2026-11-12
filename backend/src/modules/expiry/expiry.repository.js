const { query } = require('../../database/connection');

const listActiveCentres = async () => {
  const { rows } = await query('SELECT id, name FROM healthcare_centres WHERE is_active = TRUE ORDER BY name');
  return rows;
};

const markExpiredBatches = async (client, healthcareCentreId) => {
  const { rows } = await client.query(
    `UPDATE batches
        SET status = 'expired', updated_at = now()
      WHERE healthcare_centre_id = $1
        AND status = 'usable'
        AND expiry_date IS NOT NULL
        AND expiry_date < CURRENT_DATE
      RETURNING id, drug_id, batch_number, quantity`,
    [healthcareCentreId]
  );
  return rows;
};

const listNearExpiry = async ({ healthcareCentreId, days, limit, offset }) => {
  const params = [healthcareCentreId, days];
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.status, b.unit_cost,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            (b.expiry_date - CURRENT_DATE) AS days_to_expiry
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= CURRENT_DATE
        AND b.expiry_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
      ORDER BY b.expiry_date ASC, d.name ASC
      LIMIT $3 OFFSET $4`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM batches b
      WHERE b.healthcare_centre_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= CURRENT_DATE
        AND b.expiry_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')`,
    params
  );

  return { rows, total: countRows[0].total };
};

const listExpired = async ({ healthcareCentreId, limit, offset }) => {
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.status,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            (CURRENT_DATE - b.expiry_date) AS days_expired
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date < CURRENT_DATE
        AND b.status <> 'destroyed'
      ORDER BY b.expiry_date ASC
      LIMIT $2 OFFSET $3`,
    [healthcareCentreId, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM batches b
      WHERE b.healthcare_centre_id = $1
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date < CURRENT_DATE
        AND b.status <> 'destroyed'`,
    [healthcareCentreId]
  );

  return { rows, total: countRows[0].total };
};

const getExpirySummary = async (centreId) => {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE
                              AND b.status <> 'destroyed' THEN 1 ELSE 0 END), 0)::int AS expired_batches,
       COALESCE(SUM(CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE
                              AND b.status <> 'destroyed' THEN b.quantity ELSE 0 END), 0) AS expired_quantity,
       COALESCE(SUM(CASE WHEN b.status = 'usable' AND b.quantity > 0 AND b.expiry_date >= CURRENT_DATE
                              AND b.expiry_date <= CURRENT_DATE + 7 THEN 1 ELSE 0 END), 0)::int AS within_7_days,
       COALESCE(SUM(CASE WHEN b.status = 'usable' AND b.quantity > 0 AND b.expiry_date >= CURRENT_DATE
                              AND b.expiry_date <= CURRENT_DATE + 30 THEN 1 ELSE 0 END), 0)::int AS within_30_days,
       COALESCE(SUM(CASE WHEN b.status = 'usable' AND b.quantity > 0 AND b.expiry_date >= CURRENT_DATE
                              AND b.expiry_date <= CURRENT_DATE + 90 THEN 1 ELSE 0 END), 0)::int AS within_90_days
     FROM batches b
     WHERE b.healthcare_centre_id = $1`,
    [centreId]
  );
  return rows[0];
};

const createNearExpiryNotifications = async (client, { healthcareCentreId, days, type }) => {
  const { rowCount } = await client.query(
    `INSERT INTO notifications (healthcare_centre_id, user_id, type, title, message, entity_type, entity_id)
     SELECT $1, members.user_id, $2,
            CASE WHEN $3::int <= 7 THEN 'Batch expiring this week'
                 WHEN $3::int <= 30 THEN 'Batch expiring within 30 days'
                 ELSE 'Batch expiring within 90 days' END,
            'Batch ' || b.batch_number || ' of ' || d.name || ' expires on ' ||
            to_char(b.expiry_date, 'YYYY-MM-DD') || ' with ' || b.quantity || ' ' || d.unit_of_measure || ' remaining',
            'batch', b.id::text
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       CROSS JOIN (
         SELECT m.user_id
           FROM user_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.healthcare_centre_id = $1 AND m.is_active = TRUE AND u.is_active = TRUE
       ) members
      WHERE b.healthcare_centre_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= CURRENT_DATE
        AND b.expiry_date <= CURRENT_DATE + ($3::int * INTERVAL '1 day')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = members.user_id
             AND n.type = $2
             AND n.entity_type = 'batch'
             AND n.entity_id = b.id::text
        )`,
    [healthcareCentreId, type, days]
  );
  return rowCount;
};

const createExpiredNotifications = async (client, healthcareCentreId) => {
  const { rowCount } = await client.query(
    `INSERT INTO notifications (healthcare_centre_id, user_id, type, title, message, entity_type, entity_id)
     SELECT $1, members.user_id, 'expired_stock', 'Expired stock needs action',
            'Batch ' || b.batch_number || ' of ' || d.name || ' expired on ' ||
            to_char(b.expiry_date, 'YYYY-MM-DD') || ' with ' || b.quantity || ' ' || d.unit_of_measure || ' remaining',
            'batch', b.id::text
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       CROSS JOIN (
         SELECT m.user_id
           FROM user_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.healthcare_centre_id = $1 AND m.is_active = TRUE AND u.is_active = TRUE
       ) members
      WHERE b.healthcare_centre_id = $1
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date < CURRENT_DATE
        AND b.status <> 'destroyed'
        AND b.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = members.user_id
             AND n.type = 'expired_stock'
             AND n.entity_type = 'batch'
             AND n.entity_id = b.id::text
        )`,
    [healthcareCentreId]
  );
  return rowCount;
};

module.exports = {
  listActiveCentres,
  markExpiredBatches,
  listNearExpiry,
  listExpired,
  getExpirySummary,
  createNearExpiryNotifications,
  createExpiredNotifications
};

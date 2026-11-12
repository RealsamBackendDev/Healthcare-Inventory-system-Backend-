const { query } = require('../../database/connection');

const stockSummary = `
  WITH stock AS (
    SELECT b.drug_id,
           COALESCE(SUM(CASE WHEN b.status = 'usable' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
                             THEN b.quantity ELSE 0 END), 0) AS usable_quantity,
           COALESCE(SUM(CASE WHEN b.status IN ('quarantined', 'blocked', 'recalled', 'returned_pending_inspection')
                             THEN b.quantity ELSE 0 END), 0) AS blocked_quantity,
           COALESCE(SUM(CASE WHEN b.status = 'expired'
                                  OR (b.status = 'usable' AND b.expiry_date < CURRENT_DATE)
                             THEN b.quantity ELSE 0 END), 0) AS expired_quantity,
           COALESCE(SUM(CASE WHEN b.status = 'destroyed' THEN b.quantity ELSE 0 END), 0) AS destroyed_quantity,
           COALESCE(SUM(b.quantity), 0) AS total_quantity,
           count(b.id)::int AS batch_count
      FROM batches b
     WHERE b.healthcare_centre_id = $1
     GROUP BY b.drug_id
  ),
  summary AS (
    SELECT d.id, d.code, d.name, d.generic_name, d.brand_name, d.strength, d.dosage_form, d.unit_of_measure,
           d.minimum_stock_level, d.is_active,
           COALESCE(stock.usable_quantity, 0) AS usable_quantity,
           COALESCE(stock.blocked_quantity, 0) AS blocked_quantity,
           COALESCE(stock.expired_quantity, 0) AS expired_quantity,
           COALESCE(stock.destroyed_quantity, 0) AS destroyed_quantity,
           COALESCE(stock.total_quantity, 0) AS total_quantity,
           COALESCE(stock.batch_count, 0) AS batch_count,
           CASE WHEN COALESCE(stock.usable_quantity, 0) <= 0 THEN 'out_of_stock'
                WHEN COALESCE(stock.usable_quantity, 0) <= d.minimum_stock_level THEN 'low_stock'
                ELSE 'in_stock' END AS stock_status
      FROM drugs d
      LEFT JOIN stock ON stock.drug_id = d.id
     WHERE d.healthcare_centre_id = $1 AND d.is_active = TRUE
  )
`;

const listInventory = async ({ healthcareCentreId, search, status, limit, offset }) => {
  const params = [healthcareCentreId, search || null, status || null];
  const { rows } = await query(
    `${stockSummary}
     SELECT * FROM summary
      WHERE ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR stock_status = $3)
      ORDER BY name
      LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `${stockSummary}
     SELECT count(*)::int AS total FROM summary
      WHERE ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR stock_status = $3)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const listBatches = async ({
  healthcareCentreId,
  drugId,
  status,
  expiryStatus,
  search,
  nearExpiryDays,
  limit,
  offset
}) => {
  const params = [healthcareCentreId, drugId || null, status || null, expiryStatus || null, search || null, nearExpiryDays];
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.unit_cost, b.received_date,
            b.supplier_reference, b.status, b.created_at,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            (b.expiry_date - CURRENT_DATE) AS days_to_expiry,
            (b.status = 'usable' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)) AS is_usable
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND ($2::uuid IS NULL OR b.drug_id = $2)
        AND ($3::text IS NULL OR b.status = $3)
        AND ($4::text IS NULL
             OR ($4 = 'expired' AND b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE)
             OR ($4 = 'near_expiry' AND b.expiry_date IS NOT NULL AND b.expiry_date >= CURRENT_DATE
                 AND b.expiry_date <= CURRENT_DATE + ($6::int * INTERVAL '1 day'))
             OR ($4 = 'usable' AND b.status = 'usable' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE))
             OR ($4 = 'no_expiry' AND b.expiry_date IS NULL))
        AND ($5::text IS NULL OR b.batch_number ILIKE '%' || $5 || '%' OR d.name ILIKE '%' || $5 || '%' OR d.code ILIKE '%' || $5 || '%')
      ORDER BY b.expiry_date ASC NULLS LAST, b.received_date ASC, b.batch_number ASC
      LIMIT $7 OFFSET $8`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
      WHERE b.healthcare_centre_id = $1
        AND ($2::uuid IS NULL OR b.drug_id = $2)
        AND ($3::text IS NULL OR b.status = $3)
        AND ($4::text IS NULL
             OR ($4 = 'expired' AND b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE)
             OR ($4 = 'near_expiry' AND b.expiry_date IS NOT NULL AND b.expiry_date >= CURRENT_DATE
                 AND b.expiry_date <= CURRENT_DATE + ($6::int * INTERVAL '1 day'))
             OR ($4 = 'usable' AND b.status = 'usable' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE))
             OR ($4 = 'no_expiry' AND b.expiry_date IS NULL))
        AND ($5::text IS NULL OR b.batch_number ILIKE '%' || $5 || '%' OR d.name ILIKE '%' || $5 || '%' OR d.code ILIKE '%' || $5 || '%')`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findDrugStock = async (healthcareCentreId, drugId) => {
  const { rows } = await query(
    `${stockSummary}
     SELECT * FROM summary WHERE id = $2`,
    [healthcareCentreId, drugId]
  );
  return rows[0] || null;
};

module.exports = {
  listInventory,
  listBatches,
  findDrugStock
};

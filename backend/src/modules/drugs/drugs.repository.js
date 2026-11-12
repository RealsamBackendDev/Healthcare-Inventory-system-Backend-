const { query } = require('../../database/connection');

const baseSelect = `
  SELECT d.id, d.healthcare_centre_id, d.code, d.name, d.generic_name, d.brand_name, d.strength,
         d.dosage_form, d.unit_of_measure, d.minimum_stock_level, d.is_active, d.created_at, d.updated_at,
         COALESCE(stock.batch_count, 0) AS batch_count,
         COALESCE(stock.total_quantity, 0) AS total_quantity
    FROM drugs d
    LEFT JOIN (
      SELECT drug_id, count(*)::int AS batch_count, SUM(quantity) AS total_quantity
        FROM batches
       WHERE healthcare_centre_id = $1
       GROUP BY drug_id
    ) stock ON stock.drug_id = d.id
`;

const list = async ({ healthcareCentreId, search, isActive, limit, offset }) => {
  const params = [healthcareCentreId, search || null, isActive === undefined ? null : isActive];
  const { rows } = await query(
    `${baseSelect}
      WHERE d.healthcare_centre_id = $1
        AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR d.code ILIKE '%' || $2 || '%'
             OR COALESCE(d.brand_name, '') ILIKE '%' || $2 || '%'
             OR COALESCE(d.generic_name, '') ILIKE '%' || $2 || '%')
        AND ($3::boolean IS NULL OR d.is_active = $3)
      ORDER BY d.name
      LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM drugs d
      WHERE d.healthcare_centre_id = $1
        AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR d.code ILIKE '%' || $2 || '%'
             OR COALESCE(d.brand_name, '') ILIKE '%' || $2 || '%'
             OR COALESCE(d.generic_name, '') ILIKE '%' || $2 || '%')
        AND ($3::boolean IS NULL OR d.is_active = $3)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findById = async (healthcareCentreId, drugId) => {
  const { rows } = await query(
    `${baseSelect} WHERE d.healthcare_centre_id = $1 AND d.id = $2`,
    [healthcareCentreId, drugId]
  );
  return rows[0] || null;
};

const findByCode = async (healthcareCentreId, code) => {
  const { rows } = await query(
    'SELECT id, code, is_active FROM drugs WHERE healthcare_centre_id = $1 AND lower(code) = lower($2)',
    [healthcareCentreId, code]
  );
  return rows[0] || null;
};

const create = async (client, drug) => {
  const { rows } = await client.query(
    `INSERT INTO drugs
       (healthcare_centre_id, code, name, generic_name, brand_name, strength, dosage_form, unit_of_measure, minimum_stock_level, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      drug.healthcareCentreId,
      drug.code,
      drug.name,
      drug.genericName || null,
      drug.brandName || null,
      drug.strength || null,
      drug.dosageForm,
      drug.unitOfMeasure,
      drug.minimumStockLevel,
      drug.createdBy
    ]
  );
  return rows[0];
};

const update = async (client, { healthcareCentreId, drugId, fields }) => {
  const { rows } = await client.query(
    `UPDATE drugs
        SET code = COALESCE($3, code),
            name = COALESCE($4, name),
            generic_name = COALESCE($5, generic_name),
            brand_name = COALESCE($6, brand_name),
            strength = COALESCE($7, strength),
            dosage_form = COALESCE($8, dosage_form),
            unit_of_measure = COALESCE($9, unit_of_measure),
            minimum_stock_level = COALESCE($10, minimum_stock_level),
            is_active = COALESCE($11, is_active),
            updated_at = now()
      WHERE healthcare_centre_id = $1 AND id = $2
      RETURNING *`,
    [
      healthcareCentreId,
      drugId,
      fields.code || null,
      fields.name || null,
      fields.genericName === undefined ? null : fields.genericName,
      fields.brandName === undefined ? null : fields.brandName,
      fields.strength === undefined ? null : fields.strength,
      fields.dosageForm || null,
      fields.unitOfMeasure || null,
      fields.minimumStockLevel === undefined ? null : fields.minimumStockLevel,
      fields.isActive === undefined ? null : fields.isActive
    ]
  );
  return rows[0] || null;
};

const setActive = async (client, { healthcareCentreId, drugId, isActive }) => {
  const { rows } = await client.query(
    `UPDATE drugs SET is_active = $3, updated_at = now()
      WHERE healthcare_centre_id = $1 AND id = $2
      RETURNING *`,
    [healthcareCentreId, drugId, isActive]
  );
  return rows[0] || null;
};

module.exports = {
  list,
  findById,
  findByCode,
  create,
  update,
  setActive
};

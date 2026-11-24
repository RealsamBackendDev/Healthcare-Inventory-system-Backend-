const { query } = require('../../database/connection');

const baseSelect = `
  SELECT d.id, d.local_government_id, d.code, d.name, d.generic_name, d.brand_name, d.strength,
         d.dosage_form, d.unit_of_measure, d.created_at, d.updated_at,
         COALESCE(fds.minimum_stock_level, 0) AS minimum_stock_level,
         COALESCE(fds.is_active, d.is_active) AS is_active,
         COALESCE(stock.batch_count, 0) AS batch_count,
         COALESCE(stock.total_quantity, 0) AS total_quantity
    FROM drugs d
    JOIN healthcare_centres hc ON hc.id = $1
    LEFT JOIN facility_drug_settings fds ON fds.drug_id = d.id AND fds.healthcare_centre_id = $1
    LEFT JOIN (
      SELECT drug_id, count(*)::int AS batch_count, SUM(quantity) AS total_quantity
        FROM batches
       WHERE healthcare_centre_id = $1
       GROUP BY drug_id
    ) stock ON stock.drug_id = d.id
   WHERE d.local_government_id = hc.local_government_id
`;

const list = async ({ healthcareCentreId, search, isActive, limit, offset }) => {
  const params = [healthcareCentreId, search || null, isActive === undefined ? null : isActive];
  const filter = `
    AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR d.code ILIKE '%' || $2 || '%'
         OR COALESCE(d.brand_name, '') ILIKE '%' || $2 || '%'
         OR COALESCE(d.generic_name, '') ILIKE '%' || $2 || '%')
    AND ($3::boolean IS NULL OR COALESCE(fds.is_active, d.is_active) = $3)
  `;

  const { rows } = await query(
    `${baseSelect} ${filter} ORDER BY d.name LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM drugs d
       JOIN healthcare_centres hc ON hc.id = $1
       LEFT JOIN facility_drug_settings fds ON fds.drug_id = d.id AND fds.healthcare_centre_id = $1
      WHERE d.local_government_id = hc.local_government_id
      ${filter}`,
    params
  );

  return { rows, total: countRows[0].total };
};

const findById = async (healthcareCentreId, drugId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(`${baseSelect} AND d.id = $2`, [healthcareCentreId, drugId]);
  return rows[0] || null;
};

const findByCode = async (healthcareCentreId, code) => {
  const { rows } = await query(
    `SELECT d.id, d.code, d.is_active
       FROM drugs d
       JOIN healthcare_centres hc ON hc.id = $1
      WHERE d.local_government_id = hc.local_government_id
        AND lower(d.code) = lower($2)`,
    [healthcareCentreId, code]
  );
  return rows[0] || null;
};

const create = async (client, drug) => {
  const { rows } = await client.query(
    `INSERT INTO drugs
       (local_government_id, code, name, generic_name, brand_name, strength, dosage_form, unit_of_measure, created_by)
     SELECT hc.local_government_id, $2, $3, $4, $5, $6, $7, $8, $9
       FROM healthcare_centres hc
      WHERE hc.id = $1
     RETURNING id, local_government_id`,
    [
      drug.healthcareCentreId,
      drug.code,
      drug.name,
      drug.genericName || null,
      drug.brandName || null,
      drug.strength || null,
      drug.dosageForm,
      drug.unitOfMeasure,
      drug.createdBy
    ]
  );
  return rows[0];
};

const ensureSettingsForCatalogue = async (client, { localGovernmentId, drugId }) => {
  await client.query(
    `INSERT INTO facility_drug_settings (healthcare_centre_id, drug_id, minimum_stock_level)
     SELECT hc.id, $2, 0
       FROM healthcare_centres hc
      WHERE hc.local_government_id = $1
        AND hc.is_active = TRUE
     ON CONFLICT (healthcare_centre_id, drug_id) DO NOTHING`,
    [localGovernmentId, drugId]
  );
};

const upsertFacilitySettings = async (client, { healthcareCentreId, drugId, minimumStockLevel, isActive }) => {
  await client.query(
    `INSERT INTO facility_drug_settings (healthcare_centre_id, drug_id, minimum_stock_level, is_active)
     VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, TRUE))
     ON CONFLICT (healthcare_centre_id, drug_id)
     DO UPDATE SET minimum_stock_level = COALESCE($3, facility_drug_settings.minimum_stock_level),
                   is_active = COALESCE($4, facility_drug_settings.is_active),
                   updated_at = now()`,
    [
      healthcareCentreId,
      drugId,
      minimumStockLevel === undefined ? null : minimumStockLevel,
      isActive === undefined ? null : isActive
    ]
  );
};

const update = async (client, { healthcareCentreId, drugId, fields }) => {
  const { rows } = await client.query(
    `UPDATE drugs d
        SET code = COALESCE($3, d.code),
            name = COALESCE($4, d.name),
            generic_name = COALESCE($5, d.generic_name),
            brand_name = COALESCE($6, d.brand_name),
            strength = COALESCE($7, d.strength),
            dosage_form = COALESCE($8, d.dosage_form),
            unit_of_measure = COALESCE($9, d.unit_of_measure),
            updated_at = now()
       FROM healthcare_centres hc
      WHERE hc.id = $1
        AND d.local_government_id = hc.local_government_id
        AND d.id = $2
      RETURNING d.id`,
    [
      healthcareCentreId,
      drugId,
      fields.code || null,
      fields.name || null,
      fields.genericName === undefined ? null : fields.genericName,
      fields.brandName === undefined ? null : fields.brandName,
      fields.strength === undefined ? null : fields.strength,
      fields.dosageForm || null,
      fields.unitOfMeasure || null
    ]
  );
  return rows[0] || null;
};

const setActive = async (client, { healthcareCentreId, drugId, isActive }) => {
  const { rows } = await client.query(
    `UPDATE drugs d
        SET is_active = $3, updated_at = now()
       FROM healthcare_centres hc
      WHERE hc.id = $1
        AND d.local_government_id = hc.local_government_id
        AND d.id = $2
      RETURNING d.id`,
    [healthcareCentreId, drugId, isActive]
  );
  return rows[0] || null;
};

module.exports = {
  list,
  findById,
  findByCode,
  create,
  ensureSettingsForCatalogue,
  upsertFacilitySettings,
  update,
  setActive
};

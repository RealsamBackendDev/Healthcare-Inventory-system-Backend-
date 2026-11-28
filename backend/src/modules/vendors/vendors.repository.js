const { query } = require('../../database/connection');

const vendorSelect = `
  SELECT v.*,
         (SELECT count(*)::int
            FROM vendor_stock vs
           WHERE vs.vendor_id = v.id AND vs.is_active = TRUE) AS stock_count
    FROM vendors v
`;

const listVendors = async ({ stateId, search, status, limit, offset }) => {
  const params = [stateId, search || null, status || null];
  const filter = `
    AND ($2::text IS NULL
         OR v.legal_name ILIKE '%' || $2 || '%'
         OR COALESCE(v.trading_name, '') ILIKE '%' || $2 || '%'
         OR COALESCE(v.tin, '') ILIKE '%' || $2 || '%'
         OR v.vendor_code ILIKE '%' || $2 || '%')
    AND ($3::text IS NULL OR v.status = $3)
  `;
  const { rows } = await query(
    `${vendorSelect} WHERE v.state_id = $1 ${filter} ORDER BY v.legal_name LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM vendors v WHERE v.state_id = $1 ${filter}`,
    params
  );
  return { rows, total: countRows[0].total };
};

const findVendor = async (stateId, vendorId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `${vendorSelect} WHERE v.state_id = $1 AND v.id = $2`,
    [stateId, vendorId]
  );
  return rows[0] || null;
};

const findVendorById = async (vendorId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(`${vendorSelect} WHERE v.id = $1`, [vendorId]);
  return rows[0] || null;
};

const findVendorByName = async (stateId, legalName, excludeVendorId) => {
  const { rows } = await query(
    `SELECT id FROM vendors
      WHERE state_id = $1
        AND lower(legal_name) = lower($2)
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [stateId, legalName, excludeVendorId || null]
  );
  return rows[0] || null;
};

const findVendorByTin = async (stateId, tin, excludeVendorId) => {
  const { rows } = await query(
    `SELECT id, legal_name FROM vendors
      WHERE state_id = $1
        AND lower(tin) = lower($2)
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [stateId, tin, excludeVendorId || null]
  );
  return rows[0] || null;
};

const insertVendor = async (client, values) => {
  const { rows } = await client.query(
    `INSERT INTO vendors
       (state_id, legal_name, trading_name, contact_name, contact_phone, contact_email,
        address, tin, registration_number, bank_name, bank_account_name, bank_account_number,
        status, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      values.stateId,
      values.legalName,
      values.tradingName || null,
      values.contactName || null,
      values.contactPhone || null,
      values.contactEmail || null,
      values.address || null,
      values.tin || null,
      values.registrationNumber || null,
      values.bankName || null,
      values.bankAccountName || null,
      values.bankAccountNumber || null,
      values.status,
      values.actorId || null,
      values.actorName || null
    ]
  );
  return rows[0];
};

const updateVendor = async (client, { vendorId, values }) => {
  await client.query(
    `UPDATE vendors
        SET legal_name = $2,
            trading_name = $3,
            contact_name = $4,
            contact_phone = $5,
            contact_email = $6,
            address = $7,
            tin = $8,
            registration_number = $9,
            bank_name = $10,
            bank_account_name = $11,
            bank_account_number = $12,
            status = $13,
            status_reason = $14,
            updated_at = now()
      WHERE id = $1`,
    [
      vendorId,
      values.legalName,
      values.tradingName,
      values.contactName,
      values.contactPhone,
      values.contactEmail,
      values.address,
      values.tin,
      values.registrationNumber,
      values.bankName,
      values.bankAccountName,
      values.bankAccountNumber,
      values.status,
      values.statusReason
    ]
  );
};

const setVendorStatus = async (
  client,
  { vendorId, status, statusReason, screeningNotes, screenedBy, screenedByName, registeredBy, registeredByName }
) => {
  await client.query(
    `UPDATE vendors
        SET status = $2,
            status_reason = $3,
            screening_notes = COALESCE($4, screening_notes),
            screened_by = CASE WHEN $5::uuid IS NULL THEN screened_by ELSE $5::uuid END,
            screened_by_name = CASE WHEN $6::text IS NULL THEN screened_by_name ELSE $6::text END,
            screened_at = CASE WHEN $5::uuid IS NULL THEN screened_at ELSE now() END,
            registered_by = CASE WHEN $7::uuid IS NULL THEN registered_by ELSE $7::uuid END,
            registered_by_name = CASE WHEN $8::text IS NULL THEN registered_by_name ELSE $8::text END,
            registered_at = CASE WHEN $7::uuid IS NULL THEN registered_at ELSE now() END,
            updated_at = now()
      WHERE id = $1`,
    [
      vendorId,
      status,
      statusReason || null,
      screeningNotes === undefined ? null : screeningNotes,
      screenedBy || null,
      screenedByName || null,
      registeredBy || null,
      registeredByName || null
    ]
  );
};

const insertStatusHistory = async (
  client,
  { vendorId, stateId, fromStatus, toStatus, reason, actorId, actorName }
) => {
  await client.query(
    `INSERT INTO vendor_status_history
       (vendor_id, state_id, from_status, to_status, reason, actor_user_id, actor_full_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [vendorId, stateId, fromStatus || null, toStatus, reason || null, actorId || null, actorName || null]
  );
};

const listStatusHistory = async (vendorId) => {
  const { rows } = await query(
    `SELECT from_status, to_status, reason, actor_full_name, created_at
       FROM vendor_status_history
      WHERE vendor_id = $1
      ORDER BY created_at DESC`,
    [vendorId]
  );
  return rows;
};

const findUserByEmail = async (email) => {
  const { rows } = await query('SELECT id, email FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
};

const insertVendorUser = async (client, { email, fullName, passwordHash }) => {
  const { rows } = await client.query(
    `INSERT INTO users (email, full_name, password_hash, password_changed_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, email, full_name`,
    [email, fullName, passwordHash]
  );
  return rows[0];
};

const linkVendorUser = async (client, { vendorId, userId, isPrimary }) => {
  await client.query(
    `INSERT INTO vendor_users (vendor_id, user_id, is_primary)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET vendor_id = EXCLUDED.vendor_id, is_active = TRUE`,
    [vendorId, userId, Boolean(isPrimary)]
  );
};

const listVendorUsers = async (vendorId) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, vu.is_primary, u.is_active, u.last_login_at
       FROM vendor_users vu
       JOIN users u ON u.id = vu.user_id
      WHERE vu.vendor_id = $1
      ORDER BY vu.is_primary DESC, u.full_name`,
    [vendorId]
  );
  return rows;
};

const stockSelect = `
  SELECT vs.*, sd.code AS drug_code, sd.name AS drug_name, sd.strength, sd.dosage_form,
         sd.unit_of_measure, sd.is_active AS drug_is_active
    FROM vendor_stock vs
    JOIN state_drugs sd ON sd.id = vs.state_drug_id
`;

const listStock = async (vendorId, { activeOnly = false } = {}) => {
  const { rows } = await query(
    `${stockSelect}
      WHERE vs.vendor_id = $1
        AND ($2::boolean = FALSE OR vs.is_active = TRUE)
      ORDER BY sd.name, vs.expiry_date, vs.batch_number`,
    [vendorId, activeOnly]
  );
  return rows;
};

const findStockLine = async (vendorId, stockId, client) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    `${stockSelect} WHERE vs.vendor_id = $1 AND vs.id = $2`,
    [vendorId, stockId]
  );
  return rows[0] || null;
};

const findStockDuplicate = async ({ vendorId, stateDrugId, batchNumber, expiryDate, excludeId }) => {
  const { rows } = await query(
    `SELECT id FROM vendor_stock
      WHERE vendor_id = $1
        AND state_drug_id = $2
        AND lower(batch_number) = lower($3)
        AND expiry_date = $4::date
        AND ($5::uuid IS NULL OR id <> $5::uuid)`,
    [vendorId, stateDrugId, batchNumber, expiryDate, excludeId || null]
  );
  return rows[0] || null;
};

const insertStockLine = async (client, values) => {
  const { rows } = await client.query(
    `INSERT INTO vendor_stock
       (vendor_id, state_drug_id, vendor_sku, batch_number, expiry_date,
        quantity_available, unit_price, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
     RETURNING id`,
    [
      values.vendorId,
      values.stateDrugId,
      values.vendorSku || null,
      values.batchNumber,
      values.expiryDate,
      values.quantityAvailable,
      values.unitPrice,
      values.actorId || null,
      values.actorName || null
    ]
  );
  return rows[0];
};

const updateStockLine = async (client, { stockId, vendorId, values }) => {
  await client.query(
    `UPDATE vendor_stock
        SET vendor_sku = $3,
            batch_number = $4,
            expiry_date = $5::date,
            quantity_available = $6,
            unit_price = $7,
            is_active = $8,
            updated_at = now()
      WHERE id = $1 AND vendor_id = $2`,
    [
      stockId,
      vendorId,
      values.vendorSku,
      values.batchNumber,
      values.expiryDate,
      values.quantityAvailable,
      values.unitPrice,
      values.isActive
    ]
  );
};

const findStateDrug = async (stateId, drugId) => {
  const { rows } = await query(
    `SELECT id, code, name, strength, dosage_form, unit_of_measure, is_active
       FROM state_drugs
      WHERE state_id = $1 AND id = $2`,
    [stateId, drugId]
  );
  return rows[0] || null;
};

const searchStateDrugs = async ({ stateId, search, limit }) => {
  const { rows } = await query(
    `SELECT id, code, name, strength, dosage_form, unit_of_measure
       FROM state_drugs
      WHERE state_id = $1
        AND is_active = TRUE
        AND ($2::text IS NULL
             OR name ILIKE '%' || $2 || '%'
             OR COALESCE(generic_name, '') ILIKE '%' || $2 || '%'
             OR COALESCE(code, '') ILIKE '%' || $2 || '%')
      ORDER BY name
      LIMIT $3`,
    [stateId, search || null, limit]
  );
  return rows;
};

module.exports = {
  listVendors,
  findVendor,
  findVendorById,
  findVendorByName,
  findVendorByTin,
  insertVendor,
  updateVendor,
  setVendorStatus,
  insertStatusHistory,
  listStatusHistory,
  findUserByEmail,
  insertVendorUser,
  linkVendorUser,
  listVendorUsers,
  listStock,
  findStockLine,
  findStockDuplicate,
  insertStockLine,
  updateStockLine,
  findStateDrug,
  searchStateDrugs
};

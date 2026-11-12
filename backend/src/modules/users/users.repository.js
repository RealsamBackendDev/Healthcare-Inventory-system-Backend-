const { query } = require('../../database/connection');

const findMembership = async (healthcareCentreId, userId) => {
  const { rows } = await query(
    `SELECT m.id, m.user_id, m.healthcare_centre_id, m.role_id, m.is_active, u.email, u.full_name, u.is_active AS user_active
       FROM user_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.healthcare_centre_id = $1 AND m.user_id = $2`,
    [healthcareCentreId, userId]
  );
  return rows[0] || null;
};

const findByEmail = async (email) => {
  const { rows } = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
};

const findRoleByCode = async (code) => {
  const { rows } = await query('SELECT id, code, name FROM roles WHERE code = $1', [code]);
  return rows[0] || null;
};

const list = async ({ healthcareCentreId, search, isActive, limit, offset }) => {
  const params = [healthcareCentreId, search || null, isActive === undefined ? null : isActive];
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
            m.id AS membership_id, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN user_memberships m ON m.user_id = u.id
       JOIN roles r ON r.id = m.role_id
      WHERE m.healthcare_centre_id = $1
        AND ($2::text IS NULL OR u.full_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
        AND ($3::boolean IS NULL OR u.is_active = $3)
      ORDER BY u.full_name
      LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM users u
       JOIN user_memberships m ON m.user_id = u.id
      WHERE m.healthcare_centre_id = $1
        AND ($2::text IS NULL OR u.full_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
        AND ($3::boolean IS NULL OR u.is_active = $3)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const createUser = async (client, { email, fullName, passwordHash }) => {
  const { rows } = await client.query(
    `INSERT INTO users (email, full_name, password_hash, must_change_password)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, email, full_name, is_active, must_change_password, created_at`,
    [email, fullName, passwordHash]
  );
  return rows[0];
};

const createMembership = async (client, { userId, healthcareCentreId, roleId }) => {
  const { rows } = await client.query(
    `INSERT INTO user_memberships (user_id, healthcare_centre_id, role_id)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, healthcare_centre_id, role_id, is_active`,
    [userId, healthcareCentreId, roleId]
  );
  return rows[0];
};

const updateUser = async (client, userId, { fullName, isActive }) => {
  const { rows } = await client.query(
    `UPDATE users
        SET full_name = COALESCE($2, full_name),
            is_active = COALESCE($3, is_active),
            token_version = CASE WHEN $3 IS DISTINCT FROM NULL AND $3 <> is_active THEN token_version + 1 ELSE token_version END,
            updated_at = now()
      WHERE id = $1
      RETURNING id, email, full_name, is_active, must_change_password`,
    [userId, fullName || null, isActive === undefined ? null : isActive]
  );
  return rows[0];
};

const updateMembershipRole = async (client, membershipId, roleId) => {
  await client.query('UPDATE user_memberships SET role_id = $2 WHERE id = $1', [membershipId, roleId]);
};

const setPassword = async (client, userId, passwordHash) => {
  await client.query(
    `UPDATE users
        SET password_hash = $2,
            must_change_password = TRUE,
            password_changed_at = now(),
            failed_login_attempts = 0,
            locked_until = NULL,
            token_version = token_version + 1,
            updated_at = now()
      WHERE id = $1`,
    [userId, passwordHash]
  );
};

const getSettings = async (healthcareCentreId) => {
  const { rows } = await query(
    'SELECT key, value, description, updated_at FROM system_settings WHERE healthcare_centre_id = $1 ORDER BY key',
    [healthcareCentreId]
  );
  return rows;
};

const upsertSetting = async (client, { healthcareCentreId, key, value, description, actorId }) => {
  await client.query(
    `INSERT INTO system_settings (healthcare_centre_id, key, value, description, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (healthcare_centre_id, key)
     DO UPDATE SET value = EXCLUDED.value, description = COALESCE(EXCLUDED.description, system_settings.description),
                   updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [healthcareCentreId, key, String(value), description || null, actorId]
  );
};

module.exports = {
  findMembership,
  findByEmail,
  findRoleByCode,
  list,
  createUser,
  createMembership,
  updateUser,
  updateMembershipRole,
  setPassword,
  getSettings,
  upsertSetting
};

const { query } = require('../../database/connection');

const findByEmail = async (email) => {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
};

const findById = async (userId) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
};

const getMemberships = async (userId) => {
  const { rows } = await query(
    `SELECT m.id, m.healthcare_centre_id, m.role_id, r.code AS role_code, r.name AS role_name,
            hc.name AS centre_name, hc.code AS centre_code
       FROM user_memberships m
       JOIN roles r ON r.id = m.role_id
       JOIN healthcare_centres hc ON hc.id = m.healthcare_centre_id
      WHERE m.user_id = $1 AND m.is_active = TRUE AND hc.is_active = TRUE
      ORDER BY hc.name`,
    [userId]
  );
  return rows;
};

const getPermissions = async (roleId) => {
  const { rows } = await query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.code`,
    [roleId]
  );
  return rows.map((row) => row.code);
};

const recordFailedLogin = async (userId, attempts, lockedUntil) => {
  await query(
    'UPDATE users SET failed_login_attempts = $2, locked_until = $3, updated_at = now() WHERE id = $1',
    [userId, attempts, lockedUntil]
  );
};

const recordSuccessfulLogin = async (userId) => {
  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1',
    [userId]
  );
};

const updatePassword = async (client, userId, passwordHash) => {
  const { rows } = await client.query(
    `UPDATE users
        SET password_hash = $2,
            password_changed_at = now(),
            must_change_password = FALSE,
            failed_login_attempts = 0,
            locked_until = NULL,
            token_version = token_version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING token_version`,
    [userId, passwordHash]
  );
  return rows[0];
};

const revokeSessions = async (client, userId) => {
  const { rows } = await client.query(
    'UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1 RETURNING token_version',
    [userId]
  );
  return rows[0];
};

module.exports = {
  findByEmail,
  findById,
  getMemberships,
  getPermissions,
  recordFailedLogin,
  recordSuccessfulLogin,
  updatePassword,
  revokeSessions
};

const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { pool } = require('../connection');
const {
  ROLE_DEFINITIONS,
  PERMISSION_DEFINITIONS,
  SETTING_KEYS
} = require('../../shared/constants');
const { DEFAULT_SETTINGS } = require('../../shared/utils/settings');

const ensureOrganisation = async (client) => {
  const { rows: stateRows } = await client.query(
    `INSERT INTO states (name, code)
     VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [environment.bootstrap.stateName, environment.bootstrap.stateCode]
  );

  const { rows: localGovernmentRows } = await client.query(
    `INSERT INTO local_governments (state_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (state_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [stateRows[0].id, environment.bootstrap.localGovernmentName, environment.bootstrap.localGovernmentCode]
  );

  const { rows: centreRows } = await client.query(
    `INSERT INTO healthcare_centres (local_government_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, code`,
    [localGovernmentRows[0].id, environment.bootstrap.centreName, environment.bootstrap.centreCode]
  );

  return centreRows[0];
};

const ensurePermissions = async (client) => {
  const permissionIds = new Map();
  for (const definition of PERMISSION_DEFINITIONS) {
    const { rows } = await client.query(
      `INSERT INTO permissions (code, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id, code`,
      [definition.code, definition.name, definition.description]
    );
    permissionIds.set(rows[0].code, rows[0].id);
  }
  return permissionIds;
};

const ensureRoles = async (client, permissionIds) => {
  const roleIds = new Map();
  for (const definition of ROLE_DEFINITIONS) {
    const { rows } = await client.query(
      `INSERT INTO roles (code, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id, code`,
      [definition.code, definition.name, definition.description]
    );
    const roleId = rows[0].id;
    roleIds.set(rows[0].code, roleId);
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const code of definition.permissions) {
      const permissionId = permissionIds.get(code);
      if (permissionId) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [roleId, permissionId]
        );
      }
    }
  }
  return roleIds;
};

const ensureAdministrator = async (client, centreId, administratorRoleId) => {
  const email = environment.bootstrap.adminEmail;
  const { rows: existingRows } = await client.query(
    'SELECT id, email, full_name FROM users WHERE lower(email) = lower($1)',
    [email]
  );

  let user = existingRows[0];
  if (!user) {
    const passwordHash = await bcrypt.hash(environment.bootstrap.adminPassword, environment.security.bcryptRounds);
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, password_changed_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, email, full_name`,
      [email, environment.bootstrap.adminFullName, passwordHash]
    );
    user = rows[0];
    console.log(`Created administrator account ${user.email}`);
  }

  await client.query(
    `INSERT INTO user_memberships (user_id, healthcare_centre_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, healthcare_centre_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = TRUE`,
    [user.id, centreId, administratorRoleId]
  );

  return user;
};

const ensureSettings = async (client, centreId) => {
  const descriptions = {
    [SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD]: 'Maximum quantity a staff member may adjust without approval',
    [SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD]: 'Maximum monetary value a staff member may adjust without approval',
    [SETTING_KEYS.NEAR_EXPIRY_DAYS]: 'Days before expiry that count as near expiry'
  };

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await client.query(
      `INSERT INTO system_settings (healthcare_centre_id, key, value, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (healthcare_centre_id, key) DO NOTHING`,
      [centreId, key, value, descriptions[key] || null]
    );
  }
};

const bootstrap = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const centre = await ensureOrganisation(client);
    const permissionIds = await ensurePermissions(client);
    const roleIds = await ensureRoles(client, permissionIds);
    const administrator = await ensureAdministrator(client, centre.id, roleIds.get('ADMINISTRATOR'));
    await ensureSettings(client, centre.id);
    await client.query('COMMIT');
    console.log(`Bootstrap complete for ${centre.name} (${centre.code})`);
    console.log(`Administrator: ${administrator.email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

bootstrap()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Bootstrap failed', error.message);
    await pool.end();
    process.exit(1);
  });

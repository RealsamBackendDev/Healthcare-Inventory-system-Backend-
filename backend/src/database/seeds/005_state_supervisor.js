const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { pool } = require('../connection');
const { ROLES } = require('../../shared/constants');

const supervisor = {
  email: process.env.SUPERVISOR_EMAIL || 'supervisor@state.local',
  fullName: process.env.SUPERVISOR_NAME || 'State Supervisor',
  password: process.env.SUPERVISOR_PASSWORD || 'Supervisor123!',
  roleCode: ROLES.SYSTEM_ADMIN
};

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: governmentRows } = await client.query(
      'SELECT id, name FROM local_governments ORDER BY created_at LIMIT 1'
    );
    if (!governmentRows[0]) {
      throw new Error('No local government found. Run the bootstrap and phase 2 seeds first');
    }
    const localGovernment = governmentRows[0];

    const { rows: roleRows } = await client.query('SELECT id, code FROM roles WHERE code = $1', [
      supervisor.roleCode
    ]);
    if (!roleRows[0]) {
      throw new Error(`Role ${supervisor.roleCode} is missing. Run the bootstrap seed first`);
    }

    const { rows: existingRows } = await client.query(
      'SELECT id, email FROM users WHERE lower(email) = lower($1)',
      [supervisor.email]
    );

    let account = existingRows[0];
    if (!account) {
      const passwordHash = await bcrypt.hash(supervisor.password, environment.security.bcryptRounds);
      const { rows } = await client.query(
        `INSERT INTO users (email, full_name, password_hash, password_changed_at)
         VALUES ($1, $2, $3, now())
         RETURNING id, email`,
        [supervisor.email, supervisor.fullName, passwordHash]
      );
      account = rows[0];
    } else {
      const passwordHash = await bcrypt.hash(supervisor.password, environment.security.bcryptRounds);
      await client.query(
        `UPDATE users
            SET password_hash = $2,
                password_changed_at = now(),
                must_change_password = FALSE,
                is_active = TRUE,
                updated_at = now()
          WHERE id = $1`,
        [account.id, passwordHash]
      );
    }

    await client.query(
      `INSERT INTO user_memberships (user_id, healthcare_centre_id, local_government_id, role_id)
       VALUES ($1, NULL, $2, $3)
       ON CONFLICT DO NOTHING`,
      [account.id, localGovernment.id, roleRows[0].id]
    );

    await client.query(
      `UPDATE user_memberships
          SET role_id = $3, is_active = TRUE
        WHERE user_id = $1 AND local_government_id = $2 AND healthcare_centre_id IS NULL`,
      [account.id, localGovernment.id, roleRows[0].id]
    );

    await client.query('COMMIT');

    console.log('Supervisor account ready');
    console.log(`  Email: ${account.email}`);
    console.log(`  Password: ${supervisor.password}`);
    console.log(`  Role: ${supervisor.roleCode} (all permissions, bases on ${localGovernment.name})`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Supervisor seed failed', error.message);
    await pool.end();
    process.exit(1);
  });

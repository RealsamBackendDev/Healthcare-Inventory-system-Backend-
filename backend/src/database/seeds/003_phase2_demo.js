const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { pool } = require('../connection');
const { ROLES, SETTING_KEYS } = require('../../shared/constants');
const { DEFAULT_LOCAL_GOVERNMENT_SETTINGS } = require('../../shared/utils/settings');

const pilotCentres = [
  { name: 'PHC Agodi', code: 'PHC-AGD' },
  { name: 'PHC Oke Are', code: 'PHC-OKE' }
];

const secondLocalGovernment = {
  name: 'Ibadan South-West',
  code: 'IBSW',
  centres: [
    { name: 'PHC Ring Road', code: 'PHC-RRD' },
    { name: 'PHC Oja Oba', code: 'PHC-OJO' }
  ]
};

const demoUsers = [
  { email: 'logistician.one@lg.local', fullName: 'Kemi Adebayo', roleCode: ROLES.LG_INVENTORY_OFFICER, localGovernmentCode: 'pilot' },
  { email: 'logistician.two@lg.local', fullName: 'Tunde Bakare', roleCode: ROLES.LG_INVENTORY_OFFICER, localGovernmentCode: 'pilot' },
  { email: 'lg.admin@lg.local', fullName: 'Bisi Ogunleye', roleCode: ROLES.LG_ADMIN, localGovernmentCode: 'pilot' },
  { email: 'logistician.sw@lg.local', fullName: 'Ngozi Eze', roleCode: ROLES.LG_INVENTORY_OFFICER, localGovernmentCode: 'IBSW' }
];

const ensureState = async (client) => {
  const { rows } = await client.query(
    `INSERT INTO states (name, code)
     VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [environment.bootstrap.stateName, environment.bootstrap.stateCode]
  );
  return rows[0].id;
};

const ensureLocalGovernment = async (client, stateId, name, code) => {
  const { rows } = await client.query(
    `INSERT INTO local_governments (state_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (state_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, code`,
    [stateId, name, code]
  );
  return rows[0];
};

const findPilotLocalGovernment = async (client) => {
  const { rows } = await client.query(
    'SELECT id, name, code FROM local_governments WHERE code = $1',
    [environment.bootstrap.localGovernmentCode]
  );
  if (!rows[0]) {
    throw new Error('Pilot local government is missing. Run the bootstrap seed first');
  }
  return rows[0];
};

const ensureCentre = async (client, localGovernmentId, name, code) => {
  const { rows } = await client.query(
    `INSERT INTO healthcare_centres (local_government_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, code`,
    [localGovernmentId, name, code]
  );
  const centre = rows[0];

  await client.query(
    `INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
     VALUES ($1, $2, 'facility', $3, $4)
     ON CONFLICT DO NOTHING`,
    [localGovernmentId, centre.id, `${centre.name} Main Store`, `${centre.code}-MAIN`]
  );

  return centre;
};

const ensureWarehouse = async (client, localGovernment) => {
  await client.query(
    `INSERT INTO stock_locations (local_government_id, location_type, name, code)
     VALUES ($1, 'lg_warehouse', $2, $3)
     ON CONFLICT DO NOTHING`,
    [localGovernment.id, `${localGovernment.name} LG Medical Warehouse`, `${localGovernment.code}-WAREHOUSE`]
  );
};

const ensureLocalGovernmentSettings = async (client, localGovernmentId) => {
  const descriptions = {
    [SETTING_KEYS.LG_RECEIPT_QUANTITY_THRESHOLD]: 'Quantity above which a warehouse receipt needs a second Logistician',
    [SETTING_KEYS.LG_RECEIPT_VALUE_THRESHOLD]: 'Value above which a warehouse receipt needs a second Logistician',
    [SETTING_KEYS.LG_DISPATCH_QUANTITY_THRESHOLD]: 'Quantity above which a dispatch needs a second Logistician',
    [SETTING_KEYS.LG_CORRECTION_QUANTITY_THRESHOLD]: 'Quantity above which a warehouse correction needs a second Logistician',
    [SETTING_KEYS.LG_CORRECTION_VALUE_THRESHOLD]: 'Value above which a warehouse correction needs a second Logistician',
    [SETTING_KEYS.LG_APPROVAL_WINDOW_HOURS]: 'Window for adding up threshold-gated actions by the same person'
  };

  for (const [key, value] of Object.entries(DEFAULT_LOCAL_GOVERNMENT_SETTINGS)) {
    await client.query(
      `INSERT INTO system_settings (local_government_id, key, value, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [localGovernmentId, key, value, descriptions[key] || null]
    );
  }
};

const ensureLocalGovernmentUser = async (client, user, localGovernment, password) => {
  const { rows: roleRows } = await client.query('SELECT id, code FROM roles WHERE code = $1', [user.roleCode]);
  if (!roleRows[0]) {
    throw new Error(`Role ${user.roleCode} is missing. Run the bootstrap seed first`);
  }

  const { rows: existingRows } = await client.query(
    'SELECT id, email FROM users WHERE lower(email) = lower($1)',
    [user.email]
  );

  let account = existingRows[0];
  if (!account) {
    const passwordHash = await bcrypt.hash(password, environment.security.bcryptRounds);
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, must_change_password)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, email`,
      [user.email, user.fullName, passwordHash]
    );
    account = rows[0];
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

  return account;
};

const seed = async () => {
  const client = await pool.connect();
  const password = process.env.LG_USER_PASSWORD || 'Logistician123!';
  try {
    await client.query('BEGIN');

    const stateId = await ensureState(client);
    const pilot = await findPilotLocalGovernment(client);
    const second = await ensureLocalGovernment(client, stateId, secondLocalGovernment.name, secondLocalGovernment.code);

    await ensureWarehouse(client, pilot);
    await ensureWarehouse(client, second);
    await ensureLocalGovernmentSettings(client, pilot.id);
    await ensureLocalGovernmentSettings(client, second.id);

    for (const centre of pilotCentres) {
      await ensureCentre(client, pilot.id, centre.name, centre.code);
    }
    for (const centre of secondLocalGovernment.centres) {
      await ensureCentre(client, second.id, centre.name, centre.code);
    }

    const created = [];
    for (const demoUser of demoUsers) {
      const localGovernment = demoUser.localGovernmentCode === 'pilot' ? pilot : second;
      const account = await ensureLocalGovernmentUser(client, demoUser, localGovernment, password);
      created.push({ email: account.email, role: demoUser.roleCode, localGovernment: localGovernment.name });
    }

    await client.query('COMMIT');

    console.log(`Phase 2 demo data ready for ${pilot.name} and ${second.name}`);
    created.forEach((account) => {
      console.log(`  ${account.role}: ${account.email} (${account.localGovernment})`);
    });
    console.log(`  Password for these accounts: ${password}`);
    console.log('  Each account must change its password at first sign in');
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
    console.error('Phase 2 demo seed failed', error.message);
    await pool.end();
    process.exit(1);
  });

const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { pool } = require('../connection');
const { ROLES } = require('../../shared/constants');

const centres = [
  {
    name: 'Ilora PHC',
    code: 'PHC-ILR',
    officerName: 'Ilora PHC Store Officer',
    officerEmail: 'ilora.phc@afijio.local'
  },
  {
    name: 'Jafu PHC',
    code: 'PHC-JAF',
    officerName: 'Jafu PHC Store Officer',
    officerEmail: 'jafu.phc@afijio.local'
  },
  {
    name: 'Iware PHC',
    code: 'PHC-IWR',
    officerName: 'Iware PHC Store Officer',
    officerEmail: 'iware.phc@afijio.local'
  }
];

const openingStock = [
  { drugCode: 'PARA-500', quantity: 800, expiryOffsetDays: 240, unitCost: 12.5 },
  { drugCode: 'AMOX-250', quantity: 120, expiryOffsetDays: 150, unitCost: 24 },
  { drugCode: 'ORS-001', quantity: 60, expiryOffsetDays: 300, unitCost: 18 },
  { drugCode: 'ARTEM-80480', quantity: 260, expiryOffsetDays: 210, unitCost: 180 },
  { drugCode: 'IBU-400', quantity: 420, expiryOffsetDays: 365, unitCost: 9.5 },
  { drugCode: 'METRO-200', quantity: 90, expiryOffsetDays: 40, unitCost: 14 },
  { drugCode: 'CET-10', quantity: 150, expiryOffsetDays: 25, unitCost: 8, batchNumber: 'OPEN-EXPIRING' },
  { drugCode: 'FOLIC-5', quantity: 500, expiryOffsetDays: 400, unitCost: 6 }
];

const sourceReference = 'AFIJIO-CENTRE-SEED';

const resolveLocalGovernment = async (client) => {
  const { rows } = await client.query(
    `SELECT id, name, code
       FROM local_governments
      WHERE lower(code) = lower($1)
         OR lower(name) = lower($2)
         OR lower(code) LIKE '%afijio%'
         OR lower(name) LIKE '%afijio%'
      ORDER BY CASE WHEN lower(code) = lower($1) THEN 0 ELSE 1 END
      LIMIT 1`,
    [environment.bootstrap.localGovernmentCode, 'Afijio']
  );

  if (!rows[0]) {
    throw new Error('Afijio local government was not found. Check LOCAL_GOVERNMENT_CODE in .env');
  }

  return rows[0];
};
const ensureCentre = async (client, localGovernmentId, centre) => {
  const { rows } = await client.query(
    `INSERT INTO healthcare_centres (local_government_id, name, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, code`,
    [localGovernmentId, centre.name, centre.code]
  );
  const stored = rows[0];

  const { rows: locationRows } = await client.query(
    `INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
     VALUES ($1, $2, 'facility', $3, $4)
     ON CONFLICT (local_government_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, code`,
    [localGovernmentId, stored.id, `${stored.name} Main Store`, `${stored.code}-MAIN`]
  );

  return { ...stored, location: locationRows[0] };
};

const ensureOfficer = async (client, centre, roleId, password) => {
  const { rows: existingRows } = await client.query(
    'SELECT id, email FROM users WHERE lower(email) = lower($1)',
    [centre.officerEmail]
  );

  let user = existingRows[0];

  if (!user) {
    const passwordHash = await bcrypt.hash(password, environment.security.bcryptRounds);
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, must_change_password)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, email`,
      [centre.officerEmail, centre.officerName, passwordHash]
    );
    user = rows[0];
  }

  await client.query(
    `INSERT INTO user_memberships (user_id, healthcare_centre_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, healthcare_centre_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = TRUE`,
    [user.id, centre.id, roleId]
  );

  return user;
};

const addOpeningStock = async (client, localGovernment, centre, officer) => {
  const added = [];

  for (const line of openingStock) {
    const { rows: drugRows } = await client.query(
      'SELECT id FROM drugs WHERE local_government_id = $1 AND lower(code) = lower($2)',
      [localGovernment.id, line.drugCode]
    );

    if (!drugRows[0]) {
      continue;
    }

    const batchNumber = line.batchNumber || `OPEN-${line.drugCode}`;
    const { rows: existingRows } = await client.query(
      'SELECT id FROM batches WHERE stock_location_id = $1 AND drug_id = $2 AND batch_number = $3',
      [centre.location.id, drugRows[0].id, batchNumber]
    );

    if (existingRows[0]) {
      continue;
    }

    const expiryDate = new Date(Date.now() + line.expiryOffsetDays * 86400000)
      .toISOString()
      .slice(0, 10);

    const { rows: batchRows } = await client.query(
      `INSERT INTO batches
         (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
          expiry_date, quantity, unit_cost, supplier_reference, received_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
       RETURNING id`,
      [
        centre.id,
        localGovernment.id,
        centre.location.id,
        drugRows[0].id,
        batchNumber,
        expiryDate,
        line.quantity,
        line.unitCost,
        sourceReference
      ]
    );

    await client.query(
      `INSERT INTO stock_movements
         (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
          actor_user_id, actor_full_name, source_reference)
       VALUES ($1, $2, $3, 'opening_stock', $4, $5, $6, $7, $8)`,
      [
        centre.id,
        drugRows[0].id,
        batchRows[0].id,
        line.quantity,
        'Opening stock for newly created Afijio centre',
        officer.id,
        officer.fullName || centre.officerName,
        sourceReference
      ]
    );

    added.push(`${line.drugCode} ${line.quantity}`);
  }

  return added;
};

const seedAfijioCentres = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const localGovernment = await resolveLocalGovernment(client);
    const { rows: roleRows } = await client.query('SELECT id FROM roles WHERE code = $1', [
      ROLES.STAFF
    ]);

    if (!roleRows[0]) {
      throw new Error('Staff role is missing. Run the bootstrap seed first');
    }

    const password = process.env.FACILITY_USER_PASSWORD || 'Facility123!';
    const created = [];

    for (const centre of centres) {
      const stored = await ensureCentre(client, localGovernment.id, centre);
      const officer = await ensureOfficer(
        client,
        { ...stored, officerEmail: centre.officerEmail, officerName: centre.officerName },
        roleRows[0].id,
        password
      );
      const officerRow = await client.query('SELECT full_name FROM users WHERE id = $1', [
        officer.id
      ]);
      const stock = await addOpeningStock(
        client,
        localGovernment,
        stored,
        { id: officer.id, fullName: officerRow.rows[0].full_name }
      );
      created.push({ centre: stored, officer: officer.email, stock });
    }

    await client.query('COMMIT');

    console.log(`Afijio centres ready in ${localGovernment.name} (${localGovernment.code})`);
    created.forEach((entry) => {
      console.log(`  ${entry.centre.name} (${entry.centre.code})`);
      console.log(`    Store: ${entry.centre.location.name}`);
      console.log(`    Officer: ${entry.officer}`);
      console.log(
        `    Opening stock: ${entry.stock.length > 0 ? entry.stock.join(', ') : 'already present'}`
      );
    });
    console.log(`  Password for the new centre accounts: ${password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

seedAfijioCentres()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Afijio centres seed failed');
    console.error(error.message);
    process.exit(1);
  });

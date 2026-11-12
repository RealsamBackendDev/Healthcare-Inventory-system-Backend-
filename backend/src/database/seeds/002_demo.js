const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { pool } = require('../connection');
const { ROLES, BATCH_STATUS, MOVEMENT_TYPES, REQUISITION_STATUS, ADJUSTMENT_STATUS, RETURN_STATUS } = require('../../shared/constants');

const demoDrugs = [
  { code: 'PARA-500', name: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 500 },
  { code: 'AMOX-250', name: 'Amoxicillin', strength: '250 mg', dosageForm: 'Capsule', unitOfMeasure: 'capsule', minimumStockLevel: 400 },
  { code: 'ARTEM-80480', name: 'Artemether/Lumefantrine', strength: '80/480 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 200 },
  { code: 'ORS-001', name: 'Oral Rehydration Salts', strength: '20.5 g', dosageForm: 'Sachet', unitOfMeasure: 'sachet', minimumStockLevel: 300 },
  { code: 'IBU-400', name: 'Ibuprofen', strength: '400 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 300 },
  { code: 'METRO-200', name: 'Metronidazole', strength: '200 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 200 },
  { code: 'CET-10', name: 'Cetirizine', strength: '10 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 100 },
  { code: 'FOLIC-5', name: 'Folic Acid', strength: '5 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 150 },
  { code: 'VITC-100', name: 'Vitamin C', strength: '100 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 200 },
  { code: 'SALB-100', name: 'Salbutamol', strength: '100 mcg', dosageForm: 'Inhaler', unitOfMeasure: 'inhaler', minimumStockLevel: 20 },
  { code: 'COTRIM-480', name: 'Co-trimoxazole', strength: '480 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 250 },
  { code: 'DICLO-50', name: 'Diclofenac', strength: '50 mg', dosageForm: 'Tablet', unitOfMeasure: 'tablet', minimumStockLevel: 100 }
];

const demoBatches = [
  { drugCode: 'PARA-500', batchNumber: 'B-PARA-001', quantity: 1200, expiryOffsetDays: 180, unitCost: 12.5 },
  { drugCode: 'PARA-500', batchNumber: 'B-PARA-002', quantity: 300, expiryOffsetDays: 45, unitCost: 13 },
  { drugCode: 'PARA-500', batchNumber: 'B-PARA-003', quantity: 50, expiryOffsetDays: 200, unitCost: 12, status: BATCH_STATUS.QUARANTINED },
  { drugCode: 'AMOX-250', batchNumber: 'B-AMOX-001', quantity: 150, expiryOffsetDays: 20, unitCost: 24 },
  { drugCode: 'AMOX-250', batchNumber: 'B-AMOX-002', quantity: 200, expiryOffsetDays: -3, unitCost: 23, status: BATCH_STATUS.EXPIRED },
  { drugCode: 'ARTEM-80480', batchNumber: 'B-ART-001', quantity: 60, expiryOffsetDays: 200, unitCost: 180 },
  { drugCode: 'IBU-400', batchNumber: 'B-IBU-001', quantity: 650, expiryOffsetDays: 365, unitCost: 9.5 },
  { drugCode: 'METRO-200', batchNumber: 'B-MET-001', quantity: 480, expiryOffsetDays: 90, unitCost: 14 },
  { drugCode: 'CET-10', batchNumber: 'B-CET-001', quantity: 40, expiryOffsetDays: 25, unitCost: 8 },
  { drugCode: 'FOLIC-5', batchNumber: 'B-FOL-001', quantity: 300, expiryOffsetDays: 400, unitCost: 6 },
  { drugCode: 'VITC-100', batchNumber: 'B-VIT-001', quantity: 500, expiryOffsetDays: 60, unitCost: 7.5 },
  { drugCode: 'SALB-100', batchNumber: 'B-SAL-001', quantity: 12, expiryOffsetDays: 700, unitCost: 950 },
  { drugCode: 'COTRIM-480', batchNumber: 'B-COT-001', quantity: 320, expiryOffsetDays: -1, unitCost: 15, status: BATCH_STATUS.EXPIRED },
  { drugCode: 'DICLO-50', batchNumber: 'B-DIC-001', quantity: 210, expiryOffsetDays: 150, unitCost: 10 }
];

const ensureStaff = async (client, centreId) => {
  const staffEmail = process.env.STAFF_EMAIL || 'staff@healthcentre.local';
  const staffPassword = process.env.STAFF_PASSWORD || 'Staff123!';
  const { rows: roleRows } = await client.query('SELECT id FROM roles WHERE code = $1', [ROLES.STAFF]);
  if (!roleRows[0]) {
    throw new Error('Staff role is missing. Run the bootstrap seed first');
  }

  const { rows: existingRows } = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [staffEmail]);
  let staff = existingRows[0];

  if (!staff) {
    const passwordHash = await bcrypt.hash(staffPassword, environment.security.bcryptRounds);
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, password_changed_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, email`,
      [staffEmail, 'Demo Staff Member', passwordHash]
    );
    staff = rows[0];
  }

  await client.query(
    `INSERT INTO user_memberships (user_id, healthcare_centre_id, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, healthcare_centre_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = TRUE`,
    [staff.id, centreId, roleRows[0].id]
  );

  return staff;
};

const seedDemo = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: centreRows } = await client.query('SELECT id, name FROM healthcare_centres WHERE code = $1', [
      environment.bootstrap.centreCode
    ]);
    const centre = centreRows[0];
    if (!centre) {
      throw new Error('Healthcare centre is missing. Run the bootstrap seed first');
    }

    const { rows: drugCountRows } = await client.query(
      'SELECT count(*)::int AS count FROM drugs WHERE healthcare_centre_id = $1',
      [centre.id]
    );
    if (drugCountRows[0].count > 0) {
      await client.query('ROLLBACK');
      console.log('Demo data already present, skipping');
      return;
    }

    const staff = await ensureStaff(client, centre.id);
    const { rows: adminRows } = await client.query(
      `SELECT u.id, u.full_name
         FROM users u
         JOIN user_memberships m ON m.user_id = u.id
         JOIN roles r ON r.id = m.role_id
        WHERE m.healthcare_centre_id = $1 AND r.code = $2
        ORDER BY u.created_at
        LIMIT 1`,
      [centre.id, ROLES.ADMINISTRATOR]
    );
    const administrator = adminRows[0] || { id: staff.id, full_name: 'Demo Staff Member' };

    const drugIds = new Map();
    for (const drug of demoDrugs) {
      const { rows } = await client.query(
        `INSERT INTO drugs
           (healthcare_centre_id, code, name, generic_name, brand_name, strength, dosage_form, unit_of_measure, minimum_stock_level, created_by)
         VALUES ($1, $2, $3, $3, NULL, $4, $5, $6, $7, $8)
         RETURNING id`,
        [centre.id, drug.code, drug.name, drug.strength, drug.dosageForm, drug.unitOfMeasure, drug.minimumStockLevel, administrator.id]
      );
      drugIds.set(drug.code, rows[0].id);
    }

    for (const batch of demoBatches) {
      const { rows } = await client.query(
        `INSERT INTO batches
           (healthcare_centre_id, drug_id, batch_number, expiry_date, quantity, unit_cost, received_date, supplier_reference, status)
         VALUES ($1, $2, $3, (CURRENT_DATE + ($4 * INTERVAL '1 day'))::date, $5, $6, CURRENT_DATE, $7, $8)
         RETURNING id`,
        [
          centre.id,
          drugIds.get(batch.drugCode),
          batch.batchNumber,
          batch.expiryOffsetDays,
          batch.quantity,
          batch.unitCost,
          'DEMO-SUPPLIER',
          batch.status || BATCH_STATUS.USABLE
        ]
      );

      if (batch.quantity > 0) {
        await client.query(
          `INSERT INTO stock_movements
             (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason, actor_user_id, actor_full_name, source_reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            centre.id,
            drugIds.get(batch.drugCode),
            rows[0].id,
            MOVEMENT_TYPES.OPENING_STOCK,
            batch.quantity,
            'Demo opening stock',
            administrator.id,
            administrator.full_name,
            'SEED'
          ]
        );
      }
    }

    const { rows: requisitionRows } = await client.query(
      `INSERT INTO requisitions
         (healthcare_centre_id, requisition_number, status, source, notes, created_by, created_by_name, submitted_at)
       VALUES ($1, $2, $3, 'manual', $4, $5, $6, now())
       RETURNING id`,
      [
        centre.id,
        `REQ-DEMO-${Date.now()}`,
        REQUISITION_STATUS.PENDING_APPROVAL,
        'Restock request for out of stock and low stock items',
        staff.id,
        'Demo Staff Member'
      ]
    );

    for (const item of [
      { code: 'ORS-001', quantity: 500 },
      { code: 'AMOX-250', quantity: 400 }
    ]) {
      await client.query(
        'INSERT INTO requisition_items (requisition_id, drug_id, requested_quantity) VALUES ($1, $2, $3)',
        [requisitionRows[0].id, drugIds.get(item.code), item.quantity]
      );
    }

    await client.query(
      `INSERT INTO requisition_events (requisition_id, event_type, actor_user_id, actor_full_name, comment)
       VALUES ($1, 'submitted', $2, $3, $4)`,
      [requisitionRows[0].id, staff.id, 'Demo Staff Member', 'Submitted for approval']
    );

    const { rows: paraBatchRows } = await client.query(
      'SELECT id FROM batches WHERE healthcare_centre_id = $1 AND batch_number = $2',
      [centre.id, 'B-PARA-001']
    );

    await client.query(
      `INSERT INTO stock_adjustments
         (healthcare_centre_id, drug_id, batch_id, adjustment_type, quantity, reason, status, requested_by, requested_by_name)
       VALUES ($1, $2, $3, 'damage', $4, $5, $6, $7, $8)`,
      [
        centre.id,
        drugIds.get('PARA-500'),
        paraBatchRows[0].id,
        -15,
        'Ten blister packs damaged during shelving',
        ADJUSTMENT_STATUS.PENDING,
        staff.id,
        'Demo Staff Member'
      ]
    );

    const { rows: cetBatchRows } = await client.query(
      'SELECT id FROM batches WHERE healthcare_centre_id = $1 AND batch_number = $2',
      [centre.id, 'B-CET-001']
    );

    const { rows: returnRows } = await client.query(
      `INSERT INTO return_requests
         (healthcare_centre_id, request_number, reason, reference, status, requested_by, requested_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        centre.id,
        `RET-DEMO-${Date.now()}`,
        'Near expiry stock needs quarantine pending supplier collection',
        'DEMO-SUPPLIER',
        RETURN_STATUS.PENDING,
        staff.id,
        'Demo Staff Member'
      ]
    );

    await client.query(
      `INSERT INTO return_request_items (return_request_id, drug_id, batch_id, quantity, disposition)
       VALUES ($1, $2, $3, $4, 'quarantined')`,
      [returnRows[0].id, drugIds.get('CET-10'), cetBatchRows[0].id, 10]
    );

    await client.query(
      `INSERT INTO notifications (healthcare_centre_id, type, title, message, entity_type, entity_id)
       SELECT $1, 'expired_stock', 'Expired stock detected', 'Co-trimoxazole batch B-COT-001 has expired with 320 tablets remaining', 'batch', id
         FROM batches WHERE healthcare_centre_id = $1 AND batch_number = 'B-COT-001'`,
      [centre.id]
    );

    await client.query(
      `INSERT INTO notifications (healthcare_centre_id, type, title, message, entity_type, entity_id)
       SELECT $1, 'near_expiry', 'Batch nearing expiry', 'Amoxicillin batch B-AMOX-001 expires within 30 days', 'batch', id
         FROM batches WHERE healthcare_centre_id = $1 AND batch_number = 'B-AMOX-001'`,
      [centre.id]
    );

    await client.query('COMMIT');
    console.log(`Demo data created for ${centre.name}`);
    console.log('Staff account: staff@healthcentre.local (password from STAFF_PASSWORD or Staff123!)');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

seedDemo()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Demo seed failed', error.message);
    await pool.end();
    process.exit(1);
  });

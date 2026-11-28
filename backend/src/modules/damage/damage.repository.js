const findFacilityLocation = async (executor, healthcareCentreId) => {
  const { rows } = await executor.query(
    `SELECT id, local_government_id
       FROM stock_locations
      WHERE healthcare_centre_id = $1
        AND location_type = 'facility'
        AND is_active = TRUE
      ORDER BY created_at
      LIMIT 1`,
    [healthcareCentreId]
  );
  return rows[0] || null;
};

const listUsableBatches = async (executor, healthcareCentreId) => {
  const { rows } = await executor.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.drug_id, b.unit_cost, b.supplier_reference,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
      WHERE sl.healthcare_centre_id = $1
        AND b.status = 'usable'
        AND b.quantity > 0
      ORDER BY d.name, b.expiry_date NULLS LAST, b.batch_number`,
    [healthcareCentreId]
  );
  return rows;
};

const insertQuarantinedBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'quarantined')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   status = 'quarantined',
                   updated_at = now()
     RETURNING id, quantity::float AS quantity`,
    [
      batch.healthcareCentreId,
      batch.localGovernmentId,
      batch.stockLocationId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.supplierReference || null
    ]
  );
  return rows[0];
};

const listQuarantinedBatches = async (executor, healthcareCentreId) => {
  const { rows } = await executor.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.received_date, b.created_at,
            d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            COALESCE(agg.disposed_quantity, 0)::float AS disposed_quantity,
            agg.last_disposed_at
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
       LEFT JOIN (
            SELECT batch_id, SUM(quantity) AS disposed_quantity, MAX(created_at) AS last_disposed_at
              FROM damage_dispositions
             GROUP BY batch_id
            ) agg ON agg.batch_id = b.id
      WHERE sl.healthcare_centre_id = $1
        AND b.status = 'quarantined'
        AND b.quantity > 0
      ORDER BY b.expiry_date NULLS LAST, d.name, b.batch_number`,
    [healthcareCentreId]
  );
  return rows;
};

const lockBatch = async (client, batchId, healthcareCentreId) => {
  const { rows } = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.drug_id, b.local_government_id,
            b.status, b.stock_location_id, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
      WHERE b.id = $1
        AND sl.healthcare_centre_id = $2
      FOR UPDATE OF b`,
    [batchId, healthcareCentreId]
  );
  return rows[0] || null;
};

const findLotBatch = async (client, { stockLocationId, drugId, batchNumber }) => {
  const { rows } = await client.query(
    `SELECT id, status, quantity::float AS quantity, expiry_date, unit_cost
       FROM batches
      WHERE stock_location_id = $1
        AND drug_id = $2
        AND batch_number = $3
      FOR UPDATE`,
    [stockLocationId, drugId, batchNumber]
  );
  return rows[0] || null;
};

const insertUsableBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'usable')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   unit_cost = COALESCE(batches.unit_cost, EXCLUDED.unit_cost),
                   updated_at = now()
     RETURNING id`,
    [
      batch.healthcareCentreId,
      batch.localGovernmentId,
      batch.stockLocationId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.supplierReference || null
    ]
  );
  return rows[0];
};

const updateBatchQuantity = async (client, { batchId, quantity, status }) => {
  const { rows } = await client.query(
    `UPDATE batches
        SET quantity = $2,
            status = $3,
            updated_at = now()
      WHERE id = $1
      RETURNING quantity::float AS quantity, status`,
    [batchId, quantity, status]
  );
  return rows[0] || null;
};

const insertMovement = async (client, movement) => {
  await client.query(
    `INSERT INTO stock_movements
       (healthcare_centre_id, drug_id, batch_id, movement_type, quantity, reason,
        actor_user_id, actor_full_name, source_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      movement.healthcareCentreId || null,
      movement.drugId,
      movement.batchId,
      movement.movementType,
      movement.quantity,
      movement.reason || null,
      movement.actorId,
      movement.actorName,
      movement.sourceReference || null
    ]
  );
};

const insertDisposition = async (client, record) => {
  const { rows } = await client.query(
    `INSERT INTO damage_dispositions
       (local_government_id, healthcare_centre_id, batch_id, drug_id, batch_number,
        source_reference, quantity, disposition, loss_bearer, replacement_owed,
        agreed_with_name, note, restocked_batch_id, recorded_by, recorded_by_name,
        return_batch_id, return_to_healthcare_centre_id, return_to_name, return_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING id, created_at`,
    [
      record.localGovernmentId,
      record.healthcareCentreId,
      record.batchId,
      record.drugId,
      record.batchNumber,
      record.sourceReference || null,
      record.quantity,
      record.disposition,
      record.lossBearer,
      record.replacementOwed,
      record.agreedWithName,
      record.note,
      record.restockedBatchId || null,
      record.actorId,
      record.actorName,
      record.returnBatchId || null,
      record.returnToHealthcareCentreId || null,
      record.returnToName || null,
      record.returnBatchId ? 'in_transit' : 'none'
    ]
  );
  return rows[0];
};

const listDispositions = async (executor, { healthcareCentreId, limit = 20 }) => {
  const { rows } = await executor.query(
    `SELECT dd.id, dd.batch_id, dd.batch_number, dd.source_reference,
            dd.quantity::float AS quantity, dd.disposition, dd.loss_bearer,
            dd.replacement_owed, dd.agreed_with_name, dd.note,
            dd.recorded_by_name, dd.created_at,
            dd.return_batch_id, dd.return_status, dd.return_outcome, dd.return_to_name,
            d.name AS drug_name, d.unit_of_measure
       FROM damage_dispositions dd
       JOIN drugs d ON d.id = dd.drug_id
      WHERE dd.healthcare_centre_id = $1
      ORDER BY dd.created_at DESC
      LIMIT $2`,
    [healthcareCentreId, limit]
  );
  return rows;
};

const findReturnDestination = async (client, { localGovernmentId, supplierReference }) => {
  if (supplierReference) {
    const { rows } = await client.query(
      `SELECT ft.from_healthcare_centre_id AS healthcare_centre_id,
              ft.from_centre_name AS centre_name,
              sl.id AS stock_location_id
         FROM facility_transfers ft
         JOIN stock_locations sl
           ON sl.healthcare_centre_id = ft.from_healthcare_centre_id
          AND sl.location_type = 'facility'
        WHERE ft.local_government_id = $1
          AND ft.transfer_number = $2
        LIMIT 1`,
      [localGovernmentId, supplierReference]
    );
    if (rows[0]) {
      return {
        type: 'facility',
        healthcareCentreId: rows[0].healthcare_centre_id,
        centreName: rows[0].centre_name,
        stockLocationId: rows[0].stock_location_id
      };
    }
  }

  const transit = await client.query(
    `SELECT id, name
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'in_transit'
      LIMIT 1`,
    [localGovernmentId]
  );
  if (transit.rows[0]) {
    return {
      type: 'transit',
      healthcareCentreId: null,
      centreName: 'the LG warehouse',
      stockLocationId: transit.rows[0].id
    };
  }

  const created = await client.query(
    `INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
     SELECT lg.id, NULL, 'in_transit', lg.name || ' stock in transit', lg.code || '-TRANSIT'
       FROM local_governments lg
      WHERE lg.id = $1
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [localGovernmentId]
  );
  if (created.rows[0]) {
    return {
      type: 'transit',
      healthcareCentreId: null,
      centreName: 'the LG warehouse',
      stockLocationId: created.rows[0].id
    };
  }

  const raced = await client.query(
    `SELECT id
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'in_transit'
      LIMIT 1`,
    [localGovernmentId]
  );
  return {
    type: 'transit',
    healthcareCentreId: null,
    centreName: 'the LG warehouse',
    stockLocationId: raced.rows[0] ? raced.rows[0].id : null
  };
};

const findReturnBatch = async (client, { stockLocationId, drugId, batchNumber }) => {
  const { rows } = await client.query(
    `SELECT id, status, quantity::float AS quantity
       FROM batches
      WHERE stock_location_id = $1
        AND drug_id = $2
        AND batch_number = $3
      FOR UPDATE`,
    [stockLocationId, drugId, batchNumber]
  );
  return rows[0] || null;
};

const insertReturnBatch = async (client, batch) => {
  const { rows } = await client.query(
    `INSERT INTO batches
       (healthcare_centre_id, local_government_id, stock_location_id, drug_id, batch_number,
        expiry_date, quantity, unit_cost, supplier_reference, received_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'returned_pending_inspection')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   status = CASE WHEN batches.status = 'destroyed' AND batches.quantity = 0
                                 THEN 'returned_pending_inspection'
                                 ELSE batches.status END,
                   updated_at = now()
     RETURNING id, quantity::float AS quantity, status`,
    [
      batch.healthcareCentreId || null,
      batch.localGovernmentId,
      batch.stockLocationId,
      batch.drugId,
      batch.batchNumber,
      batch.expiryDate || null,
      batch.quantity,
      batch.unitCost === undefined ? null : batch.unitCost,
      batch.supplierReference || null
    ]
  );
  return rows[0];
};

const listReturnsInTransit = async (executor, healthcareCentreId) => {
  const { rows } = await executor.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.received_date,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            dd.loss_bearer, dd.agreed_with_name, dd.note AS disposition_note,
            dd.recorded_by_name, dd.created_at AS returned_at,
            COALESCE(dd.return_to_name, 'the LG warehouse') AS return_to_name,
            hcs.name AS from_centre_name
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
       LEFT JOIN damage_dispositions dd ON dd.return_batch_id = b.id
       LEFT JOIN healthcare_centres hcs ON hcs.id = dd.healthcare_centre_id
      WHERE sl.healthcare_centre_id = $1
        AND b.status = 'returned_pending_inspection'
        AND b.quantity > 0
      ORDER BY b.expiry_date NULLS LAST, d.name, b.batch_number`,
    [healthcareCentreId]
  );
  return rows;
};

const lockReturnBatch = async (client, batchId, healthcareCentreId) => {
  const { rows } = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.drug_id, b.local_government_id,
            b.status, b.stock_location_id, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
      WHERE b.id = $1
        AND sl.healthcare_centre_id = $2
      FOR UPDATE OF b`,
    [batchId, healthcareCentreId]
  );
  return rows[0] || null;
};

const listReturnSenders = async (executor, returnBatchId) => {
  const { rows } = await executor.query(
    `SELECT DISTINCT dd.healthcare_centre_id
       FROM damage_dispositions dd
      WHERE dd.return_batch_id = $1
        AND dd.healthcare_centre_id IS NOT NULL`,
    [returnBatchId]
  );
  return rows;
};

const receiveReturn = async (client, { returnBatchId, outcome, receivedByName }) => {
  const { rows } = await client.query(
    `UPDATE damage_dispositions
        SET return_status = 'received',
            return_outcome = $2,
            return_received_at = now(),
            return_received_by_name = $3
      WHERE return_batch_id = $1
        AND return_status = 'in_transit'
      RETURNING id`,
    [returnBatchId, outcome, receivedByName]
  );
  return rows[0] || null;
};

module.exports = {
  findFacilityLocation,
  listUsableBatches,
  insertQuarantinedBatch,
  listQuarantinedBatches,
  lockBatch,
  findLotBatch,
  insertUsableBatch,
  updateBatchQuantity,
  insertMovement,
  insertDisposition,
  listDispositions,
  findReturnDestination,
  findReturnBatch,
  insertReturnBatch,
  listReturnsInTransit,
  lockReturnBatch,
  receiveReturn,
  listReturnSenders
};

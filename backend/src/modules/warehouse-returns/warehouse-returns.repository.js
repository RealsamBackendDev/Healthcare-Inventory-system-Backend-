const findWarehouseLocation = async (executor, localGovernmentId) => {
  const { rows } = await executor.query(
    `SELECT id, local_government_id, name
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'lg_warehouse'
        AND is_active = TRUE
      ORDER BY created_at
      LIMIT 1`,
    [localGovernmentId]
  );
  return rows[0] || null;
};

const findTransitLocation = async (executor, localGovernmentId) => {
  const { rows } = await executor.query(
    `SELECT id, name
       FROM stock_locations
      WHERE local_government_id = $1
        AND location_type = 'in_transit'
      LIMIT 1`,
    [localGovernmentId]
  );
  return rows[0] || null;
};

const listReturns = async (executor, localGovernmentId) => {
  const { rows } = await executor.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.received_date,
            d.id AS drug_id, d.code AS drug_code, d.name AS drug_name, d.unit_of_measure,
            dd.loss_bearer, dd.agreed_with_name, dd.note AS disposition_note,
            dd.recorded_by_name, dd.created_at AS returned_at,
            hc.name AS from_centre_name,
            COALESCE(dd.return_to_name, sl.name) AS return_to_name
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
       LEFT JOIN damage_dispositions dd ON dd.return_batch_id = b.id
       LEFT JOIN healthcare_centres hc ON hc.id = dd.healthcare_centre_id
      WHERE sl.local_government_id = $1
        AND sl.location_type = 'in_transit'
        AND b.status = 'returned_pending_inspection'
        AND b.quantity > 0
      ORDER BY b.expiry_date NULLS LAST, d.name, b.batch_number`,
    [localGovernmentId]
  );
  return rows;
};

const lockReturnBatch = async (client, batchId, localGovernmentId) => {
  const { rows } = await client.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity::float AS quantity,
            b.unit_cost, b.supplier_reference, b.drug_id, b.local_government_id,
            b.status, b.stock_location_id, d.name AS drug_name, d.unit_of_measure
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       JOIN stock_locations sl ON sl.id = b.stock_location_id
      WHERE b.id = $1
        AND sl.local_government_id = $2
        AND sl.location_type = 'in_transit'
      FOR UPDATE OF b`,
    [batchId, localGovernmentId]
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
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, 'usable')
     ON CONFLICT (stock_location_id, drug_id, batch_number)
     DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity,
                   unit_cost = COALESCE(batches.unit_cost, EXCLUDED.unit_cost),
                   updated_at = now()
     RETURNING id`,
    [
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
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
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
  findWarehouseLocation,
  findTransitLocation,
  listReturns,
  lockReturnBatch,
  findLotBatch,
  insertUsableBatch,
  updateBatchQuantity,
  insertMovement,
  receiveReturn,
  listReturnSenders
};

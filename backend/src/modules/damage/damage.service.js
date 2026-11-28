const { query, withTransaction } = require('../../database/connection');
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../../shared/errors/AppError');
const {
  roundQuantity,
  isPositive,
  isCountableUnit,
  isWholeQuantity
} = require('../../shared/utils/numbers');
const { todayIsoDate, isoDateOf } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const { QUANTITY_EPSILON, PERMISSIONS, NOTIFICATION_TYPES } = require('../../shared/constants');
const {
  notifyCentreMembers,
  notifyLocalGovernmentMembers
} = require('../../shared/utils/notifications');
const repository = require('./damage.repository');

const QUARANTINE_WINDOW_DAYS = 7;
const RECORDABLE_DISPOSITIONS = ['restocked', 'written_off', 'returned'];
const RETURN_OUTCOMES = ['restock', 'write_off'];

const requireFacilityScope = (scope) => {
  if (!scope || !scope.healthcareCentreId) {
    throw new ForbiddenError('This screen needs a healthcare centre account', 'FACILITY_ONLY');
  }
  return scope.healthcareCentreId;
};

const daysSince = (value) => {
  const iso = isoDateOf(value);
  if (!iso) {
    return 0;
  }
  const then = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${todayIsoDate()}T00:00:00Z`);
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - then) / 86400000));
};

const lotNumberOf = (batchNumber) => {
  const value = String(batchNumber || '');
  if (value.endsWith('-Q')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('-R')) {
    return value.slice(0, -2);
  }
  return value;
};

const isExpiredOn = (expiryDate) => Boolean(expiryDate && expiryDate < todayIsoDate());

const mapQuarantinedBatch = (row) => {
  const expiryDate = isoDateOf(row.expiry_date);
  const expired = isExpiredOn(expiryDate);
  const ageDays = daysSince(row.received_date);

  return {
    batchId: row.id,
    drugId: row.drug_id,
    drugCode: row.drug_code,
    drugName: row.drug_name,
    unitOfMeasure: row.unit_of_measure,
    batchNumber: row.batch_number,
    expiryDate,
    quantity: roundQuantity(Number(row.quantity || 0)),
    disposedQuantity: roundQuantity(Number(row.disposed_quantity || 0)),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    sourceReference: row.supplier_reference || null,
    receivedDate: isoDateOf(row.received_date),
    ageDays,
    expired,
    overdue: ageDays > QUARANTINE_WINDOW_DAYS,
    allowedDispositions: expired
      ? ['written_off', 'returned']
      : RECORDABLE_DISPOSITIONS,
    lastDisposedAt: row.last_disposed_at || null
  };
};

const mapDisposition = (row) => ({
  id: row.id,
  batchId: row.batch_id,
  batchNumber: row.batch_number,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  sourceReference: row.source_reference || null,
  quantity: roundQuantity(Number(row.quantity || 0)),
  disposition: row.disposition,
  lossBearer: row.loss_bearer,
  replacementOwed: Boolean(row.replacement_owed),
  agreedWithName: row.agreed_with_name,
  note: row.note,
  recordedByName: row.recorded_by_name,
  recordedAt: row.created_at,
  returnBatchId: row.return_batch_id || null,
  returnStatus: row.return_status || 'none',
  returnOutcome: row.return_outcome || null,
  returnToName: row.return_to_name || null
});

const mapReturn = (row) => {
  const expiryDate = isoDateOf(row.expiry_date);
  const expired = isExpiredOn(expiryDate);

  return {
    batchId: row.id,
    drugId: row.drug_id,
    drugCode: row.drug_code,
    drugName: row.drug_name,
    unitOfMeasure: row.unit_of_measure,
    batchNumber: row.batch_number,
    expiryDate,
    quantity: roundQuantity(Number(row.quantity || 0)),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    supplierReference: row.supplier_reference || null,
    expired,
    returnToName: row.return_to_name || 'the LG warehouse',
    fromCentreName: row.from_centre_name || 'the sending facility',
    lossBearer: row.loss_bearer || null,
    agreedWithName: row.agreed_with_name || null,
    note: row.disposition_note || null,
    recordedByName: row.recorded_by_name || null,
    returnedAt: row.returned_at || null,
    allowedOutcomes: expired ? ['write_off'] : RETURN_OUTCOMES
  };
};

const listDamagedStock = async ({ scope }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const rows = await repository.listQuarantinedBatches({ query }, healthcareCentreId);

  const items = rows.map(mapQuarantinedBatch);
  const history = await repository.listDispositions({ query }, {
    healthcareCentreId,
    limit: 20
  });
  const usableRows = await repository.listUsableBatches({ query }, healthcareCentreId);

  return {
    items,
    availableBatches: usableRows.map((row) => ({
      batchId: row.id,
      drugId: row.drug_id,
      drugName: row.drug_name,
      drugCode: row.drug_code,
      unitOfMeasure: row.unit_of_measure,
      batchNumber: row.batch_number,
      expiryDate: isoDateOf(row.expiry_date),
      quantity: roundQuantity(Number(row.quantity || 0))
    })),
    totalQuantity: roundQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
    overdueCount: items.filter((item) => item.overdue).length,
    expiredCount: items.filter((item) => item.expired).length,
    quarantineWindowDays: QUARANTINE_WINDOW_DAYS,
    recentDispositions: history.map(mapDisposition)
  };
};

const listReturnsInTransit = async ({ scope }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const rows = await repository.listReturnsInTransit({ query }, healthcareCentreId);
  const items = rows.map(mapReturn);

  return {
    items,
    totalQuantity: roundQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
    expiredCount: items.filter((item) => item.expired).length
  };
};

const markDamaged = async ({ actor, scope, batchId, payload }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  const location = await repository.findFacilityLocation({ query }, healthcareCentreId);
  if (!location) {
    throw new NotFoundError('This healthcare centre has no active store location');
  }

  return withTransaction(async (client) => {
    const batch = await repository.lockBatch(client, batchId, healthcareCentreId);
    if (!batch) {
      throw new NotFoundError('That batch was not found in this facility');
    }
    if (batch.status !== 'usable') {
      throw new ConflictError(
        `That batch is marked ${batch.status}, so only usable stock can be moved into quarantine`,
        'DAMAGE_NOT_USABLE'
      );
    }

    const available = roundQuantity(Number(batch.quantity || 0));
    if (!isPositive(available)) {
      throw new ConflictError('That batch has nothing left to move', 'DAMAGE_BATCH_EMPTY');
    }

    const quantity = roundQuantity(Number(payload.quantity));
    if (!Number.isFinite(quantity) || !isPositive(quantity)) {
      throw new ValidationError('Enter how many units are damaged', [
        { field: 'quantity', message: 'Enter a quantity greater than zero' }
      ]);
    }
    if (quantity > available + QUANTITY_EPSILON) {
      throw new ValidationError(
        `Only ${available} ${batch.unit_of_measure} of ${batch.drug_name} is on hand in that batch`,
        [{ field: 'quantity', message: 'The damaged quantity cannot be more than the batch holds' }]
      );
    }
    if (isCountableUnit(batch.unit_of_measure) && !isWholeQuantity(quantity)) {
      throw new ValidationError(`${batch.drug_name} is counted in whole ${batch.unit_of_measure}`, [
        { field: 'quantity', message: 'Enter a whole number for this unit' }
      ]);
    }

    const expiryDate = isoDateOf(batch.expiry_date);
    const lotNumber = `${lotNumberOf(batch.batch_number)}-Q`;
    const existing = await repository.findLotBatch(client, {
      stockLocationId: batch.stock_location_id,
      drugId: batch.drug_id,
      batchNumber: lotNumber
    });
    const reusableQuarantine =
      existing &&
      (existing.status === 'quarantined' ||
        (existing.status === 'destroyed' && !isPositive(existing.quantity)));
    if (existing && !reusableQuarantine) {
      throw new ConflictError(
        `Lot ${lotNumber} is already held in this store as ${existing.status}, so it cannot take this stock`,
        'DAMAGE_QUARANTINE_BLOCKED'
      );
    }
    if (existing && isoDateOf(existing.expiry_date) !== expiryDate) {
      throw new ConflictError(
        `Lot ${lotNumber} is already held with a different expiry date`,
        'DAMAGE_QUARANTINE_MISMATCH'
      );
    }

    const quarantined = await repository.insertQuarantinedBatch(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      stockLocationId: batch.stock_location_id,
      drugId: batch.drug_id,
      batchNumber: lotNumber,
      expiryDate,
      quantity,
      unitCost: batch.unit_cost,
      supplierReference: batch.supplier_reference
    });

    const remaining = roundQuantity(available - quantity);
    await repository.updateBatchQuantity(client, {
      batchId: batch.id,
      quantity: remaining,
      status: remaining > QUANTITY_EPSILON ? 'usable' : 'destroyed'
    });

    await repository.insertMovement(client, {
      healthcareCentreId,
      drugId: batch.drug_id,
      batchId: batch.id,
      movementType: 'quarantine',
      quantity: -quantity,
      reason: `Damaged stock moved into quarantine - ${payload.reason}`,
      actorId: actor.id,
      actorName: actor.fullName,
      sourceReference: batch.supplier_reference
    });

    await repository.insertMovement(client, {
      healthcareCentreId,
      drugId: batch.drug_id,
      batchId: quarantined.id,
      movementType: 'quarantine',
      quantity,
      reason: `Damaged stock held in quarantine lot ${lotNumber} - ${payload.reason}`,
      actorId: actor.id,
      actorName: actor.fullName,
      sourceReference: batch.supplier_reference
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'damage.quarantined',
      entityType: 'batch',
      entityId: quarantined.id,
      summary: `Moved ${quantity} ${batch.drug_name} from lot ${batch.batch_number} into quarantine`,
      newValues: {
        sourceBatchId: batch.id,
        sourceBatchNumber: batch.batch_number,
        quarantineBatchId: quarantined.id,
        quarantineBatchNumber: lotNumber,
        quantity,
        remainingQuantity: remaining,
        reason: payload.reason,
        sourceReference: batch.supplier_reference || null
      }
    });

    return {
      batchId: quarantined.id,
      sourceBatchId: batch.id,
      batchNumber: lotNumber,
      sourceBatchNumber: batch.batch_number,
      drugName: batch.drug_name,
      unitOfMeasure: batch.unit_of_measure,
      quantity,
      remainingQuantity: remaining
    };
  });
};

const recordDisposition = async ({ actor, scope, batchId, payload }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const disposition = payload.disposition;

  if (!RECORDABLE_DISPOSITIONS.includes(disposition)) {
    throw new ValidationError('Choose restocked, written off or returned to the sender', [
      { field: 'disposition', message: 'Choose a valid decision' }
    ]);
  }

  const location = await repository.findFacilityLocation({ query }, healthcareCentreId);
  if (!location) {
    throw new NotFoundError('This healthcare centre has no active store location');
  }

  return withTransaction(async (client) => {
    const batch = await repository.lockBatch(client, batchId, healthcareCentreId);
    if (!batch) {
      throw new NotFoundError('That quarantined stock was not found in this facility');
    }
    if (batch.status !== 'quarantined') {
      throw new ConflictError(
        'That stock is not in quarantine, so it has no damage decision to record',
        'DAMAGE_NOT_QUARANTINED'
      );
    }

    const available = roundQuantity(Number(batch.quantity || 0));
    if (!isPositive(available)) {
      throw new ConflictError('There is nothing left in that quarantine batch', 'DAMAGE_BATCH_EMPTY');
    }

    const quantity = roundQuantity(Number(payload.quantity));
    if (!Number.isFinite(quantity) || !isPositive(quantity)) {
      throw new ValidationError('Enter the quantity being decided', [
        { field: 'quantity', message: 'Enter a quantity greater than zero' }
      ]);
    }
    if (quantity > available + QUANTITY_EPSILON) {
      throw new ValidationError(
        `Only ${available} ${batch.unit_of_measure} of ${batch.drug_name} is in quarantine`,
        [{ field: 'quantity', message: 'The decision cannot cover more than the quarantined quantity' }]
      );
    }
    if (isCountableUnit(batch.unit_of_measure) && !isWholeQuantity(quantity)) {
      throw new ValidationError(`${batch.drug_name} is counted in whole ${batch.unit_of_measure}`, [
        { field: 'quantity', message: 'Enter a whole number for this unit' }
      ]);
    }

    const expiryDate = isoDateOf(batch.expiry_date);
    const expired = isExpiredOn(expiryDate);
    if (expired && disposition === 'restocked') {
      throw new ConflictError(
        'This batch has expired, so it can only be written off or returned to the sender',
        'DAMAGE_EXPIRED_ONLY_WRITE_OFF'
      );
    }

    let lossBearer = 'receiver';
    if (disposition === 'written_off') {
      lossBearer = payload.lossBearer;
      if (!['sender', 'receiver'].includes(lossBearer)) {
        throw new ValidationError('Record who bears the loss', [
          { field: 'lossBearer', message: 'Choose whether the sender or this facility bears the loss' }
        ]);
      }
    }
    if (disposition === 'returned') {
      lossBearer = 'sender';
    }
    const replacementOwed = disposition === 'written_off' && lossBearer === 'sender';

    const remaining = roundQuantity(available - quantity);
    const closedStatus = remaining > QUANTITY_EPSILON ? 'quarantined' : 'destroyed';

    let restockedBatchId = null;
    let returnBatch = null;
    let destination = null;

    if (disposition === 'restocked') {
      const lotNumber = lotNumberOf(batch.batch_number);
      const existing = await repository.findLotBatch(client, {
        stockLocationId: batch.stock_location_id,
        drugId: batch.drug_id,
        batchNumber: lotNumber
      });
      if (existing && existing.status !== 'usable') {
        throw new ConflictError(
          `Lot ${lotNumber} is already held in this store as ${existing.status}, so it cannot take this stock back`,
          'DAMAGE_RESTOCK_BLOCKED'
        );
      }

      const usable = await repository.insertUsableBatch(client, {
        healthcareCentreId,
        localGovernmentId: location.local_government_id,
        stockLocationId: batch.stock_location_id,
        drugId: batch.drug_id,
        batchNumber: lotNumber,
        expiryDate,
        quantity,
        unitCost: batch.unit_cost,
        supplierReference: batch.supplier_reference
      });
      restockedBatchId = usable.id;

      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: usable.id,
        movementType: 'return_restock',
        quantity,
        reason: `Damaged stock inspected and returned to usable stock from quarantine lot ${batch.batch_number} - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    } else if (disposition === 'returned') {
      destination = await repository.findReturnDestination(client, {
        localGovernmentId: location.local_government_id,
        supplierReference: batch.supplier_reference
      });
      if (!destination.stockLocationId) {
        throw new ConflictError(
          'This local government has no stock location to receive a return',
          'RETURN_DESTINATION_MISSING'
        );
      }
      if (destination.healthcareCentreId && destination.healthcareCentreId === healthcareCentreId) {
        throw new ConflictError(
          'This stock came from this facility, so it cannot be sent back to itself',
          'RETURN_TO_SELF'
        );
      }

      const returnLotNumber = `${lotNumberOf(batch.batch_number)}-R`;
      const existing = await repository.findReturnBatch(client, {
        stockLocationId: destination.stockLocationId,
        drugId: batch.drug_id,
        batchNumber: returnLotNumber
      });
      const reusableReturn =
        existing &&
        (existing.status === 'returned_pending_inspection' ||
          (existing.status === 'destroyed' && !isPositive(existing.quantity)));
      if (existing && !reusableReturn) {
        throw new ConflictError(
          `Lot ${returnLotNumber} is already held at ${destination.centreName} as ${existing.status}, so it cannot take this return`,
          'RETURN_LOT_BLOCKED'
        );
      }

      returnBatch = await repository.insertReturnBatch(client, {
        healthcareCentreId: destination.healthcareCentreId,
        localGovernmentId: location.local_government_id,
        stockLocationId: destination.stockLocationId,
        drugId: batch.drug_id,
        batchNumber: returnLotNumber,
        expiryDate,
        quantity,
        unitCost: batch.unit_cost,
        supplierReference: batch.supplier_reference
      });

      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: batch.id,
        movementType: 'transfer_out',
        quantity: -quantity,
        reason: `Damaged stock sent back to ${destination.centreName} - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });

      await repository.insertMovement(client, {
        healthcareCentreId: destination.healthcareCentreId,
        drugId: batch.drug_id,
        batchId: returnBatch.id,
        movementType: 'transit_in',
        quantity,
        reason: `Damaged stock in transit to ${destination.centreName}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    } else {
      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: batch.id,
        movementType: 'write_off',
        quantity: -quantity,
        reason: `Damaged stock written off - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    }

    await repository.updateBatchQuantity(client, {
      batchId: batch.id,
      quantity: remaining,
      status: closedStatus
    });

    const record = await repository.insertDisposition(client, {
      localGovernmentId: location.local_government_id,
      healthcareCentreId,
      batchId: batch.id,
      drugId: batch.drug_id,
      batchNumber: batch.batch_number,
      sourceReference: batch.supplier_reference,
      quantity,
      disposition,
      lossBearer,
      replacementOwed,
      agreedWithName: payload.agreedWithName,
      note: payload.note,
      restockedBatchId,
      returnBatchId: returnBatch ? returnBatch.id : null,
      returnToHealthcareCentreId: destination ? destination.healthcareCentreId : null,
      returnToName: destination ? destination.centreName : null,
      actorId: actor.id,
      actorName: actor.fullName
    });

    const summaries = {
      restocked: `Returned ${quantity} ${batch.drug_name} from quarantine to usable stock`,
      written_off: `Wrote off ${quantity} ${batch.drug_name}, loss borne by the ${lossBearer}`,
      returned: `Sent ${quantity} ${batch.drug_name} back to ${destination ? destination.centreName : 'the sender'}`
    };

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'damage.disposed',
      entityType: 'batch',
      entityId: batch.id,
      summary: summaries[disposition],
      newValues: {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        disposition,
        quantity,
        lossBearer,
        replacementOwed,
        agreedWithName: payload.agreedWithName,
        note: payload.note,
        remainingQuantity: remaining,
        sourceReference: batch.supplier_reference || null,
        returnBatchId: returnBatch ? returnBatch.id : null,
        returnToName: destination ? destination.centreName : null
      }
    });

    if (returnBatch) {
      const returnMessage =
        `${quantity} ${batch.unit_of_measure} of ${batch.drug_name} ` +
        `(lot ${batch.batch_number}) is on its way back and needs to be signed in`;

      if (destination.healthcareCentreId) {
        await notifyCentreMembers(client, {
          healthcareCentreId: destination.healthcareCentreId,
          excludeUserId: actor.id,
          type: NOTIFICATION_TYPES.RETURN_PENDING,
          title: 'Damaged stock on its way',
          message: returnMessage,
          entityType: 'batch',
          entityId: returnBatch.id
        });
      } else {
        await notifyLocalGovernmentMembers(client, {
          localGovernmentId: location.local_government_id,
          permissionCode: PERMISSIONS.WAREHOUSE_RECEIVE,
          excludeUserId: actor.id,
          type: NOTIFICATION_TYPES.RETURN_PENDING,
          title: 'Damaged stock on its way back',
          message: returnMessage,
          entityType: 'batch',
          entityId: returnBatch.id
        });
      }
    }

    return {
      id: record.id,
      batchId: batch.id,
      batchNumber: batch.batch_number,
      drugName: batch.drug_name,
      unitOfMeasure: batch.unit_of_measure,
      quantity,
      disposition,
      lossBearer,
      replacementOwed,
      agreedWithName: payload.agreedWithName,
      note: payload.note,
      remainingQuantity: remaining,
      restockedBatchId,
      returnBatchId: returnBatch ? returnBatch.id : null,
      returnToName: destination ? destination.centreName : null,
      returnStatus: returnBatch ? 'in_transit' : 'none',
      recordedAt: record.created_at
    };
  });
};

const confirmReturn = async ({ actor, scope, batchId, payload }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const outcome = payload.outcome;

  if (!RETURN_OUTCOMES.includes(outcome)) {
    throw new ValidationError('Choose whether the returned stock is usable or written off', [
      { field: 'outcome', message: 'Choose restock or write off' }
    ]);
  }

  const location = await repository.findFacilityLocation({ query }, healthcareCentreId);
  if (!location) {
    throw new NotFoundError('This healthcare centre has no active store location');
  }

  return withTransaction(async (client) => {
    const batch = await repository.lockReturnBatch(client, batchId, healthcareCentreId);
    if (!batch) {
      throw new NotFoundError('That returned stock was not found in this facility');
    }
    if (batch.status !== 'returned_pending_inspection') {
      throw new ConflictError(
        'That stock is not waiting to be signed back in',
        'RETURN_NOT_IN_TRANSIT'
      );
    }

    const quantity = roundQuantity(Number(batch.quantity || 0));
    if (!isPositive(quantity)) {
      throw new ConflictError('There is nothing left in that returned batch', 'RETURN_BATCH_EMPTY');
    }

    const expiryDate = isoDateOf(batch.expiry_date);
    const expired = isExpiredOn(expiryDate);
    if (expired && outcome === 'restock') {
      throw new ConflictError(
        'This batch expired on the way back, so it can only be written off',
        'RETURN_EXPIRED_ONLY_WRITE_OFF'
      );
    }

    let usableBatchId = null;

    if (outcome === 'restock') {
      const lotNumber = lotNumberOf(batch.batch_number);
      const existing = await repository.findLotBatch(client, {
        stockLocationId: batch.stock_location_id,
        drugId: batch.drug_id,
        batchNumber: lotNumber
      });
      if (existing && existing.status !== 'usable') {
        throw new ConflictError(
          `Lot ${lotNumber} is already held in this store as ${existing.status}, so it cannot take this stock back`,
          'RETURN_LOT_BLOCKED'
        );
      }
      if (existing && isoDateOf(existing.expiry_date) !== expiryDate) {
        throw new ConflictError(
          `Lot ${lotNumber} is already held with a different expiry date`,
          'RETURN_LOT_MISMATCH'
        );
      }

      const usable = await repository.insertUsableBatch(client, {
        healthcareCentreId,
        localGovernmentId: location.local_government_id,
        stockLocationId: batch.stock_location_id,
        drugId: batch.drug_id,
        batchNumber: lotNumber,
        expiryDate,
        quantity,
        unitCost: batch.unit_cost,
        supplierReference: batch.supplier_reference
      });
      usableBatchId = usable.id;

      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: usable.id,
        movementType: 'return_restock',
        quantity,
        reason: `Returned damaged stock signed back in - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    } else {
      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: batch.id,
        movementType: 'write_off',
        quantity: -quantity,
        reason: `Returned damaged stock written off on arrival - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    }

    if (outcome === 'restock') {
      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: batch.drug_id,
        batchId: batch.id,
        movementType: 'transit_out',
        quantity: -quantity,
        reason: `Returned damaged stock inspected and signed back in - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    }

    await repository.updateBatchQuantity(client, {
      batchId: batch.id,
      quantity: 0,
      status: 'destroyed'
    });

    await repository.receiveReturn(client, {
      returnBatchId: batch.id,
      outcome: outcome === 'restock' ? 'restocked' : 'written_off',
      receivedByName: actor.fullName
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'damage.return_received',
      entityType: 'batch',
      entityId: batch.id,
      summary:
        outcome === 'restock'
          ? `Signed back in ${quantity} ${batch.drug_name} returned as damaged`
          : `Wrote off ${quantity} ${batch.drug_name} on return`,
      newValues: {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        outcome,
        quantity,
        usableBatchId,
        note: payload.note,
        sourceReference: batch.supplier_reference || null
      }
    });

    const senders = await repository.listReturnSenders(client, batch.id);
    for (const sender of senders) {
      await notifyCentreMembers(client, {
        healthcareCentreId: sender.healthcare_centre_id,
        excludeUserId: actor.id,
        type: NOTIFICATION_TYPES.RETURN_RECEIVED,
        title: 'Returned stock signed in',
        message:
          `${quantity} ${batch.unit_of_measure} of ${batch.drug_name} ` +
          `(lot ${batch.batch_number}) was ${outcome === 'restock' ? 'signed back into usable stock' : 'written off on arrival'} by ${actor.fullName}`,
        entityType: 'batch',
        entityId: batch.id
      });
    }

    return {
      batchId: batch.id,
      batchNumber: batch.batch_number,
      drugName: batch.drug_name,
      unitOfMeasure: batch.unit_of_measure,
      quantity,
      outcome,
      usableBatchId,
      note: payload.note
    };
  });
};

module.exports = {
  listDamagedStock,
  listReturnsInTransit,
  markDamaged,
  recordDisposition,
  confirmReturn,
  QUARANTINE_WINDOW_DAYS
};

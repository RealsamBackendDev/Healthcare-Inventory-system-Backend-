const { query, withTransaction } = require('../../database/connection');
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../../shared/errors/AppError');
const { roundQuantity, isPositive } = require('../../shared/utils/numbers');
const { todayIsoDate, isoDateOf } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const { notifyCentreMembers } = require('../../shared/utils/notifications');
const { NOTIFICATION_TYPES } = require('../../shared/constants');
const repository = require('./warehouse-returns.repository');

const RETURN_OUTCOMES = ['restock', 'write_off'];

const requireLocalGovernmentScope = (scope) => {
  if (!scope || !scope.localGovernmentId) {
    throw new ForbiddenError('This screen needs a local government account', 'LG_ONLY');
  }
  return scope.localGovernmentId;
};

const isExpiredOn = (expiryDate) => Boolean(expiryDate && expiryDate < todayIsoDate());

const lotNumberOf = (batchNumber) => {
  const value = String(batchNumber || '');
  if (value.endsWith('-R')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('-Q')) {
    return value.slice(0, -2);
  }
  return value;
};

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
    fromCentreName: row.from_centre_name || 'a healthcare centre',
    returnToName: row.return_to_name || 'the warehouse',
    lossBearer: row.loss_bearer || null,
    agreedWithName: row.agreed_with_name || null,
    note: row.disposition_note || null,
    recordedByName: row.recorded_by_name || null,
    returnedAt: row.returned_at || null,
    allowedOutcomes: expired ? ['write_off'] : RETURN_OUTCOMES
  };
};

const listWarehouseReturns = async ({ scope }) => {
  const localGovernmentId = requireLocalGovernmentScope(scope);
  const rows = await repository.listReturns({ query }, localGovernmentId);
  const items = rows.map(mapReturn);

  return {
    items,
    totalQuantity: roundQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
    expiredCount: items.filter((item) => item.expired).length
  };
};

const confirmWarehouseReturn = async ({ actor, scope, batchId, payload }) => {
  const localGovernmentId = requireLocalGovernmentScope(scope);
  const outcome = payload.outcome;

  if (!RETURN_OUTCOMES.includes(outcome)) {
    throw new ValidationError('Choose whether the returned stock is usable or written off', [
      { field: 'outcome', message: 'Choose restock or write off' }
    ]);
  }

  const warehouse = await repository.findWarehouseLocation({ query }, localGovernmentId);
  if (!warehouse) {
    throw new NotFoundError('This local government has no active warehouse location');
  }

  return withTransaction(async (client) => {
    const batch = await repository.lockReturnBatch(client, batchId, localGovernmentId);
    if (!batch) {
      throw new NotFoundError('That returned stock was not found in transit for this warehouse');
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
        'This batch expired before it came back, so it can only be written off',
        'RETURN_EXPIRED_ONLY_WRITE_OFF'
      );
    }

    let usableBatchId = null;

    if (outcome === 'restock') {
      const lotNumber = lotNumberOf(batch.batch_number);
      const existing = await repository.findLotBatch(client, {
        stockLocationId: warehouse.id,
        drugId: batch.drug_id,
        batchNumber: lotNumber
      });
      if (existing && existing.status !== 'usable') {
        throw new ConflictError(
          `Lot ${lotNumber} is already held in the warehouse as ${existing.status}, so it cannot take this stock back`,
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
        localGovernmentId,
        stockLocationId: warehouse.id,
        drugId: batch.drug_id,
        batchNumber: lotNumber,
        expiryDate,
        quantity,
        unitCost: batch.unit_cost,
        supplierReference: batch.supplier_reference
      });
      usableBatchId = usable.id;

      await repository.insertMovement(client, {
        drugId: batch.drug_id,
        batchId: usable.id,
        movementType: 'transfer_in',
        quantity,
        reason: `Returned damaged stock signed back into the warehouse - ${payload.note}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: batch.supplier_reference
      });
    } else {
      await repository.insertMovement(client, {
        drugId: batch.drug_id,
        batchId: batch.id,
        movementType: 'write_off',
        quantity,
        reason: `Returned damaged stock written off by the warehouse - ${payload.note}`,
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
      localGovernmentId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'damage.return_received',
      entityType: 'batch',
      entityId: batch.id,
      summary:
        outcome === 'restock'
          ? `Warehouse signed back in ${quantity} ${batch.drug_name} returned as damaged`
          : `Warehouse wrote off ${quantity} ${batch.drug_name} on return`,
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
          `(lot ${batch.batch_number}) was ${outcome === 'restock' ? 'signed back into the warehouse' : 'written off on arrival'} by ${actor.fullName}`,
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
  listWarehouseReturns,
  confirmWarehouseReturn
};

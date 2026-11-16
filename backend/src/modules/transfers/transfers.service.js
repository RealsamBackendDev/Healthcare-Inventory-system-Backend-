const crypto = require('crypto');
const { query, withTransaction } = require('../../database/connection');
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../../shared/errors/AppError');
const { roundQuantity, isPositive } = require('../../shared/utils/numbers');
const { todayIsoDate } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const { QUANTITY_EPSILON } = require('../../shared/constants');
const repository = require('./transfers.repository');

const requireFacilityScope = (scope) => {
  if (!scope || !scope.healthcareCentreId) {
    throw new ForbiddenError('This screen needs a healthcare centre account', 'FACILITY_ONLY');
  }
  return scope.healthcareCentreId;
};

const buildNumber = (prefix) => {
  const date = todayIsoDate().replace(/-/g, '');
  return `${prefix}-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

const mapRequest = (row) => ({
  id: row.id,
  transferNumber: row.transfer_number,
  status: row.status,
  fromCentreId: row.from_healthcare_centre_id,
  fromCentreName: row.from_centre_name,
  toCentreId: row.to_healthcare_centre_id,
  toCentreName: row.to_centre_name,
  notes: row.notes,
  requestNote: row.request_note,
  itemCount: Number(row.item_count),
  totalQuantity: roundQuantity(Number(row.total_quantity)),
  requestedByName: row.requested_by_name,
  requestedAt: row.requested_at,
  decidedByName: row.decided_by_name,
  decidedAt: row.decided_at,
  decisionNote: row.decision_note,
  receivedByName: row.received_by_name,
  receivedAt: row.received_at,
  receivedNote: row.received_note,
  cancelledByName: row.cancelled_by_name,
  cancelledAt: row.cancelled_at,
  cancelReason: row.cancel_reason,
  createdAt: row.created_at
});

const mapRequestItem = (row) => ({
  drugId: row.drug_id,
  code: row.code,
  name: row.name,
  unitOfMeasure: row.unit_of_measure,
  quantity: roundQuantity(Number(row.quantity))
});

const mapTransferLine = (row) => ({
  ...mapRequestItem(row),
  batchNumber: row.batch_number,
  expiryDate: row.expiry_date
});

const allocateBatches = (batches, quantity) => {
  let remaining = roundQuantity(quantity);
  const allocations = [];
  for (const batch of batches) {
    if (remaining <= QUANTITY_EPSILON) {
      break;
    }
    const available = roundQuantity(Number(batch.quantity));
    if (available <= QUANTITY_EPSILON) {
      continue;
    }
    const take = roundQuantity(Math.min(available, remaining));
    allocations.push({ batch, quantity: take });
    remaining = roundQuantity(remaining - take);
  }
  return { allocations, remaining };
};

const getNeighbours = async ({ scope }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const centre = await repository.findCentre(healthcareCentreId);
  if (!centre) {
    throw new NotFoundError('Your healthcare centre was not found');
  }
  const rows = await repository.listNeighbourFacilities(
    centre.local_government_id,
    healthcareCentreId
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    drugCount: row.drug_count,
    totalQuantity: roundQuantity(Number(row.total_quantity))
  }));
};

const getNeighbourStock = async ({ scope, facilityId }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const mine = await repository.findCentre(healthcareCentreId);
  if (!mine) {
    throw new NotFoundError('Your healthcare centre was not found');
  }
  const neighbour = await repository.findCentre(facilityId);
  if (!neighbour || neighbour.local_government_id !== mine.local_government_id) {
    throw new NotFoundError('That facility is not in your local government');
  }
  if (neighbour.id === mine.id) {
    throw new ValidationError('Choose a different facility', [
      { field: 'facilityId', message: 'Pick a neighbouring facility' }
    ]);
  }
  const location = await repository.findFacilityLocation(neighbour.id);
  if (!location) {
    throw new NotFoundError('That facility has no active store location', 'FACILITY_LOCATION_MISSING');
  }
  const rows = await repository.listFacilityStock(location.id);
  return {
    facility: { id: neighbour.id, name: neighbour.name, code: neighbour.code },
    items: rows.map((row) => ({
      drugId: row.drug_id,
      code: row.code,
      name: row.name,
      unitOfMeasure: row.unit_of_measure,
      quantity: roundQuantity(Number(row.quantity))
    }))
  };
};

const createRequest = async ({ actor, scope, payload }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const mine = await repository.findCentre(healthcareCentreId);
  if (!mine) {
    throw new NotFoundError('Your healthcare centre was not found');
  }
  if (payload.fromCentreId === healthcareCentreId) {
    throw new ValidationError('Choose a different facility', [
      { field: 'fromCentreId', message: 'You cannot request stock from your own facility' }
    ]);
  }

  const source = await repository.findCentre(payload.fromCentreId);
  if (!source || source.local_government_id !== mine.local_government_id) {
    throw new NotFoundError('That facility is not in your local government');
  }

  const wanted = new Map();
  payload.items.forEach((item, index) => {
    const quantity = roundQuantity(Number(item.quantity));
    if (!isPositive(quantity)) {
      throw new ValidationError('Each line needs a quantity above zero', [
        { field: `items.${index}.quantity`, message: 'Quantity must be greater than zero' }
      ]);
    }
    wanted.set(item.drugId, roundQuantity((wanted.get(item.drugId) || 0) + quantity));
  });

  if (wanted.size === 0) {
    throw new ValidationError('Add at least one drug to request', [
      { field: 'items', message: 'Add at least one drug' }
    ]);
  }

  const drugs = await repository.findDrugs(mine.local_government_id, [...wanted.keys()]);
  const drugsById = new Map(drugs.map((drug) => [drug.id, drug]));
  for (const drugId of wanted.keys()) {
    const drug = drugsById.get(drugId);
    if (!drug || !drug.is_active) {
      throw new ValidationError('One or more drugs are not in the catalogue', [
        { field: 'items', message: 'Drug is not available in this local government' }
      ]);
    }
  }

  const totalQuantity = roundQuantity(
    [...wanted.values()].reduce((total, quantity) => total + quantity, 0)
  );

  const created = await withTransaction(async (client) => {
    const row = await repository.insertRequest(client, {
      localGovernmentId: mine.local_government_id,
      transferNumber: buildNumber('TRQ'),
      fromCentreId: source.id,
      fromCentreName: source.name,
      toCentreId: mine.id,
      toCentreName: mine.name,
      notes: payload.notes || null,
      itemCount: wanted.size,
      totalQuantity,
      actorId: actor.id,
      actorName: actor.fullName,
      requestNote: payload.note || null
    });

    for (const [drugId, quantity] of wanted.entries()) {
      await repository.insertRequestItem(client, { transferId: row.id, drugId, quantity });
    }

    await recordAudit(client, {
      healthcareCentreId: mine.id,
      localGovernmentId: mine.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.requested',
      entityType: 'facility_transfer',
      entityId: row.id,
      summary: `Requested stock from ${source.name}`,
      newValues: { itemCount: wanted.size, totalQuantity }
    });

    return row;
  });

  return getRequestDetail({ scope, requestId: created.id });
};

const listRequests = async ({ scope, direction }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const rows =
    direction === 'incoming'
      ? await repository.listIncomingRequests(healthcareCentreId)
      : await repository.listOutgoingRequests(healthcareCentreId);
  return rows.map(mapRequest);
};

const getRequestDetail = async ({ scope, requestId }) => {
  const healthcareCentreId = requireFacilityScope(scope);
  const row = await repository.findRequest({ query }, requestId);
  if (
    !row ||
    (row.to_healthcare_centre_id !== healthcareCentreId &&
      row.from_healthcare_centre_id !== healthcareCentreId)
  ) {
    throw new NotFoundError('Transfer request was not found for this facility');
  }
  const requestItems = await repository.listRequestItems({ query }, requestId);
  const transferLines = await repository.listTransferLines({ query }, requestId);

  return {
    ...mapRequest(row),
    items: requestItems.map(mapRequestItem),
    batches: transferLines.map(mapTransferLine)
  };
};

const approveRequest = async ({ actor, scope, requestId, note }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.from_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }
    if (locked.status !== 'requested') {
      throw new ConflictError('This request has already been decided', 'REQUEST_ALREADY_DECIDED');
    }

    const location = await repository.findFacilityLocation(healthcareCentreId);
    if (!location) {
      throw new NotFoundError('This healthcare centre has no active store location');
    }

    const requestItems = await repository.listRequestItems(client, requestId);
    if (requestItems.length === 0) {
      throw new ConflictError('This request has no drugs on it', 'REQUEST_EMPTY');
    }

    const lines = [];
    for (const item of requestItems) {
      const batches = await repository.lockAvailableBatches(client, location.id, item.drug_id);
      const { allocations, remaining } = allocateBatches(batches, Number(item.quantity));

      if (remaining > QUANTITY_EPSILON) {
        throw new ConflictError(
          `Not enough ${item.name} in your store (short by ${roundQuantity(remaining)})`,
          'INSUFFICIENT_FACILITY_STOCK'
        );
      }

      for (const allocation of allocations) {
        const updated = await repository.decrementBatch(
          client,
          allocation.batch.id,
          allocation.quantity
        );
        if (!updated) {
          throw new ConflictError('Stock changed while approving, try again', 'TRANSFER_STOCK_CHANGED');
        }
        lines.push({
          drugId: item.drug_id,
          sourceBatchId: allocation.batch.id,
          batchNumber: allocation.batch.batch_number,
          expiryDate: allocation.batch.expiry_date,
          quantity: allocation.quantity,
          unitCost: allocation.batch.unit_cost
        });
      }
    }

    const totalQuantity = roundQuantity(
      lines.reduce((total, line) => total + line.quantity, 0)
    );

    for (const line of lines) {
      await repository.insertTransferLine(client, { transferId: requestId, ...line });
      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: line.drugId,
        batchId: line.sourceBatchId,
        movementType: 'transfer_out',
        quantity: -line.quantity,
        reason: `Transfer ${locked.transfer_number} to ${locked.to_centre_name}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: locked.transfer_number
      });
    }

    await repository.setRequestApproved(client, {
      transferId: requestId,
      itemCount: requestItems.length,
      totalQuantity,
      actorId: actor.id,
      actorName: actor.fullName,
      note
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.request_approved',
      entityType: 'facility_transfer',
      entityId: requestId,
      summary: `Approved request ${locked.transfer_number} from ${locked.to_centre_name}`,
      newValues: { itemCount: requestItems.length, totalQuantity }
    });
  });

  return getRequestDetail({ scope, requestId });
};

const declineRequest = async ({ actor, scope, requestId, reason }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.from_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }
    if (locked.status !== 'requested') {
      throw new ConflictError('This request has already been decided', 'REQUEST_ALREADY_DECIDED');
    }

    await repository.setRequestDeclined(client, {
      transferId: requestId,
      actorId: actor.id,
      actorName: actor.fullName,
      note: reason
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: locked.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.request_declined',
      entityType: 'facility_transfer',
      entityId: requestId,
      summary: `Declined request ${locked.transfer_number} from ${locked.to_centre_name}`,
      reason
    });
  });

  return getRequestDetail({ scope, requestId });
};

const receiveRequest = async ({ actor, scope, requestId, note }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.to_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }
    if (locked.status !== 'in_transit') {
      throw new ConflictError('This request cannot be received', 'REQUEST_NOT_IN_TRANSIT');
    }

    const location = await repository.findFacilityLocation(healthcareCentreId);
    if (!location) {
      throw new NotFoundError('This healthcare centre has no active store location');
    }

    const lines = await repository.listTransferLines(client, requestId);
    if (lines.length === 0) {
      throw new ConflictError('This request has no stock to receive', 'REQUEST_EMPTY');
    }

    for (const line of lines) {
      const batch = await repository.insertInboundBatch(client, {
        healthcareCentreId,
        localGovernmentId: location.local_government_id,
        stockLocationId: location.id,
        drugId: line.drug_id,
        batchNumber: line.batch_number,
        expiryDate: line.expiry_date,
        quantity: Number(line.quantity),
        unitCost: line.unit_cost,
        supplierReference: locked.transfer_number
      });

      await repository.insertMovement(client, {
        healthcareCentreId,
        drugId: line.drug_id,
        batchId: batch.id,
        movementType: 'transfer_in',
        quantity: Number(line.quantity),
        reason: note || `Transfer ${locked.transfer_number} from ${locked.from_centre_name}`,
        actorId: actor.id,
        actorName: actor.fullName,
        sourceReference: locked.transfer_number
      });
    }

    await repository.setRequestReceived(client, {
      transferId: requestId,
      actorId: actor.id,
      actorName: actor.fullName,
      note
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.request_received',
      entityType: 'facility_transfer',
      entityId: requestId,
      summary: `Received ${lines.length} batch(es) from ${locked.from_centre_name}`,
      newValues: { itemCount: lines.length }
    });
  });

  return getRequestDetail({ scope, requestId });
};

const cancelRequest = async ({ actor, scope, requestId, reason }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.to_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }
    if (locked.status !== 'requested') {
      throw new ConflictError('Only a request still waiting can be cancelled', 'REQUEST_NOT_CANCELLABLE');
    }

    await repository.cancelRequest(client, {
      transferId: requestId,
      actorId: actor.id,
      actorName: actor.fullName,
      note: reason
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: locked.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.request_cancelled',
      entityType: 'facility_transfer',
      entityId: requestId,
      summary: `Cancelled request ${locked.transfer_number}`,
      reason
    });
  });

  return getRequestDetail({ scope, requestId });
};

module.exports = {
  getNeighbours,
  getNeighbourStock,
  createRequest,
  listRequests,
  getRequestDetail,
  approveRequest,
  declineRequest,
  receiveRequest,
  cancelRequest
};

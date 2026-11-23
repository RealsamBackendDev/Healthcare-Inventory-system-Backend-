const crypto = require('crypto');
const { query, withTransaction } = require('../../database/connection');
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../../shared/errors/AppError');
const { roundQuantity, isPositive, isCountableUnit, isWholeQuantity } = require('../../shared/utils/numbers');
const { todayIsoDate } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const { QUANTITY_EPSILON } = require('../../shared/constants');
const repository = require('./transfers.repository');
const transitRepository = require('../lg/lg.repository');

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
  openShortages: Number(row.open_discrepancies || 0),
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
  id: row.id,
  ...mapRequestItem(row),
  batchNumber: row.batch_number,
  expiryDate: row.expiry_date,
  acceptedQuantity: roundQuantity(Number(row.accepted_quantity || 0)),
  damagedQuantity: roundQuantity(Number(row.damaged_quantity || 0)),
  missingQuantity: roundQuantity(Number(row.missing_quantity || 0)),
  rejectedQuantity: roundQuantity(Number(row.rejected_quantity || 0)),
  pendingQuantity: roundQuantity(
    Math.max(
      0,
      Number(row.quantity) -
        Number(row.accepted_quantity || 0) -
        Number(row.damaged_quantity || 0) -
        Number(row.missing_quantity || 0) -
        Number(row.rejected_quantity || 0)
    )
  ),
  discrepancyStatus: row.discrepancy_status || 'none',
  discrepancyResolution: row.discrepancy_resolution || null,
  discrepancyNote: row.discrepancy_note || null,
  replacementAuthorisedQuantity: roundQuantity(
    Number(row.replacement_authorised_quantity || 0)
  ),
  replacementTransferId: row.replacement_transfer_id || null,
  replacementTransferNumber: row.replacement_transfer_number || null
});

const mapReceipt = (row) => ({
  id: row.id,
  note: row.note || null,
  acceptedQuantity: roundQuantity(Number(row.accepted_quantity || 0)),
  damagedQuantity: roundQuantity(Number(row.damaged_quantity || 0)),
  missingQuantity: roundQuantity(Number(row.missing_quantity || 0)),
  rejectedQuantity: roundQuantity(Number(row.rejected_quantity || 0)),
  receivedByName: row.received_by_name,
  receivedAt: row.received_at
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

  payload.items.forEach((item, index) => {
    const drug = drugsById.get(item.drugId);
    if (drug && isCountableUnit(drug.unit_of_measure) && !isWholeQuantity(item.quantity)) {
      throw new ValidationError(
        `${drug.name} is counted in ${drug.unit_of_measure || 'units'}, so the quantity must be a whole number`,
        [{ field: `items.${index}.quantity`, message: 'Enter a whole number' }]
      );
    }
  });

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
  const receipts = await repository.listTransferReceipts({ query }, requestId);

  return {
    ...mapRequest(row),
    items: requestItems.map(mapRequestItem),
    batches: transferLines.map(mapTransferLine),
    receipts: receipts.map(mapReceipt)
  };
};

const approveRequest = async ({ actor, scope, requestId, note, clientRequestId }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  if (clientRequestId) {
    const replay = await repository.findDecisionReplay({
      transferId: requestId,
      healthcareCentreId,
      idempotencyKey: clientRequestId
    });
    if (replay) {
      return getRequestDetail({ scope, requestId });
    }
  }

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

    const transit = await transitRepository.findOrCreateTransitLocation(
      client,
      location.local_government_id
    );

    for (const line of lines) {
      const transitBatch = await transitRepository.insertTransitBatch(client, {
        localGovernmentId: location.local_government_id,
        stockLocationId: transit.id,
        drugId: line.drugId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitCost: line.unitCost,
        supplierReference: locked.transfer_number
      });

      await repository.insertTransferLine(client, {
        transferId: requestId,
        transitBatchId: transitBatch.id,
        ...line
      });

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

      await transitRepository.insertLocationMovement(client, {
        drugId: line.drugId,
        batchId: transitBatch.id,
        movementType: 'transit_in',
        quantity: line.quantity,
        reason: `In transit to ${locked.to_centre_name} on ${locked.transfer_number}`,
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
      note,
      idempotencyKey: clientRequestId || null
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

const declineRequest = async ({ actor, scope, requestId, reason, clientRequestId }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  if (clientRequestId) {
    const replay = await repository.findDecisionReplay({
      transferId: requestId,
      healthcareCentreId,
      idempotencyKey: clientRequestId
    });
    if (replay) {
      return getRequestDetail({ scope, requestId });
    }
  }

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
      note: reason,
      idempotencyKey: clientRequestId || null
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

const receiveRequest = async ({ actor, scope, requestId, note, items, clientRequestId }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  if (clientRequestId) {
    const replay = await repository.findReceiptByKey({
      transferId: requestId,
      idempotencyKey: clientRequestId
    });
    if (replay) {
      return getRequestDetail({ scope, requestId });
    }
  }

  if (Array.isArray(items) && items.length > 0) {
    items.forEach((entry, index) => {
      ['acceptedQuantity', 'damagedQuantity', 'missingQuantity', 'rejectedQuantity'].forEach(
        (key) => {
          const raw = entry[key];
          const value = Number(raw === undefined || raw === null || raw === '' ? 0 : raw);
          if (!Number.isFinite(value) || value < 0) {
            throw new ValidationError('Received quantities cannot be negative', [
              { field: `items.${index}.${key}`, message: 'Enter zero or more' }
            ]);
          }
        }
      );
    });
  }

  let result;
  try {
    result = await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.to_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }
    if (locked.status !== 'in_transit' && locked.status !== 'partially_received') {
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

    const supplied =
      Array.isArray(items) && items.length > 0
        ? new Map(items.map((entry) => [entry.transferItemId, entry]))
        : null;

    if (supplied) {
      const known = new Set(lines.map((line) => line.id));
      for (const entry of items) {
        if (!known.has(entry.transferItemId)) {
          throw new ValidationError('Unknown transfer line', [
            { field: 'items.transferItemId', message: 'This line is not part of the transfer' }
          ]);
        }
      }
    }

    const received = [];
    let totalAccepted = 0;
    let totalDamaged = 0;
    let totalMissing = 0;
    let totalRejected = 0;

    for (const line of lines) {
      const allocated = roundQuantity(Number(line.quantity));
      const alreadyRecorded = roundQuantity(
        Number(line.accepted_quantity || 0) +
          Number(line.damaged_quantity || 0) +
          Number(line.missing_quantity || 0) +
          Number(line.rejected_quantity || 0)
      );
      const outstanding = roundQuantity(Math.max(0, allocated - alreadyRecorded));
      const entry = supplied ? supplied.get(line.id) : null;
      const accepted = supplied
        ? roundQuantity(Number((entry && entry.acceptedQuantity) || 0))
        : outstanding;
      const damaged = supplied ? roundQuantity(Number((entry && entry.damagedQuantity) || 0)) : 0;
      const missing = supplied ? roundQuantity(Number((entry && entry.missingQuantity) || 0)) : 0;
      const rejected = supplied ? roundQuantity(Number((entry && entry.rejectedQuantity) || 0)) : 0;
      const counted = roundQuantity(accepted + damaged + missing + rejected);

      if (counted > outstanding + QUANTITY_EPSILON) {
        throw new ValidationError(
          `Only ${outstanding} of ${line.name} is still on the way for this transfer`,
          [{ field: 'items', message: 'A receipt cannot exceed what is still outstanding' }]
        );
      }

      if (counted <= QUANTITY_EPSILON) {
        continue;
      }

      received.push({
        line,
        accepted,
        damaged,
        missing,
        rejected,
        reason: entry ? entry.reason || null : null
      });
      totalAccepted += accepted;
      totalDamaged += damaged;
      totalMissing += missing;
      totalRejected += rejected;
    }

    if (received.length === 0) {
      throw new ValidationError('Enter the quantity that arrived in this transfer', [
        { field: 'items', message: 'At least one batch needs a quantity' }
      ]);
    }

    for (const entry of received) {
      const line = entry.line;

      if (entry.accepted > 0) {
        const batch = await repository.insertInboundBatch(client, {
          healthcareCentreId,
          localGovernmentId: location.local_government_id,
          stockLocationId: location.id,
          drugId: line.drug_id,
          batchNumber: line.batch_number,
          expiryDate: line.expiry_date,
          quantity: entry.accepted,
          unitCost: line.unit_cost,
          supplierReference: locked.transfer_number
        });

        await repository.insertMovement(client, {
          healthcareCentreId,
          drugId: line.drug_id,
          batchId: batch.id,
          movementType: 'transfer_in',
          quantity: entry.accepted,
          reason:
            note ||
            `Received from ${locked.from_centre_name} (${locked.transfer_number})` +
              (entry.missing > 0 ? `, ${entry.missing} missing` : '') +
              (entry.damaged > 0 ? `, ${entry.damaged} damaged` : ''),
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: locked.transfer_number
        });

        const released = await transitRepository.releaseTransitQuantity(client, {
          transitBatchId: line.transit_batch_id,
          drugId: line.drug_id,
          quantity: entry.accepted,
          movementType: 'transit_out',
          reason: `Received at ${locked.to_centre_name} from ${locked.from_centre_name} (${locked.transfer_number})`,
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: locked.transfer_number
        });
        if (!released) {
          throw new ConflictError(
            'Transit stock does not match this transfer, please refresh and try again',
            'TRANSIT_STOCK_MISMATCH'
          );
        }
      }

      if (entry.damaged > 0) {
        const quarantine = await repository.insertQuarantineBatch(client, {
          healthcareCentreId,
          localGovernmentId: location.local_government_id,
          stockLocationId: location.id,
          drugId: line.drug_id,
          batchNumber: `${line.batch_number}-Q`,
          expiryDate: line.expiry_date,
          quantity: entry.damaged,
          unitCost: line.unit_cost,
          supplierReference: locked.transfer_number
        });

        await repository.insertMovement(client, {
          healthcareCentreId,
          drugId: line.drug_id,
          batchId: quarantine.id,
          movementType: 'transfer_in',
          quantity: entry.damaged,
          reason: `Damaged in transit from ${locked.from_centre_name} (${locked.transfer_number}), held in quarantine`,
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: locked.transfer_number
        });

        const released = await transitRepository.releaseTransitQuantity(client, {
          transitBatchId: line.transit_batch_id,
          drugId: line.drug_id,
          quantity: entry.damaged,
          movementType: 'transit_out',
          reason: `Damaged on ${locked.transfer_number}, moved to quarantine`,
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: locked.transfer_number
        });
        if (!released) {
          throw new ConflictError(
            'Transit stock does not match this transfer, please refresh and try again',
            'TRANSIT_STOCK_MISMATCH'
          );
        }
      }

      await repository.updateTransferLineReceipt(client, {
        lineId: line.id,
        acceptedQuantity: entry.accepted,
        damagedQuantity: entry.damaged,
        missingQuantity: entry.missing,
        rejectedQuantity: entry.rejected
      });

      if (entry.missing > 0 || entry.rejected > 0) {
        await repository.openTransferLineDiscrepancy(client, {
          lineId: line.id,
          reason: entry.reason
        });
      }
    }

    const receipt = await repository.insertTransferReceipt(client, {
      localGovernmentId: location.local_government_id,
      healthcareCentreId,
      transferId: requestId,
      note,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing),
      rejectedQuantity: roundQuantity(totalRejected),
      actorId: actor.id,
      actorName: actor.fullName,
      idempotencyKey: clientRequestId || null
    });

    for (const entry of received) {
      await repository.insertTransferReceiptItem(client, {
        receiptId: receipt.id,
        lineId: entry.line.id,
        drugId: entry.line.drug_id,
        acceptedQuantity: entry.accepted,
        damagedQuantity: entry.damaged,
        missingQuantity: entry.missing,
        rejectedQuantity: entry.rejected,
        reason: entry.reason
      });
    }

    const updatedLines = await repository.listTransferLines(client, requestId);
    const remainingQuantity = roundQuantity(
      updatedLines.reduce(
        (sum, line) =>
          sum +
          Math.max(
            0,
            Number(line.quantity) -
              Number(line.accepted_quantity || 0) -
              Number(line.damaged_quantity || 0) -
              Number(line.missing_quantity || 0) -
              Number(line.rejected_quantity || 0)
          ),
        0
      )
    );
    const status = remainingQuantity > QUANTITY_EPSILON ? 'partially_received' : 'received';

    if (status === 'received') {
      await repository.setRequestReceived(client, {
        transferId: requestId,
        actorId: actor.id,
        actorName: actor.fullName,
        note
      });
    } else {
      await repository.setRequestPartiallyReceived(client, {
        transferId: requestId,
        actorId: actor.id,
        actorName: actor.fullName,
        note
      });
    }

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action:
        totalDamaged > 0 || totalMissing > 0 || totalRejected > 0
          ? 'facility_transfer.received_with_discrepancy'
          : 'facility_transfer.received',
      entityType: 'facility_transfer',
      entityId: requestId,
      summary: `Received ${received.length} batch(es) from ${locked.from_centre_name}`,
      newValues: {
        itemCount: received.length,
        acceptedQuantity: roundQuantity(totalAccepted),
        damagedQuantity: roundQuantity(totalDamaged),
        missingQuantity: roundQuantity(totalMissing),
        rejectedQuantity: roundQuantity(totalRejected),
        remainingQuantity,
        status
      }
    });

    return {
      receiptId: receipt.id,
      status,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing),
      rejectedQuantity: roundQuantity(totalRejected),
      remainingQuantity,
      discrepanciesOpened: received.filter(
        (entry) => entry.damaged + entry.missing + entry.rejected > 0
      ).length
    };
    });
  } catch (error) {
    if (clientRequestId && error.code === '23505') {
      const existing = await repository.findReceiptByKey({
        transferId: requestId,
        idempotencyKey: clientRequestId
      });
      if (existing) {
        return getRequestDetail({ scope, requestId });
      }
    }
    throw error;
  }

  const detail = await getRequestDetail({ scope, requestId });
  return {
    ...detail,
    receipt: {
      id: result.receiptId,
      status: result.status,
      acceptedQuantity: result.acceptedQuantity,
      damagedQuantity: result.damagedQuantity,
      missingQuantity: result.missingQuantity,
      rejectedQuantity: result.rejectedQuantity,
      remainingQuantity: result.remainingQuantity,
      discrepanciesOpened: result.discrepanciesOpened
    }
  };
};

const resolveShortage = async ({ actor, scope, requestId, lineId, resolution, note }) => {
  const healthcareCentreId = requireFacilityScope(scope);

  const outcome = await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.to_healthcare_centre_id !== healthcareCentreId) {
      throw new NotFoundError('Transfer request was not found for this facility');
    }

    const line = await repository.lockShortageLine(client, requestId, lineId);
    if (!line) {
      throw new NotFoundError('That shortage was not found on this transfer');
    }
    if (line.discrepancy_status !== 'open') {
      throw new ConflictError('That shortage has already been closed', 'DISCREPANCY_ALREADY_CLOSED');
    }

    const missing = roundQuantity(Number(line.missing_quantity || 0));
    const rejected = roundQuantity(Number(line.rejected_quantity || 0));
    const outstanding = roundQuantity(missing + rejected);
    if (!isPositive(outstanding)) {
      throw new ConflictError(
        'This line has nothing missing or rejected to resolve',
        'NO_OPEN_SHORTAGE'
      );
    }

    const released = await transitRepository.releaseTransitQuantity(client, {
      transitBatchId: line.transit_batch_id,
      drugId: line.drug_id,
      quantity: outstanding,
      movementType: 'write_off',
      reason:
        resolution === 'reissue'
          ? `${missing} missing and ${rejected} rejected ${line.name} on ${locked.transfer_number} written off, replacement owed`
          : `${missing} missing and ${rejected} rejected ${line.name} on ${locked.transfer_number} written off - ${note}`,
      actorId: actor.id,
      actorName: actor.fullName,
      sourceReference: locked.transfer_number
    });
    if (!released) {
      throw new ConflictError(
        'Transit stock for this shortage has already been cleared',
        'TRANSIT_STOCK_MISMATCH'
      );
    }

    let replacement = null;
    if (resolution === 'reissue') {
      replacement = await repository.insertRequest(client, {
        localGovernmentId: locked.local_government_id,
        transferNumber: buildNumber('TRQ'),
        fromCentreId: locked.from_healthcare_centre_id,
        fromCentreName: locked.from_centre_name,
        toCentreId: locked.to_healthcare_centre_id,
        toCentreName: locked.to_centre_name,
        notes: `Replacement for shortage on ${locked.transfer_number}`,
        itemCount: 1,
        totalQuantity: outstanding,
        actorId: actor.id,
        actorName: actor.fullName,
        requestNote: `Replacement for ${outstanding} ${line.name} on ${locked.transfer_number}`
      });
      await repository.insertRequestItem(client, {
        transferId: replacement.id,
        drugId: line.drug_id,
        quantity: outstanding
      });
    }

    await repository.resolveShortageLine(client, {
      lineId,
      resolution,
      note,
      replacementQuantity: replacement ? outstanding : 0,
      replacementTransferId: replacement ? replacement.id : null,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: locked.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'facility_transfer.shortage_resolved',
      entityType: 'facility_transfer_item',
      entityId: lineId,
      summary:
        resolution === 'reissue'
          ? `Requested a replacement of ${outstanding} ${line.name} from ${locked.from_centre_name}`
          : `Wrote off ${outstanding} ${line.name} on ${locked.transfer_number}`,
      newValues: {
        resolution,
        note,
        missingQuantity: missing,
        rejectedQuantity: rejected,
        replacementTransferId: replacement ? replacement.id : null
      }
    });

    return {
      lineId,
      drugName: line.name,
      missingQuantity: missing,
      rejectedQuantity: rejected,
      shortageQuantity: outstanding,
      resolution,
      replacementTransferId: replacement ? replacement.id : null,
      replacementTransferNumber: replacement ? replacement.transfer_number : null
    };
  });

  const detail = await getRequestDetail({ scope, requestId });
  return { ...detail, resolution: outcome };
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
  resolveShortage,
  cancelRequest
};

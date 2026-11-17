const { withTransaction } = require('../../database/connection');
const { ForbiddenError, NotFoundError, ConflictError, ValidationError } = require('../../shared/errors/AppError');
const { roundQuantity } = require('../../shared/utils/numbers');
const { recordAudit } = require('../../shared/utils/audit');
const { QUANTITY_EPSILON } = require('../../shared/constants');
const repository = require('./lg.repository');

const mapDispatchItem = (row) => ({
  id: row.id,
  drugId: row.drug_id,
  drugCode: row.drug_code,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  batchNumber: row.batch_number,
  expiryDate: row.expiry_date,
  quantity: roundQuantity(Number(row.quantity)),
  acceptedQuantity: roundQuantity(Number(row.accepted_quantity || 0)),
  damagedQuantity: roundQuantity(Number(row.damaged_quantity || 0)),
  missingQuantity: roundQuantity(Number(row.missing_quantity || 0)),
  pendingQuantity: roundQuantity(
    Math.max(
      0,
      Number(row.quantity) -
        Number(row.accepted_quantity || 0) -
        Number(row.damaged_quantity || 0) -
        Number(row.missing_quantity || 0)
    )
  ),
  discrepancyReason: row.discrepancy_reason || null,
  unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost)
});

const mapDispatch = (row) => ({
  id: row.id,
  dispatchNumber: row.dispatch_number,
  requisitionId: row.requisition_id,
  healthcareCentreId: row.healthcare_centre_id,
  centreName: row.centre_name,
  status: row.status,
  dispatchedAt: row.dispatched_at,
  receivedByName: row.received_by_name,
  receivedAt: row.received_at,
  receivedNote: row.received_note || null,
  acceptedQuantity: roundQuantity(Number(row.accepted_quantity || 0)),
  damagedQuantity: roundQuantity(Number(row.damaged_quantity || 0)),
  missingQuantity: roundQuantity(Number(row.missing_quantity || 0)),
  note: row.note || null
});

const getDispatchDelivery = async (healthcareCentreId, dispatchId) => {
  const dispatch = await repository.findDispatchForCentre(healthcareCentreId, dispatchId);
  if (!dispatch) {
    throw new NotFoundError('That delivery was not found for this facility');
  }
  const items = await repository.listDispatchItems(dispatch.id);
  return { ...mapDispatch(dispatch), items: items.map(mapDispatchItem) };
};

const receiveDelivery = async ({ actor, scope, requisitionId, dispatchId, note, items }) => {
  const healthcareCentreId = scope.healthcareCentreId;
  if (!healthcareCentreId) {
    throw new ForbiddenError('This action needs a healthcare centre account', 'FACILITY_ONLY');
  }

  const location = await repository.findFacilityLocation(healthcareCentreId);
  if (!location) {
    throw new NotFoundError('This healthcare centre has no active store location');
  }

  if (Array.isArray(items) && items.length > 0) {
    items.forEach((entry, index) => {
      ['acceptedQuantity', 'damagedQuantity', 'missingQuantity'].forEach((key) => {
        const raw = entry[key];
        const value = Number(raw === undefined || raw === null || raw === '' ? 0 : raw);
        if (!Number.isFinite(value) || value < 0) {
          throw new ValidationError('Received quantities cannot be negative', [
            { field: `items.${index}.${key}`, message: 'Enter zero or more' }
          ]);
        }
      });
    });
  }

  const result = await withTransaction(async (client) => {
    const dispatch = dispatchId
      ? await repository.lockDispatchById(client, healthcareCentreId, dispatchId)
      : await repository.lockDispatchForRequisition(client, healthcareCentreId, requisitionId);

    if (!dispatch) {
      throw new NotFoundError('No dispatch has been sent for this requisition');
    }
    if (dispatch.status === 'received') {
      throw new ConflictError('This delivery has already been confirmed', 'DELIVERY_ALREADY_RECEIVED');
    }
    if (dispatch.status === 'cancelled') {
      throw new ConflictError('This dispatch was cancelled', 'DISPATCH_CANCELLED');
    }

    const dispatchItems = await repository.listDispatchItems(dispatch.id);
    if (dispatchItems.length === 0) {
      throw new NotFoundError('This dispatch has no items');
    }

    const supplied =
      Array.isArray(items) && items.length > 0
        ? new Map(items.map((entry) => [entry.dispatchItemId, entry]))
        : null;

    if (supplied) {
      const known = new Set(dispatchItems.map((item) => item.id));
      for (const entry of items) {
        if (!known.has(entry.dispatchItemId)) {
          throw new ValidationError('Unknown dispatch line', [
            { field: 'items.dispatchItemId', message: 'This line is not part of the dispatch' }
          ]);
        }
      }
    }

    const lines = [];
    let totalAccepted = 0;
    let totalDamaged = 0;
    let totalMissing = 0;

    for (const item of dispatchItems) {
      const dispatched = roundQuantity(Number(item.quantity));
      const entry = supplied ? supplied.get(item.id) : null;
      if (supplied && !entry) {
        throw new ValidationError('Confirm every line of the delivery', [
          { field: 'items', message: 'Every dispatched batch needs an accepted quantity' }
        ]);
      }
      const accepted = supplied ? roundQuantity(Number(entry.acceptedQuantity || 0)) : dispatched;
      const damaged = supplied ? roundQuantity(Number(entry.damagedQuantity || 0)) : 0;
      const missing = supplied ? roundQuantity(Number(entry.missingQuantity || 0)) : 0;

      if (Math.abs(accepted + damaged + missing - dispatched) > 0.0005) {
        throw new ValidationError(
          `Accepted, damaged and missing must add up to the ${dispatched} dispatched of ${item.drug_name}`,
          [{ field: 'items', message: 'The three quantities must equal what was dispatched' }]
        );
      }

      lines.push({ item, accepted, damaged, missing, reason: entry ? entry.reason || null : null });
      totalAccepted += accepted;
      totalDamaged += damaged;
      totalMissing += missing;
    }

    for (const line of lines) {
      if (line.accepted > 0) {
        const batch = await repository.insertFacilityBatch(client, {
          healthcareCentreId,
          localGovernmentId: location.local_government_id,
          stockLocationId: location.id,
          drugId: line.item.drug_id,
          batchNumber: line.item.batch_number,
          expiryDate: line.item.expiry_date,
          quantity: line.accepted,
          unitCost: line.item.unit_cost,
          supplierReference: dispatch.dispatch_number
        });

        await repository.insertTransferMovement(client, {
          healthcareCentreId,
          drugId: line.item.drug_id,
          batchId: batch.id,
          quantity: line.accepted,
          reason:
            note ||
            `Accepted from LG warehouse (${dispatch.dispatch_number})` +
              (line.missing > 0 ? `, ${line.missing} missing` : '') +
              (line.damaged > 0 ? `, ${line.damaged} damaged` : ''),
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: dispatch.dispatch_number,
          requisitionId: dispatch.requisition_id
        });
      }

      await repository.updateDispatchItemReceipt(client, {
        itemId: line.item.id,
        acceptedQuantity: line.accepted,
        damagedQuantity: line.damaged,
        missingQuantity: line.missing,
        reason: line.reason
      });
    }

    const fullyAccepted = lines.every(
      (line) => Math.abs(line.accepted - Number(line.item.quantity)) < 0.0005
    );
    const status = fullyAccepted ? 'received' : 'partially_received';

    await repository.insertDispatchReceipt(client, {
      localGovernmentId: location.local_government_id,
      healthcareCentreId,
      dispatchId: dispatch.id,
      requisitionId: dispatch.requisition_id,
      note,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await repository.markDispatchAccounted(client, {
      dispatchId: dispatch.id,
      status,
      actorId: actor.id,
      actorName: actor.fullName,
      note,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing)
    });

    const requisitionItems = await repository.listRequisitionItems(dispatch.requisition_id);
    const settled = requisitionItems.every(
      (item) =>
        Number(item.accepted_quantity) + Number(item.damaged_quantity) >=
        Number(item.approved_quantity) - QUANTITY_EPSILON
    );

    if (settled) {
      await repository.markRequisitionReceived(client, {
        requisitionId: dispatch.requisition_id,
        healthcareCentreId
      });
    }

    await repository.insertRequisitionEvent(client, {
      requisitionId: dispatch.requisition_id,
      eventType: totalDamaged > 0 || totalMissing > 0 ? 'received_with_discrepancy' : 'received',
      actorId: actor.id,
      actorName: actor.fullName,
      comment:
        note ||
        `Delivery ${dispatch.dispatch_number} confirmed (${roundQuantity(totalAccepted)} accepted, ${roundQuantity(totalDamaged)} damaged, ${roundQuantity(totalMissing)} missing)`
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action:
        totalDamaged > 0 || totalMissing > 0
          ? 'delivery.received_with_discrepancy'
          : 'delivery.received',
      entityType: 'lg_dispatch',
      entityId: dispatch.id,
      summary: `Confirmed delivery ${dispatch.dispatch_number} (${lines.length} batch line(s))`,
      newValues: {
        acceptedQuantity: roundQuantity(totalAccepted),
        damagedQuantity: roundQuantity(totalDamaged),
        missingQuantity: roundQuantity(totalMissing),
        status
      }
    });

    return {
      dispatchId: dispatch.id,
      dispatchNumber: dispatch.dispatch_number,
      status,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing),
      requisitionClosed: settled
    };
  });

  return {
    ...result,
    receivedItems: (await repository.listDispatchItems(result.dispatchId)).map(mapDispatchItem)
  };
};

module.exports = { getDispatchDelivery, receiveDelivery };

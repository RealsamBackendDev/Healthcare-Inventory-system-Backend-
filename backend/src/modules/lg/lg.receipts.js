const { withTransaction } = require('../../database/connection');
const { ForbiddenError, NotFoundError, ConflictError, ValidationError } = require('../../shared/errors/AppError');
const { roundQuantity } = require('../../shared/utils/numbers');
const { recordAudit } = require('../../shared/utils/audit');
const { QUANTITY_EPSILON, NOTIFICATION_TYPES } = require('../../shared/constants');
const { notifyLocalGovernmentMembers } = require('../../shared/utils/notifications');
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
  discrepancyReason: row.discrepancy_reason || null,
  discrepancyStatus: row.discrepancy_status || 'none',
  discrepancyResolution: row.discrepancy_resolution || null,
  discrepancyNote: row.discrepancy_note || null,
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
  rejectedQuantity: roundQuantity(Number(row.rejected_quantity || 0)),
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
    let totalRejected = 0;

    for (const item of dispatchItems) {
      const dispatched = roundQuantity(Number(item.quantity));
      const alreadyRecorded = roundQuantity(
        Number(item.accepted_quantity || 0) +
          Number(item.damaged_quantity || 0) +
          Number(item.missing_quantity || 0) +
          Number(item.rejected_quantity || 0)
      );
      const outstanding = roundQuantity(Math.max(0, dispatched - alreadyRecorded));
      const entry = supplied ? supplied.get(item.id) : null;
      const accepted = supplied
        ? roundQuantity(Number((entry && entry.acceptedQuantity) || 0))
        : outstanding;
      const damaged = supplied ? roundQuantity(Number((entry && entry.damagedQuantity) || 0)) : 0;
      const missing = supplied ? roundQuantity(Number((entry && entry.missingQuantity) || 0)) : 0;
      const rejected = supplied ? roundQuantity(Number((entry && entry.rejectedQuantity) || 0)) : 0;
      const counted = roundQuantity(accepted + damaged + missing + rejected);

      if (counted > outstanding + 0.0005) {
        throw new ValidationError(
          `Only ${outstanding} of ${item.drug_name} is still on the way for this delivery`,
          [{ field: 'items', message: 'A receipt cannot exceed what is still outstanding' }]
        );
      }

      if (counted <= 0) {
        continue;
      }

      lines.push({
        item,
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

    if (lines.length === 0) {
      throw new ValidationError('Enter the quantity that arrived in this delivery', [
        { field: 'items', message: 'At least one batch needs a quantity' }
      ]);
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
              (line.rejected > 0 ? `, ${line.rejected} rejected` : '') +
              (line.damaged > 0 ? `, ${line.damaged} damaged` : ''),
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: dispatch.dispatch_number,
          requisitionId: dispatch.requisition_id
        });

        if (line.item.transit_batch_id) {
          const released = await repository.releaseTransitQuantity(client, {
            transitBatchId: line.item.transit_batch_id,
            drugId: line.item.drug_id,
            quantity: line.accepted,
            movementType: 'transit_out',
            reason: `Accepted from ${dispatch.dispatch_number} at the facility`,
            actorId: actor.id,
            actorName: actor.fullName,
            sourceReference: dispatch.dispatch_number,
            requisitionId: dispatch.requisition_id
          });
          if (!released) {
            throw new ConflictError(
              'Transit stock does not match this delivery, please refresh and try again',
              'TRANSIT_STOCK_MISMATCH'
            );
          }
        }
      }

      await repository.updateDispatchItemReceipt(client, {
        itemId: line.item.id,
        acceptedQuantity: line.accepted,
        damagedQuantity: line.damaged,
        missingQuantity: line.missing,
        rejectedQuantity: line.rejected,
        reason: line.reason
      });

      if (line.missing > 0 || line.rejected > 0) {
        await repository.openDispatchItemDiscrepancy(client, line.item.id);
      }

      if (line.damaged > 0) {
        const quarantine = await repository.insertQuarantineBatch(client, {
          healthcareCentreId,
          localGovernmentId: location.local_government_id,
          stockLocationId: location.id,
          drugId: line.item.drug_id,
          batchNumber: `${line.item.batch_number}-Q`,
          expiryDate: line.item.expiry_date,
          quantity: line.damaged,
          unitCost: line.item.unit_cost,
          supplierReference: dispatch.dispatch_number
        });

        await repository.insertTransferMovement(client, {
          healthcareCentreId,
          drugId: line.item.drug_id,
          batchId: quarantine.id,
          quantity: line.damaged,
          reason: `Damaged in transit from the LG warehouse (${dispatch.dispatch_number}), held in quarantine`,
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: dispatch.dispatch_number,
          requisitionId: dispatch.requisition_id
        });

        if (line.item.transit_batch_id) {
          const released = await repository.releaseTransitQuantity(client, {
            transitBatchId: line.item.transit_batch_id,
            drugId: line.item.drug_id,
            quantity: line.damaged,
            movementType: 'transit_out',
            reason: `Damaged on ${dispatch.dispatch_number}, moved to quarantine`,
            actorId: actor.id,
            actorName: actor.fullName,
            sourceReference: dispatch.dispatch_number,
            requisitionId: dispatch.requisition_id
          });
          if (!released) {
            throw new ConflictError(
              'Transit stock does not match this delivery, please refresh and try again',
              'TRANSIT_STOCK_MISMATCH'
            );
          }
        }
      }
    }

    const updatedItems = await repository.listDispatchItems(dispatch.id);
    const remainingQuantity = roundQuantity(
      updatedItems.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(item.quantity) -
              Number(item.accepted_quantity || 0) -
              Number(item.damaged_quantity || 0) -
              Number(item.missing_quantity || 0) -
              Number(item.rejected_quantity || 0)
          ),
        0
      )
    );
    const cumulativeAccepted = roundQuantity(
      updatedItems.reduce((sum, item) => sum + Number(item.accepted_quantity || 0), 0)
    );
    const cumulativeDamaged = roundQuantity(
      updatedItems.reduce((sum, item) => sum + Number(item.damaged_quantity || 0), 0)
    );
    const cumulativeMissing = roundQuantity(
      updatedItems.reduce((sum, item) => sum + Number(item.missing_quantity || 0), 0)
    );
    const cumulativeRejected = roundQuantity(
      updatedItems.reduce((sum, item) => sum + Number(item.rejected_quantity || 0), 0)
    );
    const status = remainingQuantity > 0.0005 ? 'partially_received' : 'received';

    await repository.insertDispatchReceipt(client, {
      localGovernmentId: location.local_government_id,
      healthcareCentreId,
      dispatchId: dispatch.id,
      requisitionId: dispatch.requisition_id,
      note,
      actorId: actor.id,
      actorName: actor.fullName,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing),
      rejectedQuantity: roundQuantity(totalRejected)
    });

    await repository.markDispatchAccounted(client, {
      dispatchId: dispatch.id,
      status,
      actorId: actor.id,
      actorName: actor.fullName,
      note,
      acceptedQuantity: cumulativeAccepted,
      damagedQuantity: cumulativeDamaged,
      missingQuantity: cumulativeMissing,
      rejectedQuantity: cumulativeRejected
    });

    const requisitionItems = await repository.listRequisitionItems(dispatch.requisition_id);
    const settled = requisitionItems.every(
      (item) =>
        Number(item.accepted_quantity) + Number(item.closed_short_quantity || 0) >= Number(item.approved_quantity) - QUANTITY_EPSILON
    );
    const discrepanciesOpened = lines.filter((line) => line.missing > 0 || line.rejected > 0).length;
    const damagedQuarantined = roundQuantity(totalDamaged);

    if (settled) {
      await repository.markRequisitionReceived(client, {
        requisitionId: dispatch.requisition_id,
        healthcareCentreId
      });
    }

    await repository.insertRequisitionEvent(client, {
      requisitionId: dispatch.requisition_id,
      eventType:
        totalDamaged > 0 || totalMissing > 0 || totalRejected > 0
          ? 'received_with_discrepancy'
          : 'received',
      actorId: actor.id,
      actorName: actor.fullName,
      comment:
        note ||
        `Delivery ${dispatch.dispatch_number} confirmed (${roundQuantity(totalAccepted)} accepted, ${roundQuantity(totalDamaged)} damaged, ${roundQuantity(totalMissing)} missing, ${roundQuantity(totalRejected)} rejected)`
    });

    await recordAudit(client, {
      healthcareCentreId,
      localGovernmentId: location.local_government_id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action:
        totalDamaged > 0 || totalMissing > 0 || totalRejected > 0
          ? 'delivery.received_with_discrepancy'
          : 'delivery.received',
      entityType: 'lg_dispatch',
      entityId: dispatch.id,
      summary: `Confirmed delivery ${dispatch.dispatch_number} (${lines.length} batch line(s))`,
      newValues: {
        acceptedQuantity: roundQuantity(totalAccepted),
        damagedQuantity: roundQuantity(totalDamaged),
        missingQuantity: roundQuantity(totalMissing),
        rejectedQuantity: roundQuantity(totalRejected),
        remainingQuantity,
        status
      }
    });

    await notifyLocalGovernmentMembers(client, {
      localGovernmentId: location.local_government_id,
      excludeUserId: actor.id,
      type: NOTIFICATION_TYPES.DELIVERY_RECEIVED,
      title: 'Delivery confirmed',
      message: `${dispatch.dispatch_number} to ${scope.centreName || 'the facility'} was confirmed (${roundQuantity(totalAccepted)} accepted, ${roundQuantity(totalDamaged)} damaged, ${roundQuantity(totalMissing)} missing, ${roundQuantity(totalRejected)} rejected)`,
      entityType: 'lg_dispatch',
      entityId: dispatch.id
    });

    if (discrepanciesOpened > 0) {
      await notifyLocalGovernmentMembers(client, {
        localGovernmentId: location.local_government_id,
        excludeUserId: actor.id,
        type: NOTIFICATION_TYPES.DISCREPANCY_OPENED,
        title: 'Discrepancy needs action',
        message: `${dispatch.dispatch_number} to ${scope.centreName || 'the facility'} has ${discrepanciesOpened} line(s) with damage or shortage to resolve`,
        entityType: 'lg_dispatch',
        entityId: dispatch.id
      });
    }

    return {
      dispatchId: dispatch.id,
      dispatchNumber: dispatch.dispatch_number,
      status,
      acceptedQuantity: roundQuantity(totalAccepted),
      damagedQuantity: roundQuantity(totalDamaged),
      missingQuantity: roundQuantity(totalMissing),
      rejectedQuantity: roundQuantity(totalRejected),
      remainingQuantity,
      discrepanciesOpened,
      damagedQuarantined,
      requisitionClosed: settled
    };
  });

  return {
    ...result,
    receivedItems: (await repository.listDispatchItems(result.dispatchId)).map(mapDispatchItem)
  };
};

module.exports = { getDispatchDelivery, receiveDelivery };

const crypto = require('crypto');
const { withTransaction } = require('../../database/connection');
const { ConflictError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { roundQuantity, isZero, hasSufficient } = require('../../shared/utils/numbers');
const { parseDateInput, todayIsoDate } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { RETURN_STATUS, BATCH_STATUS } = require('../../shared/constants');
const repository = require('./adjustments.repository');

const DISPOSITION_TARGET_STATUS = {
  quarantined: BATCH_STATUS.QUARANTINED,
  blocked: BATCH_STATUS.BLOCKED,
  restock_usable: BATCH_STATUS.USABLE
};

const DISPOSITION_REASONS = {
  return_to_supplier: 'Returned to supplier',
  destroyed: 'Destroyed on approved return',
  quarantined: 'Quarantined on approved return',
  blocked: 'Blocked on approved return',
  restock_usable: 'Released back to usable stock after inspection'
};

const generateRequestNumber = () => {
  const date = todayIsoDate().replace(/-/g, '');
  return `RET-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

const mapReturnSummary = (row) => ({
  id: row.id,
  requestNumber: row.request_number,
  reason: row.reason,
  reference: row.reference,
  status: row.status,
  requestedBy: row.requested_by,
  requestedByName: row.requested_by_name,
  reviewedByName: row.reviewed_by_name,
  reviewedAt: row.reviewed_at,
  reviewComment: row.review_comment,
  itemCount: row.item_count === undefined ? undefined : Number(row.item_count),
  totalQuantity: row.total_quantity === undefined ? undefined : roundQuantity(Number(row.total_quantity)),
  createdAt: row.created_at
});

const mapReturnItem = (row) => ({
  id: row.id,
  batchId: row.batch_id,
  drugId: row.drug_id,
  drugCode: row.drug_code,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  batchNumber: row.batch_number,
  batchStatus: row.batch_status,
  batchQuantity: roundQuantity(Number(row.batch_quantity)),
  quantity: roundQuantity(Number(row.quantity)),
  disposition: row.disposition
});

const createReturn = async ({ actor, healthcareCentreId, payload }) =>
  withTransaction(async (client) => {
    const request = await repository.insertReturnRequest(client, {
      healthcareCentreId,
      requestNumber: generateRequestNumber(),
      reason: payload.reason,
      reference: payload.reference || null,
      actorId: actor.id,
      actorName: actor.fullName
    });

    const createdItems = [];

    for (const item of payload.items) {
      const batch = await repository.lockBatch(client, healthcareCentreId, item.batchId);
      if (!batch) {
        throw new ValidationError('One or more selected batches could not be found', [
          { field: 'items', message: `Batch ${item.batchId} was not found in this healthcare centre` }
        ]);
      }

      const quantity = roundQuantity(Number(item.quantity));

      if (!hasSufficient(Number(batch.quantity), quantity)) {
        throw new ConflictError(
          `Return quantity for ${batch.drug_name} batch ${batch.batch_number} exceeds the quantity on hand (${batch.quantity})`,
          'RETURN_EXCEEDS_BATCH'
        );
      }

      await repository.insertReturnItem(client, {
        returnRequestId: request.id,
        drugId: batch.drug_id,
        batchId: batch.id,
        quantity,
        disposition: item.disposition
      });

      createdItems.push({
        batchId: batch.id,
        drugId: batch.drug_id,
        drugCode: batch.drug_code,
        drugName: batch.drug_name,
        batchNumber: batch.batch_number,
        batchStatus: batch.status,
        batchQuantity: roundQuantity(Number(batch.quantity)),
        quantity,
        disposition: item.disposition
      });
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'return.requested',
      entityType: 'return_request',
      entityId: request.id,
      summary: `Created return request ${request.request_number} with ${createdItems.length} item(s)`,
      newValues: {
        requestNumber: request.request_number,
        items: createdItems.map((item) => ({
          drugName: item.drugName,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          disposition: item.disposition
        }))
      },
      reason: payload.reason
    });

    return {
      returnRequest: mapReturnSummary({ ...request, item_count: createdItems.length }),
      items: createdItems
    };
  });

const listReturns = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listReturns({
    healthcareCentreId,
    status: filters.status || null,
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    limit,
    offset
  });
  return {
    items: rows.map(mapReturnSummary),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getReturn = async (healthcareCentreId, returnId) => {
  const request = await repository.findReturn(healthcareCentreId, returnId);
  if (!request) {
    throw new NotFoundError('Return request was not found');
  }
  const items = await repository.listReturnItems(request.id);
  return {
    returnRequest: mapReturnSummary(request),
    items: items.map(mapReturnItem)
  };
};

const approveReturn = async ({ actor, healthcareCentreId, returnId, comment }) =>
  withTransaction(async (client) => {
    const request = await repository.lockReturn(client, healthcareCentreId, returnId);
    if (!request) {
      throw new NotFoundError('Return request was not found');
    }
    if (request.status !== RETURN_STATUS.PENDING) {
      throw new ConflictError('Only pending return requests can be approved', 'RETURN_NOT_PENDING');
    }

    const items = await repository.listReturnItems(returnId);
    if (items.length === 0) {
      throw new ConflictError('This return request has no items', 'EMPTY_RETURN');
    }

    const appliedItems = [];

    for (const item of items) {
      const batch = await repository.lockBatch(client, healthcareCentreId, item.batch_id);
      if (!batch) {
        throw new ConflictError('A batch on this return request no longer exists', 'BATCH_MISSING');
      }

      const quantity = roundQuantity(Number(item.quantity));
      const previousStatus = batch.status;
      const previousQuantity = roundQuantity(Number(batch.quantity));
      let newQuantity = previousQuantity;
      let newStatus = previousStatus;

      if (item.disposition === 'return_to_supplier' || item.disposition === 'destroyed') {
        if (!hasSufficient(previousQuantity, quantity)) {
          throw new ConflictError(
            `Batch ${batch.batch_number} no longer has enough quantity for this return`,
            'RETURN_EXCEEDS_BATCH'
          );
        }

        newQuantity = roundQuantity(previousQuantity - quantity);
        await repository.setBatchQuantity(client, { batchId: batch.id, quantity: newQuantity });

        await repository.insertReturnMovement(client, {
          healthcareCentreId,
          drugId: item.drug_id,
          batchId: batch.id,
          quantity: roundQuantity(-quantity),
          reason: `${DISPOSITION_REASONS[item.disposition]}: ${request.reason}`,
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: request.request_number,
          returnRequestId: request.id
        });

        if (item.disposition === 'destroyed' && isZero(newQuantity)) {
          newStatus = BATCH_STATUS.DESTROYED;
        }
      } else {
        newStatus = DISPOSITION_TARGET_STATUS[item.disposition] || previousStatus;
      }

      if (newStatus !== previousStatus) {
        await repository.setBatchStatus(client, { batchId: batch.id, status: newStatus });
      }

      await recordAudit(client, {
        healthcareCentreId,
        actor,
        action: 'return.approved',
        entityType: 'return_request_item',
        entityId: item.id,
        summary: `Approved return of ${quantity} ${batch.unit_of_measure} of ${batch.drug_name} batch ${batch.batch_number} (${item.disposition})`,
        previousValues: { batchStatus: previousStatus, batchQuantity: previousQuantity },
        newValues: { batchStatus: newStatus, batchQuantity: newQuantity, disposition: item.disposition },
        reason: comment || request.reason
      });

      appliedItems.push({
        batchId: batch.id,
        drugName: batch.drug_name,
        batchNumber: batch.batch_number,
        quantity,
        disposition: item.disposition,
        previousStatus,
        newStatus,
        previousQuantity,
        newQuantity
      });
    }

    await repository.setReturnReview(client, {
      returnId,
      status: RETURN_STATUS.APPROVED,
      reviewerId: actor.id,
      reviewerName: actor.fullName,
      comment
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'return.approval_recorded',
      entityType: 'return_request',
      entityId: returnId,
      summary: `Approved return request ${request.request_number}`,
      previousValues: { status: request.status },
      newValues: { status: RETURN_STATUS.APPROVED },
      reason: comment || request.reason
    });

    return {
      returnRequest: mapReturnSummary({
        ...request,
        status: RETURN_STATUS.APPROVED,
        reviewed_by_name: actor.fullName,
        review_comment: comment || null
      }),
      appliedItems
    };
  });

const rejectReturn = async ({ actor, healthcareCentreId, returnId, comment }) =>
  withTransaction(async (client) => {
    const request = await repository.lockReturn(client, healthcareCentreId, returnId);
    if (!request) {
      throw new NotFoundError('Return request was not found');
    }
    if (request.status !== RETURN_STATUS.PENDING) {
      throw new ConflictError('Only pending return requests can be rejected', 'RETURN_NOT_PENDING');
    }

    await repository.setReturnReview(client, {
      returnId,
      status: RETURN_STATUS.REJECTED,
      reviewerId: actor.id,
      reviewerName: actor.fullName,
      comment
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'return.rejected',
      entityType: 'return_request',
      entityId: returnId,
      summary: `Rejected return request ${request.request_number}`,
      previousValues: { status: request.status },
      newValues: { status: RETURN_STATUS.REJECTED },
      reason: comment || null
    });

    return { message: 'Return request rejected. Stock was not changed' };
  });

module.exports = {
  createReturn,
  listReturns,
  getReturn,
  approveReturn,
  rejectReturn
};

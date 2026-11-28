const { randomUUID } = require('crypto');
const { withTransaction } = require('../../database/connection');
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../../shared/errors/AppError');
const { roundQuantity, roundMoney, isZero, isNegative, hasSufficient } = require('../../shared/utils/numbers');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { parseDateInput } = require('../../shared/utils/date');
const { getNumberSetting } = require('../../shared/utils/settings');
const { recordAudit } = require('../../shared/utils/audit');
const {
  ROLES,
  SETTING_KEYS,
  ADJUSTMENT_STATUS,
  MOVEMENT_TYPES,
  BATCH_STATUS
} = require('../../shared/constants');
const repository = require('./adjustments.repository');

const mapAdjustment = (row) => ({
  id: row.id,
  groupId: row.group_id || null,
  drugId: row.drug_id,
  drugCode: row.drug_code,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  batchId: row.batch_id,
  batchNumber: row.batch_number,
  adjustmentType: row.adjustment_type,
  quantity: roundQuantity(Number(row.quantity)),
  unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
  valueImpact:
    row.unit_cost === null || row.unit_cost === undefined
      ? null
      : roundMoney(Math.abs(Number(row.quantity)) * Number(row.unit_cost)),
  reason: row.reason,
  reference: row.reference,
  status: row.status,
  requestedBy: row.requested_by,
  requestedByName: row.requested_by_name,
  reviewedByName: row.reviewed_by_name,
  reviewedAt: row.reviewed_at,
  appliedAt: row.applied_at,
  reviewComment: row.review_comment,
  createdAt: row.created_at
});

const getThresholds = async (client, healthcareCentreId) => ({
  quantityThreshold: await getNumberSetting(
    client,
    healthcareCentreId,
    SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD
  ),
  valueThreshold: await getNumberSetting(client, healthcareCentreId, SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD)
});

const applyToBatch = async (client, { adjustment, batch, actor, healthcareCentreId, previousQuantity }) => {
  const newQuantity = roundQuantity(Number(previousQuantity) + Number(adjustment.quantity));

  if (isNegative(newQuantity)) {
    throw new ConflictError('This adjustment would make the batch quantity negative', 'NEGATIVE_STOCK');
  }

  await repository.setBatchQuantity(client, { batchId: batch.id, quantity: newQuantity });

  await repository.insertAdjustmentMovement(client, {
    healthcareCentreId,
    drugId: adjustment.drug_id,
    batchId: adjustment.batch_id,
    quantity: Number(adjustment.quantity),
    reason: adjustment.reason,
    actorId: actor.id,
    actorName: actor.fullName,
    sourceReference: adjustment.reference || null,
    adjustmentId: adjustment.id
  });

  return newQuantity;
};

const createAdjustment = async ({ actor, roleCode, healthcareCentreId, payload }) => {
  const quantity = roundQuantity(Number(payload.quantity));

  if (isZero(quantity)) {
    throw new ValidationError('Adjustment quantity cannot be zero', [
      { field: 'quantity', message: 'Enter a positive or negative quantity' }
    ]);
  }

  return withTransaction(async (client) => {
    const batch = await repository.lockBatch(client, healthcareCentreId, payload.batchId);

    if (!batch || batch.drug_id !== payload.drugId) {
      throw new ValidationError('The selected batch does not belong to this drug', [
        { field: 'batchId', message: 'Select a batch that belongs to the chosen drug' }
      ]);
    }

    if (!batch.drug_active) {
      throw new ConflictError('Adjustments cannot be created for an inactive drug', 'DRUG_INACTIVE');
    }

    if (batch.status === BATCH_STATUS.DESTROYED) {
      throw new ConflictError('Adjustments cannot be created for a destroyed batch', 'BATCH_DESTROYED');
    }

    const resultingQuantity = roundQuantity(Number(batch.quantity) + quantity);
    if (isNegative(resultingQuantity)) {
      throw new ConflictError(
        `Cannot reduce ${batch.drug_name} (${batch.batch_number}) by ${absoluteQuantity} ${batch.unit_of_measure}. Only ${batch.quantity} ${batch.unit_of_measure} is on hand, and stock cannot go below zero.`,
        'NEGATIVE_STOCK'
      );
    }

    const thresholds = await getThresholds(client, healthcareCentreId);
    const absoluteQuantity = Math.abs(quantity);
    const unitCost = batch.unit_cost === null ? 0 : Number(batch.unit_cost);
    const valueImpact = roundMoney(absoluteQuantity * unitCost);

    const withinThreshold =
      hasSufficient(thresholds.quantityThreshold, absoluteQuantity) &&
      hasSufficient(thresholds.valueThreshold, valueImpact);

    const isAdministrator = roleCode === ROLES.ADMINISTRATOR;
    const directApply = isAdministrator || withinThreshold;

    const adjustment = await repository.insertAdjustment(client, {
      healthcareCentreId,
      drugId: payload.drugId,
      batchId: payload.batchId,
      adjustmentType: payload.adjustmentType,
      quantity,
      reason: payload.reason,
      reference: payload.reference,
      status: directApply ? ADJUSTMENT_STATUS.APPROVED : ADJUSTMENT_STATUS.PENDING,
      actorId: actor.id,
      actorName: actor.fullName,
      reviewedById: directApply ? actor.id : null,
      reviewedByName: directApply ? actor.fullName : null
    });

    let newQuantity = Number(batch.quantity);

    if (directApply) {
      newQuantity = await applyToBatch(client, {
        adjustment,
        batch,
        actor,
        healthcareCentreId,
        previousQuantity: batch.quantity
      });
      await repository.markApplied(client, adjustment.id);
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: directApply ? 'adjustment.applied' : 'adjustment.requested',
      entityType: 'stock_adjustment',
      entityId: adjustment.id,
      summary: `${directApply ? 'Applied' : 'Requested'} ${quantity} ${batch.unit_of_measure} adjustment for ${batch.drug_name} (${batch.batch_number})`,
      previousValues: { batchQuantity: Number(batch.quantity), thresholds },
      newValues: {
        quantity,
        valueImpact,
        status: adjustment.status,
        batchQuantity: newQuantity,
        requiresApproval: !directApply
      },
      reason: payload.reason
    });

    return {
      adjustment: mapAdjustment({
        ...adjustment,
        drug_code: batch.drug_code,
        drug_name: batch.drug_name,
        unit_of_measure: batch.unit_of_measure,
        batch_number: batch.batch_number,
        unit_cost: batch.unit_cost
      }),
      requiresApproval: !directApply,
      thresholds,
      batchQuantity: newQuantity
    };
  });
};

const listAdjustments = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listAdjustments({
    healthcareCentreId,
    status: filters.status || null,
    drugId: filters.drugId || null,
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    limit,
    offset
  });
  return {
    items: rows.map(mapAdjustment),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getAdjustment = async (healthcareCentreId, adjustmentId) => {
  const adjustment = await repository.findAdjustment(healthcareCentreId, adjustmentId);
  if (!adjustment) {
    throw new NotFoundError('Stock adjustment was not found');
  }
  return mapAdjustment(adjustment);
};

const approveAdjustment = async ({ actor, healthcareCentreId, adjustmentId, comment }) =>
  withTransaction(async (client) => {
    const adjustment = await repository.lockAdjustment(client, healthcareCentreId, adjustmentId);
    if (!adjustment) {
      throw new NotFoundError('Stock adjustment was not found');
    }
    if (adjustment.status !== ADJUSTMENT_STATUS.PENDING) {
      throw new ConflictError('Only pending adjustments can be approved', 'ADJUSTMENT_NOT_PENDING');
    }
    if (adjustment.group_id) {
      throw new ConflictError(
        'This line belongs to a stock quantity adjustment. Approve or reject the whole bulk request instead',
        'GROUP_REVIEW_REQUIRED'
      );
    }
    if (adjustment.requested_by === actor.id) {
      throw new ForbiddenError(
        'You cannot approve an adjustment you raised. Another administrator has to review it',
        'SELF_APPROVAL_DENIED'
      );
    }

    const batch = await repository.lockBatch(client, healthcareCentreId, adjustment.batch_id);
    if (!batch) {
      throw new NotFoundError('The batch for this adjustment no longer exists');
    }

    const newQuantity = await applyToBatch(client, {
      adjustment,
      batch,
      actor,
      healthcareCentreId,
      previousQuantity: batch.quantity
    });

    await repository.setReview(client, {
      adjustmentId,
      status: ADJUSTMENT_STATUS.APPROVED,
      reviewerId: actor.id,
      reviewerName: actor.fullName,
      comment,
      applied: true
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'adjustment.approved',
      entityType: 'stock_adjustment',
      entityId: adjustmentId,
      summary: `Approved adjustment of ${adjustment.quantity} for ${batch.drug_name} (${batch.batch_number})`,
      previousValues: { status: adjustment.status, batchQuantity: Number(batch.quantity) },
      newValues: { status: ADJUSTMENT_STATUS.APPROVED, batchQuantity: newQuantity },
      reason: comment || adjustment.reason
    });

    return {
      adjustment: mapAdjustment({
        ...adjustment,
        status: ADJUSTMENT_STATUS.APPROVED,
        reviewed_by_name: actor.fullName,
        review_comment: comment || null,
        unit_cost: batch.unit_cost,
        drug_code: batch.drug_code,
        drug_name: batch.drug_name,
        unit_of_measure: batch.unit_of_measure,
        batch_number: batch.batch_number
      }),
      batchQuantity: newQuantity
    };
  });

const rejectAdjustment = async ({ actor, healthcareCentreId, adjustmentId, comment }) =>
  withTransaction(async (client) => {
    const adjustment = await repository.lockAdjustment(client, healthcareCentreId, adjustmentId);
    if (!adjustment) {
      throw new NotFoundError('Stock adjustment was not found');
    }
    if (adjustment.status !== ADJUSTMENT_STATUS.PENDING) {
      throw new ConflictError('Only pending adjustments can be rejected', 'ADJUSTMENT_NOT_PENDING');
    }
    if (adjustment.group_id) {
      throw new ConflictError(
        'This line belongs to a stock quantity adjustment. Approve or reject the whole bulk request instead',
        'GROUP_REVIEW_REQUIRED'
      );
    }

    await repository.setReview(client, {
      adjustmentId,
      status: ADJUSTMENT_STATUS.REJECTED,
      reviewerId: actor.id,
      reviewerName: actor.fullName,
      comment,
      applied: false
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'adjustment.rejected',
      entityType: 'stock_adjustment',
      entityId: adjustmentId,
      summary: 'Rejected stock adjustment request',
      previousValues: { status: adjustment.status },
      newValues: { status: ADJUSTMENT_STATUS.REJECTED },
      reason: comment || null
    });

    return { message: 'Adjustment rejected. Stock levels were not changed' };
  });

const prepareBulkLine = async (client, healthcareCentreId, line) => {
  const quantity = roundQuantity(Number(line.quantity));

  if (isZero(quantity)) {
    throw new ValidationError('Every bulk line needs a quantity', [
      { field: 'lines', message: 'Every line needs an increase or a reduction greater than zero' }
    ]);
  }

  const batch = await repository.lockBatch(client, healthcareCentreId, line.batchId);

  if (!batch || (line.drugId && batch.drug_id !== line.drugId)) {
    throw new ValidationError('One of the selected batches could not be found', [
      { field: 'lines', message: 'Remove the line and choose the batch again' }
    ]);
  }

  if (!batch.drug_active) {
    throw new ConflictError(`${batch.drug_name} is inactive, so it cannot be adjusted`, 'DRUG_INACTIVE');
  }

  if (batch.status === BATCH_STATUS.DESTROYED) {
    throw new ConflictError(
      `${batch.drug_name} (${batch.batch_number}) is destroyed and cannot be adjusted`,
      'BATCH_DESTROYED'
    );
  }

  const resultingQuantity = roundQuantity(Number(batch.quantity) + quantity);
  if (isNegative(resultingQuantity)) {
    throw new ConflictError(
      `Cannot reduce ${batch.drug_name} (${batch.batch_number}) by ${Math.abs(quantity)} ${batch.unit_of_measure}. Only ${batch.quantity} ${batch.unit_of_measure} is on hand, and stock cannot go below zero.`,
      'NEGATIVE_STOCK'
    );
  }

  return { batch, quantity };
};

const createBulkAdjustment = async ({
  actor,
  roleCode,
  healthcareCentreId,
  lines,
  adjustmentType,
  reason,
  reference
}) =>
  withTransaction(async (client) => {
    const prepared = [];
    for (const line of lines) {
      prepared.push(await prepareBulkLine(client, healthcareCentreId, line));
    }

    const directApply = roleCode === ROLES.ADMINISTRATOR;
    const groupId = randomUUID();
    const adjustments = [];
    let totalIncrease = 0;
    let totalReduction = 0;

    for (const entry of prepared) {
      const adjustment = await repository.insertAdjustment(client, {
        healthcareCentreId,
        groupId,
        drugId: entry.batch.drug_id,
        batchId: entry.batch.id,
        adjustmentType: adjustmentType || 'correction',
        quantity: entry.quantity,
        reason,
        reference: reference || null,
        status: directApply ? ADJUSTMENT_STATUS.APPROVED : ADJUSTMENT_STATUS.PENDING,
        actorId: actor.id,
        actorName: actor.fullName,
        reviewedById: directApply ? actor.id : null,
        reviewedByName: directApply ? actor.fullName : null
      });

      if (directApply) {
        await applyToBatch(client, {
          adjustment,
          batch: entry.batch,
          actor,
          healthcareCentreId,
          previousQuantity: entry.batch.quantity
        });
        await repository.markApplied(client, adjustment.id);
      }

      if (entry.quantity > 0) {
        totalIncrease = roundQuantity(totalIncrease + entry.quantity);
      } else {
        totalReduction = roundQuantity(totalReduction + Math.abs(entry.quantity));
      }

      adjustments.push(
        mapAdjustment({
          ...adjustment,
          group_id: groupId,
          drug_code: entry.batch.drug_code,
          drug_name: entry.batch.drug_name,
          unit_of_measure: entry.batch.unit_of_measure,
          batch_number: entry.batch.batch_number,
          unit_cost: entry.batch.unit_cost
        })
      );
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: directApply ? 'adjustment.bulk_applied' : 'adjustment.bulk_requested',
      entityType: 'stock_adjustment_group',
      entityId: groupId,
      summary: `${directApply ? 'Applied' : 'Requested'} a ${prepared.length} line stock quantity adjustment`,
      previousValues: null,
      newValues: {
        groupId,
        lines: prepared.length,
        totalIncrease,
        totalReduction,
        status: directApply ? ADJUSTMENT_STATUS.APPROVED : ADJUSTMENT_STATUS.PENDING
      },
      reason
    });

    return {
      groupId,
      requiresApproval: !directApply,
      adjustments,
      summary: { lines: prepared.length, totalIncrease, totalReduction }
    };
  });

const approveAdjustmentGroup = async ({ actor, healthcareCentreId, groupId, comment }) =>
  withTransaction(async (client) => {
    const rows = await repository.lockAdjustmentGroup(client, healthcareCentreId, groupId);
    if (rows.length === 0) {
      throw new NotFoundError('Stock quantity adjustment was not found');
    }

    const pending = rows.filter((row) => row.status === ADJUSTMENT_STATUS.PENDING);
    if (pending.length === 0) {
      throw new ConflictError('Only pending corrections can be approved', 'ADJUSTMENT_NOT_PENDING');
    }

    if (pending.some((row) => row.requested_by === actor.id)) {
      throw new ForbiddenError(
        'You cannot approve a stock quantity adjustment you raised. Another administrator has to review it',
        'SELF_APPROVAL_DENIED'
      );
    }

    const applied = [];

    for (const adjustment of pending) {
      const batch = await repository.lockBatch(client, healthcareCentreId, adjustment.batch_id);
      if (!batch) {
        throw new NotFoundError('The batch for one of these corrections no longer exists');
      }

      const newQuantity = await applyToBatch(client, {
        adjustment,
        batch,
        actor,
        healthcareCentreId,
        previousQuantity: batch.quantity
      });

      await repository.setReview(client, {
        adjustmentId: adjustment.id,
        status: ADJUSTMENT_STATUS.APPROVED,
        reviewerId: actor.id,
        reviewerName: actor.fullName,
        comment,
        applied: true
      });

      await recordAudit(client, {
        healthcareCentreId,
        actor,
        action: 'adjustment.group_approved',
        entityType: 'stock_adjustment_group',
        entityId: groupId,
        summary: `Approved bulk line ${adjustment.quantity} for ${batch.drug_name} (${batch.batch_number})`,
        previousValues: { status: adjustment.status, batchQuantity: Number(batch.quantity) },
        newValues: { status: ADJUSTMENT_STATUS.APPROVED, batchQuantity: newQuantity },
        reason: comment || adjustment.reason
      });

      applied.push({
        id: adjustment.id,
        drugName: batch.drug_name,
        batchNumber: batch.batch_number,
        quantity: roundQuantity(Number(adjustment.quantity)),
        batchQuantity: newQuantity
      });
    }

    return { groupId, appliedCount: applied.length, lines: applied };
  });

const rejectAdjustmentGroup = async ({ actor, healthcareCentreId, groupId, comment }) =>
  withTransaction(async (client) => {
    const rows = await repository.lockAdjustmentGroup(client, healthcareCentreId, groupId);
    if (rows.length === 0) {
      throw new NotFoundError('Stock quantity adjustment was not found');
    }

    const pending = rows.filter((row) => row.status === ADJUSTMENT_STATUS.PENDING);
    if (pending.length === 0) {
      throw new ConflictError('Only pending corrections can be rejected', 'ADJUSTMENT_NOT_PENDING');
    }

    for (const adjustment of pending) {
      await repository.setReview(client, {
        adjustmentId: adjustment.id,
        status: ADJUSTMENT_STATUS.REJECTED,
        reviewerId: actor.id,
        reviewerName: actor.fullName,
        comment,
        applied: false
      });
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'adjustment.group_rejected',
      entityType: 'stock_adjustment_group',
      entityId: groupId,
      summary: `Rejected a ${pending.length} line bulk quantity correction`,
      previousValues: { status: ADJUSTMENT_STATUS.PENDING },
      newValues: { status: ADJUSTMENT_STATUS.REJECTED, lines: pending.length },
      reason: comment || null
    });

    return { groupId, rejectedCount: pending.length };
  });

const createStockCount = async ({ actor, healthcareCentreId, lines, reason, reference }) =>
  withTransaction(async (client) => {
    const results = [];

    for (const line of lines) {
      const batch = await repository.lockBatch(client, healthcareCentreId, line.batchId);
      if (!batch) {
        throw new ValidationError('One or more batches could not be found', [
          { field: 'lines', message: `Batch ${line.batchId} was not found in this healthcare centre` }
        ]);
      }

      const systemQuantity = roundQuantity(Number(batch.quantity));
      const countedQuantity = roundQuantity(Number(line.countedQuantity));
      const variance = roundQuantity(countedQuantity - systemQuantity);

      let adjustmentId = null;
      let adjustmentStatus = null;

      if (!isZero(variance)) {
        const adjustment = await repository.insertAdjustment(client, {
          healthcareCentreId,
          drugId: batch.drug_id,
          batchId: batch.id,
          adjustmentType: 'physical_count',
          quantity: variance,
          reason: line.reason || reason || 'Physical stock count variance',
          reference: line.reference || reference || null,
          status: ADJUSTMENT_STATUS.PENDING,
          actorId: actor.id,
          actorName: actor.fullName
        });

        adjustmentId = adjustment.id;
        adjustmentStatus = adjustment.status;

        await recordAudit(client, {
          healthcareCentreId,
          actor,
          action: 'adjustment.proposed',
          entityType: 'stock_adjustment',
          entityId: adjustment.id,
          summary: `Physical count variance of ${variance} for ${batch.drug_name} (${batch.batch_number})`,
          previousValues: { systemQuantity },
          newValues: { countedQuantity, variance, status: adjustment.status },
          reason: line.reason || reason || 'Physical stock count variance'
        });
      }

      results.push({
        batchId: batch.id,
        drugId: batch.drug_id,
        drugCode: batch.drug_code,
        drugName: batch.drug_name,
        unitOfMeasure: batch.unit_of_measure,
        batchNumber: batch.batch_number,
        systemQuantity,
        countedQuantity,
        variance,
        adjustmentId,
        adjustmentStatus
      });
    }

    const variances = results.filter((result) => !isZero(result.variance)).length;

    return {
      results,
      summary: {
        lines: results.length,
        variances,
        pendingAdjustments: variances
      }
    };
  });

module.exports = {
  createAdjustment,
  createBulkAdjustment,
  listAdjustments,
  getAdjustment,
  approveAdjustment,
  rejectAdjustment,
  approveAdjustmentGroup,
  rejectAdjustmentGroup,
  createStockCount,
  getThresholds,
  MOVEMENT_TYPES
};

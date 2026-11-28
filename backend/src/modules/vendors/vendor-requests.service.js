const { withTransaction } = require('../../database/connection');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { notifyLocalGovernmentMembers, notifyVendorUsers } = require('../../shared/utils/notifications');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const repository = require('./vendor-requests.repository');

const REQUEST_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  ACCEPTED: 'accepted',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled'
};

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const requireLocalGovernmentScope = (scope) => {
  if (!scope || scope.scopeType !== 'local_government' || !scope.localGovernmentId) {
    throw new ForbiddenError('This screen is only available to local government accounts', 'LOCAL_GOVERNMENT_ONLY');
  }
  return { localGovernmentId: scope.localGovernmentId, stateId: scope.stateId };
};

const requireVendorScope = (scope) => {
  if (!scope || scope.scopeType !== 'vendor' || !scope.vendorId) {
    throw new ForbiddenError('This screen is only available to vendor accounts', 'VENDOR_ONLY');
  }
  return scope.vendorId;
};

const mapRequest = (row) => ({
  id: row.id,
  reference: row.reference,
  status: row.status,
  vendorId: row.vendor_id,
  vendorName: row.vendor_name,
  vendorCode: row.vendor_code,
  vendorStatus: row.vendor_status,
  consolidationId: row.consolidation_id,
  consolidationReference: row.consolidation_reference,
  notes: row.notes,
  itemCount: Number(row.item_count),
  requestedQuantity: Number(row.requested_quantity),
  confirmedQuantity: Number(row.confirmed_quantity),
  requestedValue: Number(row.requested_value),
  confirmedValue: Number(row.confirmed_value),
  createdByName: row.created_by_name,
  createdAt: row.created_at,
  sentByName: row.sent_by_name,
  sentAt: row.sent_at,
  acceptedByName: row.accepted_by_name,
  acceptedAt: row.accepted_at,
  respondedByName: row.responded_by_name,
  respondedAt: row.responded_at,
  vendorNote: row.vendor_note,
  declinedReason: row.declined_reason,
  cancelledByName: row.cancelled_by_name,
  cancelledAt: row.cancelled_at,
  cancelReason: row.cancel_reason
});

const mapItem = (row) => {
  const confirmed = row.confirmed_quantity === null ? null : Number(row.confirmed_quantity);
  const price = row.unit_price === null ? null : Number(row.unit_price);
  return {
    id: row.id,
    stateDrugId: row.state_drug_id,
    drugName: row.drug_name,
    strength: row.strength,
    dosageForm: row.dosage_form,
    unitOfMeasure: row.unit_of_measure,
    requestedQuantity: Number(row.requested_quantity),
    confirmedQuantity: confirmed,
    unitPrice: price,
    requestedValue:
      price === null ? null : round2(Number(row.requested_quantity) * price),
    lineValue: confirmed !== null && price !== null ? round2(confirmed * price) : null
  };
};

const mapEvent = (row) => ({
  action: row.action,
  fromStatus: row.from_status,
  toStatus: row.to_status,
  notes: row.notes,
  actorType: row.actor_type,
  actorName: row.actor_name,
  createdAt: row.created_at
});

const listRequests = async ({ scope, filters }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listRequests({
    localGovernmentId,
    status: filters.status && filters.status !== 'all' ? filters.status : null,
    vendorId: filters.vendorId || null,
    limit,
    offset
  });
  return {
    items: rows.map(mapRequest),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getRequest = async ({ scope, requestId }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const row = await repository.findRequest(localGovernmentId, requestId);
  if (!row) {
    throw new NotFoundError('That request was not found');
  }
  const [items, events] = await Promise.all([
    repository.listRequestItems(requestId),
    repository.listRequestEvents(requestId)
  ]);
  return {
    ...mapRequest(row),
    items: items.map(mapItem),
    events: events.map(mapEvent)
  };
};

const listCandidates = async ({ scope }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const rows = await repository.listConsolidationCandidates(localGovernmentId);
  return rows.map((row) => ({
    consolidationId: row.id,
    reference: row.reference,
    itemCount: Number(row.item_count),
    totalQuantity: Number(row.total_quantity),
    gapQuantity: Number(row.gap_quantity),
    finalizedByName: row.finalized_by_name,
    finalizedAt: row.finalized_at
  }));
};

const buildItems = async ({ localGovernmentId, consolidationId, vendorId, mode }) => {
  const consolidation = await repository.findConsolidationForRequest(localGovernmentId, consolidationId);
  if (!consolidation) {
    throw new NotFoundError('That consolidation was not found');
  }
  if (consolidation.status !== 'finalized') {
    throw new ConflictError('Only a finalized consolidation can be sent to a vendor', 'CONSOLIDATION_NOT_FINALIZED');
  }

  const rows = await repository.consolidationRequestItems(consolidationId);
  const selected = rows
    .map((row) => ({
      row,
      quantity: round2(mode === 'full' ? row.requested_quantity : row.gap_quantity)
    }))
    .filter((entry) => entry.quantity > 0);

  if (selected.length === 0) {
    throw new ValidationError('This consolidation has nothing to send to a vendor', [
      {
        field: 'mode',
        message:
          mode === 'full'
            ? 'The consolidation has no requested quantity'
            : 'The warehouse covers this demand, so there is no gap to order'
      }
    ]);
  }

  const unmapped = selected.filter((entry) => !entry.row.state_drug_id);
  if (unmapped.length > 0) {
    throw new ConflictError(
      `These drugs are not on the state catalogue yet: ${unmapped
        .map((entry) => entry.row.drug_name)
        .join(', ')}`,
      'DRUG_NOT_MAPPED'
    );
  }

  const prices = await repository.vendorPrices(
    vendorId,
    selected.map((entry) => entry.row.state_drug_id)
  );
  const priceByDrug = new Map(prices.map((row) => [row.state_drug_id, Number(row.unit_price)]));

  return {
    consolidation,
    items: selected.map((entry) => ({
      stateDrugId: entry.row.state_drug_id,
      drugName: entry.row.drug_name,
      strength: entry.row.strength,
      dosageForm: entry.row.dosage_form,
      unitOfMeasure: entry.row.unit_of_measure,
      requestedQuantity: entry.quantity,
      unitPrice: priceByDrug.has(entry.row.state_drug_id) ? priceByDrug.get(entry.row.state_drug_id) : null
    }))
  };
};

const createRequest = async ({ scope, actor, payload }) => {
  const { localGovernmentId, stateId } = requireLocalGovernmentScope(scope);
  const { consolidation, items } = await buildItems({
    localGovernmentId,
    consolidationId: payload.consolidationId,
    vendorId: payload.vendorId,
    mode: payload.mode
  });

  const requestedQuantity = round2(items.reduce((total, item) => total + item.requestedQuantity, 0));

  const created = await withTransaction(async (client) => {
    const request = await repository.insertRequest(client, {
      stateId,
      localGovernmentId,
      vendorId: payload.vendorId,
      consolidationId: consolidation.id,
      consolidationReference: consolidation.reference,
      notes: payload.notes || null,
      itemCount: items.length,
      requestedQuantity,
      actorId: actor.id,
      actorName: actor.fullName
    });

    for (const item of items) {
      await repository.insertRequestItem(client, { requestId: request.id, ...item });
    }

    await repository.updateRequestPricing(client, {
      requestId: request.id,
      requestedValue: round2(
        items.reduce(
          (total, item) =>
            total + (item.unitPrice === null ? 0 : item.requestedQuantity * item.unitPrice),
          0
        )
      )
    });

    await repository.insertEvent(client, {
      requestId: request.id,
      action: 'request.created',
      toStatus: REQUEST_STATUS.DRAFT,
      notes: payload.notes || null,
      actorType: 'local_government',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      localGovernmentId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'vendor_request.created',
      entityType: 'vendor_request',
      entityId: request.id,
      summary: `Prepared vendor request ${request.reference} for ${items.length} drug(s)`,
      newValues: {
        vendorId: payload.vendorId,
        consolidation: consolidation.reference,
        mode: payload.mode,
        requestedQuantity
      }
    });

    return request;
  });

  return getRequest({ scope, requestId: created.id });
};

const sendRequest = async ({ scope, actor, requestId }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const existing = await repository.findRequest(localGovernmentId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (existing.status !== REQUEST_STATUS.DRAFT) {
    throw new ConflictError('Only a draft request can be sent', 'REQUEST_NOT_DRAFT');
  }
  if (existing.vendor_status !== 'registered') {
    throw new ConflictError(
      `This vendor is ${existing.vendor_status}, so it cannot take new requests`,
      'VENDOR_NOT_REGISTERED'
    );
  }

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.status !== REQUEST_STATUS.DRAFT) {
      throw new ConflictError('This request was already sent', 'REQUEST_NOT_DRAFT');
    }

    const items = await repository.listRequestItemsForUpdate(client, requestId);
    const prices = await repository.vendorPrices(
      existing.vendor_id,
      [...new Set(items.map((item) => item.state_drug_id))]
    );
    const priceByDrug = new Map(
      prices.map((row) => [row.state_drug_id, Number(row.unit_price)])
    );
    const unpriced = [];
    let requestedValue = 0;

    for (const item of items) {
      const price = priceByDrug.has(item.state_drug_id)
        ? priceByDrug.get(item.state_drug_id)
        : null;
      if (price === null || price <= 0) {
        if (Number(item.requested_quantity) > 0) {
          unpriced.push(item.drug_name);
        }
        continue;
      }
      if (item.unit_price === null || Number(item.unit_price) !== price) {
        await repository.updateItemPrice(client, { itemId: item.id, unitPrice: price });
      }
      requestedValue = round2(requestedValue + Number(item.requested_quantity) * price);
    }

    if (unpriced.length > 0) {
      throw new ValidationError(
        `${existing.vendor_name} has not priced ${unpriced.join(', ')}. Ask the vendor to add a price to their stock, or remove those lines from this request.`,
        [{ field: 'items', message: 'Every line needs the vendor price before the request is sent' }]
      );
    }

    await repository.updateRequestPricing(client, { requestId, requestedValue });

    await repository.setRequestStatus(client, {
      requestId,
      status: REQUEST_STATUS.SENT,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.sent',
      fromStatus: REQUEST_STATUS.DRAFT,
      toStatus: REQUEST_STATUS.SENT,
      actorType: 'local_government',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      localGovernmentId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'vendor_request.sent',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Sent vendor request ${existing.reference} to ${existing.vendor_name}`,
      newValues: { status: REQUEST_STATUS.SENT }
    });

    await notifyVendorUsers(client, {
      vendorId: existing.vendor_id,
      excludeUserId: actor.id,
      type: 'vendor_request_sent',
      title: 'New supply request',
      message: `${existing.reference} asks for ${Number(existing.item_count)} drug(s). Accept it to quote quantities and prices.`,
      entityType: 'vendor_request',
      entityId: requestId
    });
  });

  return getRequest({ scope, requestId });
};

const cancelRequest = async ({ scope, actor, requestId, reason }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const existing = await repository.findRequest(localGovernmentId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (![REQUEST_STATUS.DRAFT, REQUEST_STATUS.SENT, REQUEST_STATUS.ACCEPTED].includes(existing.status)) {
    throw new ConflictError('This request can no longer be cancelled', 'REQUEST_STATUS_INVALID');
  }

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked) {
      throw new NotFoundError('That request was not found');
    }

    await repository.setRequestStatus(client, {
      requestId,
      status: REQUEST_STATUS.CANCELLED,
      actorId: actor.id,
      actorName: actor.fullName,
      notes: reason
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.cancelled',
      fromStatus: locked.status,
      toStatus: REQUEST_STATUS.CANCELLED,
      notes: reason,
      actorType: 'local_government',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      localGovernmentId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'vendor_request.cancelled',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Cancelled vendor request ${existing.reference}`,
      previousValues: { status: locked.status },
      newValues: { status: REQUEST_STATUS.CANCELLED },
      reason
    });

    if (locked.status === REQUEST_STATUS.SENT || locked.status === REQUEST_STATUS.ACCEPTED) {
      await notifyVendorUsers(client, {
        vendorId: existing.vendor_id,
        excludeUserId: actor.id,
        type: 'vendor_request_cancelled',
        title: 'Supply request withdrawn',
        message: `${existing.reference} was withdrawn: ${reason}`,
        entityType: 'vendor_request',
        entityId: requestId
      });
    }
  });

  return getRequest({ scope, requestId });
};

const removeRequestItem = async ({ scope, actor, requestId, itemId }) => {
  const { localGovernmentId } = requireLocalGovernmentScope(scope);
  const existing = await repository.findRequest(localGovernmentId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (existing.status !== REQUEST_STATUS.DRAFT) {
    throw new ConflictError('Only a draft request can be changed', 'REQUEST_NOT_DRAFT');
  }

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.status !== REQUEST_STATUS.DRAFT) {
      throw new ConflictError('This request can no longer be changed', 'REQUEST_NOT_DRAFT');
    }

    const items = await repository.listRequestItemsForUpdate(client, requestId);
    const target = items.find((item) => item.id === itemId);
    if (!target) {
      throw new NotFoundError('That line is not on this request');
    }
    if (items.length === 1) {
      throw new ValidationError('A request needs at least one line. Cancel it instead.', [
        { field: 'items', message: 'This is the last line on the request' }
      ]);
    }

    await repository.deleteRequestItem(client, itemId);

    const remaining = items.filter((item) => item.id !== itemId);
    await repository.updateRequestDemand(client, {
      requestId,
      itemCount: remaining.length,
      requestedQuantity: round2(
        remaining.reduce((total, item) => total + Number(item.requested_quantity), 0)
      )
    });
    await repository.updateRequestPricing(client, {
      requestId,
      requestedValue: round2(
        remaining.reduce(
          (total, item) =>
            total +
            (item.unit_price === null
              ? 0
              : Number(item.requested_quantity) * Number(item.unit_price)),
          0
        )
      )
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.line_removed',
      fromStatus: REQUEST_STATUS.DRAFT,
      toStatus: REQUEST_STATUS.DRAFT,
      notes: target.drug_name,
      actorType: 'local_government',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      localGovernmentId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'vendor_request.line_removed',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Removed ${target.drug_name} from vendor request ${existing.reference}`,
      previousValues: {
        drugName: target.drug_name,
        requestedQuantity: Number(target.requested_quantity)
      }
    });
  });

  return getRequest({ scope, requestId });
};

const listPortalRequests = async ({ scope, filters }) => {
  const vendorId = requireVendorScope(scope);
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listVendorRequests({
    vendorId,
    status: filters.status && filters.status !== 'all' ? filters.status : null,
    limit,
    offset
  });
  return {
    items: rows.map(mapRequest),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getPortalRequest = async ({ scope, requestId }) => {
  const vendorId = requireVendorScope(scope);
  const row = await repository.findVendorRequest(vendorId, requestId);
  if (!row) {
    throw new NotFoundError('That request was not found');
  }
  const [items, events] = await Promise.all([
    repository.listRequestItems(requestId),
    repository.listRequestEvents(requestId)
  ]);
  return {
    ...mapRequest(row),
    items: items.map(mapItem),
    events: events.map(mapEvent)
  };
};

const acceptPortalRequest = async ({ scope, actor, requestId }) => {
  const vendorId = requireVendorScope(scope);
  const existing = await repository.findVendorRequest(vendorId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (existing.status !== REQUEST_STATUS.SENT) {
    throw new ConflictError(
      existing.status === REQUEST_STATUS.ACCEPTED
        ? 'You have already accepted this request'
        : 'Only a newly sent request can be accepted',
      'REQUEST_STATUS_INVALID'
    );
  }

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || locked.status !== REQUEST_STATUS.SENT) {
      throw new ConflictError('This request has already been answered', 'REQUEST_STATUS_INVALID');
    }

    await repository.setRequestStatus(client, {
      requestId,
      status: REQUEST_STATUS.ACCEPTED,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.accepted',
      fromStatus: REQUEST_STATUS.SENT,
      toStatus: REQUEST_STATUS.ACCEPTED,
      actorType: 'vendor',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor_request.accepted',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Accepted vendor request ${existing.reference}`,
      newValues: { status: REQUEST_STATUS.ACCEPTED }
    });
  });

  return getPortalRequest({ scope, requestId });
};

const respondPortalRequest = async ({ scope, actor, requestId, payload }) => {
  const vendorId = requireVendorScope(scope);
  const existing = await repository.findVendorRequest(vendorId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (![REQUEST_STATUS.SENT, REQUEST_STATUS.ACCEPTED].includes(existing.status)) {
    throw new ConflictError('This request has already been answered', 'REQUEST_STATUS_INVALID');
  }

  const submitted = new Map(
    (payload.items || []).map((item) => [item.itemId, item])
  );

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || ![REQUEST_STATUS.SENT, REQUEST_STATUS.ACCEPTED].includes(locked.status)) {
      throw new ConflictError('This request has already been answered', 'REQUEST_STATUS_INVALID');
    }

    const rows = await repository.listRequestItems(requestId);
    let confirmedQuantity = 0;
    let confirmedValue = 0;
    let confirmedLines = 0;

    for (const row of rows) {
      const update = submitted.get(row.id);
      const quantity = round2(
        update ? update.quantityConfirmed : Number(row.requested_quantity)
      );
      const price = round2(
        update
          ? update.unitPrice
          : row.unit_price === null
            ? 0
            : Number(row.unit_price)
      );

      if (quantity < 0) {
        throw new ValidationError('Confirmed quantity cannot be negative', [
          { field: 'items', message: `${row.drug_name} has a negative quantity` }
        ]);
      }
      if (quantity > 0 && price <= 0) {
        throw new ValidationError('Every line you can supply needs a unit price', [
          { field: 'items', message: `Enter a price for ${row.drug_name}` }
        ]);
      }
      if (quantity > Number(row.requested_quantity)) {
        throw new ValidationError('You cannot confirm more than was requested', [
          {
            field: 'items',
            message: `${row.drug_name} was requested at ${Number(row.requested_quantity)}`
          }
        ]);
      }

      await repository.updateRequestItem(client, {
        itemId: row.id,
        confirmedQuantity: quantity,
        unitPrice: quantity > 0 ? price : null
      });

      if (quantity > 0) {
        confirmedLines += 1;
        confirmedQuantity = round2(confirmedQuantity + quantity);
        confirmedValue = round2(confirmedValue + quantity * price);
      }
    }

    if (confirmedLines === 0) {
      throw new ValidationError('Confirm at least one line, or decline the request', [
        { field: 'items', message: 'Enter a quantity for at least one drug' }
      ]);
    }

    await repository.updateRequestTotals(client, {
      requestId,
      confirmedQuantity,
      confirmedValue
    });

    await repository.setRequestStatus(client, {
      requestId,
      status: REQUEST_STATUS.CONFIRMED,
      actorId: actor.id,
      actorName: actor.fullName,
      notes: payload.note || null
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.confirmed',
      fromStatus: locked.status,
      toStatus: REQUEST_STATUS.CONFIRMED,
      notes: payload.note || null,
      actorType: 'vendor',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor_request.confirmed',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Confirmed vendor request ${existing.reference}`,
      newValues: { confirmedQuantity, confirmedValue }
    });

    await notifyLocalGovernmentMembers(client, {
      localGovernmentId: existing.local_government_id,
      permissionCode: 'vendor_requests.view',
      excludeUserId: actor.id,
      type: 'vendor_request_confirmed',
      title: 'Vendor confirmed a request',
      message: `${existing.reference} from ${existing.vendor_name} is confirmed at ${confirmedLines} line(s).`,
      entityType: 'vendor_request',
      entityId: requestId
    });
  });

  return getPortalRequest({ scope, requestId });
};

const declinePortalRequest = async ({ scope, actor, requestId, reason }) => {
  const vendorId = requireVendorScope(scope);
  const existing = await repository.findVendorRequest(vendorId, requestId);
  if (!existing) {
    throw new NotFoundError('That request was not found');
  }
  if (![REQUEST_STATUS.SENT, REQUEST_STATUS.ACCEPTED].includes(existing.status)) {
    throw new ConflictError('This request has already been answered', 'REQUEST_STATUS_INVALID');
  }

  await withTransaction(async (client) => {
    const locked = await repository.lockRequest(client, requestId);
    if (!locked || ![REQUEST_STATUS.SENT, REQUEST_STATUS.ACCEPTED].includes(locked.status)) {
      throw new ConflictError('This request has already been answered', 'REQUEST_STATUS_INVALID');
    }

    await repository.setRequestStatus(client, {
      requestId,
      status: REQUEST_STATUS.DECLINED,
      actorId: actor.id,
      actorName: actor.fullName,
      notes: reason
    });

    await repository.insertEvent(client, {
      requestId,
      action: 'request.declined',
      fromStatus: locked.status,
      toStatus: REQUEST_STATUS.DECLINED,
      notes: reason,
      actorType: 'vendor',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor_request.declined',
      entityType: 'vendor_request',
      entityId: requestId,
      summary: `Declined vendor request ${existing.reference}`,
      previousValues: { status: locked.status },
      newValues: { status: REQUEST_STATUS.DECLINED },
      reason
    });

    await notifyLocalGovernmentMembers(client, {
      localGovernmentId: existing.local_government_id,
      permissionCode: 'vendor_requests.view',
      excludeUserId: actor.id,
      type: 'vendor_request_declined',
      title: 'Vendor declined a request',
      message: `${existing.reference} was declined: ${reason}`,
      entityType: 'vendor_request',
      entityId: requestId
    });
  });

  return getPortalRequest({ scope, requestId });
};

module.exports = {
  REQUEST_STATUS,
  listRequests,
  getRequest,
  listCandidates,
  createRequest,
  sendRequest,
  cancelRequest,
  removeRequestItem,
  listPortalRequests,
  getPortalRequest,
  acceptPortalRequest,
  respondPortalRequest,
  declinePortalRequest
};

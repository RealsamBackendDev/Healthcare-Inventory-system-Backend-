const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { withTransaction } = require('../../database/connection');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { notifyVendorUsers } = require('../../shared/utils/notifications');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { PERMISSIONS } = require('../../shared/constants');
const repository = require('./vendors.repository');

const VENDOR_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending_screening',
  SCREENED: 'screened',
  REGISTERED: 'registered',
  SUSPENDED: 'suspended',
  EXCLUDED: 'excluded'
};

const requireState = (scope) => {
  if (!scope || !scope.stateId) {
    throw new ForbiddenError('This screen needs a state-scoped account', 'STATE_SCOPE_REQUIRED');
  }
  return scope.stateId;
};

const canManage = (scope) => Boolean(scope && scope.permissions && scope.permissions.has(PERMISSIONS.VENDORS_MANAGE));

const mapVendor = (row) => ({
  id: row.id,
  vendorCode: row.vendor_code,
  legalName: row.legal_name,
  tradingName: row.trading_name,
  contactName: row.contact_name,
  contactPhone: row.contact_phone,
  contactEmail: row.contact_email,
  address: row.address,
  tin: row.tin,
  registrationNumber: row.registration_number,
  bankName: row.bank_name,
  bankAccountName: row.bank_account_name,
  bankAccountNumber: row.bank_account_number,
  status: row.status,
  statusReason: row.status_reason,
  screeningNotes: row.screening_notes,
  screenedByName: row.screened_by_name,
  screenedAt: row.screened_at,
  registeredByName: row.registered_by_name,
  registeredAt: row.registered_at,
  createdByName: row.created_by_name,
  stockCount: row.stock_count === undefined ? undefined : Number(row.stock_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const expiryStatusOf = (expiryDate) => {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((expiry.getTime() - today.getTime()) / 86400000);
  if (days < 0) {
    return { state: 'expired', daysToExpiry: days };
  }
  if (days <= 90) {
    return { state: 'near_expiry', daysToExpiry: days };
  }
  return { state: 'ok', daysToExpiry: days };
};

const mapStock = (row) => {
  const expiry = expiryStatusOf(row.expiry_date);
  return {
    id: row.id,
    drugId: row.state_drug_id,
    drugCode: row.drug_code,
    drugName: row.drug_name,
    strength: row.strength,
    dosageForm: row.dosage_form,
    unitOfMeasure: row.unit_of_measure,
    drugIsActive: row.drug_is_active,
    vendorSku: row.vendor_sku,
    batchNumber: row.batch_number,
    expiryDate: row.expiry_date,
    quantityAvailable: Number(row.quantity_available),
    unitPrice: Number(row.unit_price),
    isActive: row.is_active,
    expiryState: expiry.state,
    daysToExpiry: expiry.daysToExpiry,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const normaliseOptional = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const normaliseIdentity = (value) => (value ? value.trim().toLowerCase() : null);

const assertVendor = (vendor) => {
  if (!vendor) {
    throw new NotFoundError('Vendor was not found');
  }
};

const listVendors = async ({ scope, filters }) => {
  const stateId = requireState(scope);
  const { page, pageSize, offset, limit } = getPagination(filters);
  const manage = canManage(scope);
  const requestedStatus = filters.status && filters.status !== 'all' ? filters.status : null;
  const status = manage ? requestedStatus : VENDOR_STATUS.REGISTERED;

  const { rows, total } = await repository.listVendors({
    stateId,
    search: filters.search || null,
    status,
    limit,
    offset
  });

  return {
    items: rows.map(mapVendor),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getVendor = async ({ scope, vendorId }) => {
  const stateId = requireState(scope);
  const vendor = await repository.findVendor(stateId, vendorId);
  assertVendor(vendor);

  if (!canManage(scope) && vendor.status !== VENDOR_STATUS.REGISTERED) {
    throw new NotFoundError('Vendor was not found');
  }

  const [history, stock, accounts] = await Promise.all([
    repository.listStatusHistory(vendorId),
    repository.listStock(vendorId, { activeOnly: true }),
    canManage(scope) ? repository.listVendorUsers(vendorId) : Promise.resolve([])
  ]);

  return {
    vendor: mapVendor(vendor),
    history: history.map((row) => ({
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      actorName: row.actor_full_name,
      createdAt: row.created_at
    })),
    stock: stock.map(mapStock),
    accounts: accounts.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      isPrimary: row.is_primary,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at
    }))
  };
};

const createVendor = async ({ scope, actor, payload }) => {
  const stateId = requireState(scope);

  const duplicateName = await repository.findVendorByName(stateId, payload.legalName);
  if (duplicateName) {
    throw new ConflictError('A vendor with this name already exists', 'DUPLICATE_VENDOR');
  }
  if (payload.tin) {
    const duplicateTin = await repository.findVendorByTin(stateId, payload.tin);
    if (duplicateTin) {
      throw new ConflictError(
        `The TIN ${payload.tin} is already used by ${duplicateTin.legal_name}`,
        'DUPLICATE_VENDOR_TIN'
      );
    }
  }

  const existingUser = await repository.findUserByEmail(payload.loginEmail);
  if (existingUser) {
    throw new ConflictError('That email address already belongs to an account', 'EMAIL_IN_USE');
  }

  const passwordHash = await bcrypt.hash(payload.loginPassword, environment.security.bcryptRounds);

  const createdId = await withTransaction(async (client) => {
    const vendor = await repository.insertVendor(client, {
      stateId,
      legalName: payload.legalName,
      tradingName: normaliseOptional(payload.tradingName),
      contactName: normaliseOptional(payload.contactName),
      contactPhone: normaliseOptional(payload.contactPhone),
      contactEmail: normaliseOptional(payload.contactEmail),
      address: normaliseOptional(payload.address),
      tin: normaliseOptional(payload.tin),
      registrationNumber: normaliseOptional(payload.registrationNumber),
      bankName: normaliseOptional(payload.bankName),
      bankAccountName: normaliseOptional(payload.bankAccountName),
      bankAccountNumber: normaliseOptional(payload.bankAccountNumber),
      status: VENDOR_STATUS.DRAFT,
      actorId: actor.id,
      actorName: actor.fullName
    });

    const user = await repository.insertVendorUser(client, {
      email: payload.loginEmail.toLowerCase(),
      fullName: payload.loginFullName || payload.contactName || payload.legalName,
      passwordHash
    });

    await repository.linkVendorUser(client, {
      vendorId: vendor.id,
      userId: user.id,
      isPrimary: true
    });

    await repository.insertStatusHistory(client, {
      vendorId: vendor.id,
      stateId,
      fromStatus: null,
      toStatus: VENDOR_STATUS.DRAFT,
      reason: 'Vendor registered on the system',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId: vendor.id,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'vendor.created',
      entityType: 'vendor',
      entityId: vendor.id,
      summary: `Registered vendor ${payload.legalName} and created its login`,
      newValues: { legalName: payload.legalName, loginEmail: payload.loginEmail }
    });

    return vendor.id;
  });

  const vendor = await repository.findVendorById(createdId);
  return mapVendor(vendor);
};

const updateVendor = async ({ scope, actor, vendorId, payload }) => {
  const stateId = requireState(scope);
  const existing = await repository.findVendor(stateId, vendorId);
  assertVendor(existing);

  if (existing.status === VENDOR_STATUS.EXCLUDED) {
    throw new ConflictError(
      'This vendor is excluded. Reopen it for screening before editing the profile',
      'VENDOR_EXCLUDED'
    );
  }

  const nextLegalName = payload.legalName === undefined ? existing.legal_name : payload.legalName;
  if (normaliseIdentity(nextLegalName) !== normaliseIdentity(existing.legal_name)) {
    const duplicateName = await repository.findVendorByName(stateId, nextLegalName, existing.id);
    if (duplicateName) {
      throw new ConflictError('A vendor with this name already exists', 'DUPLICATE_VENDOR');
    }
  }

  const nextTin = payload.tin === undefined ? existing.tin : normaliseOptional(payload.tin);
  if (nextTin && normaliseIdentity(nextTin) !== normaliseIdentity(existing.tin)) {
    const duplicateTin = await repository.findVendorByTin(stateId, nextTin, existing.id);
    if (duplicateTin) {
      throw new ConflictError(
        `The TIN ${nextTin} is already used by ${duplicateTin.legal_name}`,
        'DUPLICATE_VENDOR_TIN'
      );
    }
  }

  const identityChanged =
    normaliseIdentity(nextLegalName) !== normaliseIdentity(existing.legal_name) ||
    normaliseIdentity(nextTin) !== normaliseIdentity(existing.tin) ||
    normaliseIdentity(
      payload.registrationNumber === undefined ? existing.registration_number : payload.registrationNumber
    ) !== normaliseIdentity(existing.registration_number);

  const needsScreeningAgain =
    identityChanged &&
    [VENDOR_STATUS.SCREENED, VENDOR_STATUS.REGISTERED, VENDOR_STATUS.SUSPENDED].includes(existing.status);
  const nextStatus = needsScreeningAgain ? VENDOR_STATUS.DRAFT : existing.status;

  const merged = {
    legalName: nextLegalName,
    tradingName:
      payload.tradingName === undefined ? existing.trading_name : normaliseOptional(payload.tradingName),
    contactName:
      payload.contactName === undefined ? existing.contact_name : normaliseOptional(payload.contactName),
    contactPhone:
      payload.contactPhone === undefined ? existing.contact_phone : normaliseOptional(payload.contactPhone),
    contactEmail:
      payload.contactEmail === undefined ? existing.contact_email : normaliseOptional(payload.contactEmail),
    address: payload.address === undefined ? existing.address : normaliseOptional(payload.address),
    tin: nextTin,
    registrationNumber:
      payload.registrationNumber === undefined
        ? existing.registration_number
        : normaliseOptional(payload.registrationNumber),
    bankName: payload.bankName === undefined ? existing.bank_name : normaliseOptional(payload.bankName),
    bankAccountName:
      payload.bankAccountName === undefined
        ? existing.bank_account_name
        : normaliseOptional(payload.bankAccountName),
    bankAccountNumber:
      payload.bankAccountNumber === undefined
        ? existing.bank_account_number
        : normaliseOptional(payload.bankAccountNumber),
    status: nextStatus,
    statusReason: needsScreeningAgain
      ? 'Identity details changed, screening required again'
      : existing.status_reason
  };

  await withTransaction(async (client) => {
    await repository.updateVendor(client, { vendorId, values: merged });

    if (needsScreeningAgain) {
      await repository.insertStatusHistory(client, {
        vendorId,
        stateId,
        fromStatus: existing.status,
        toStatus: VENDOR_STATUS.DRAFT,
        reason: merged.statusReason,
        actorId: actor.id,
        actorName: actor.fullName
      });
    }

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: needsScreeningAgain ? 'vendor.screening_required' : 'vendor.updated',
      entityType: 'vendor',
      entityId: vendorId,
      summary: needsScreeningAgain
        ? `Updated vendor ${merged.legalName} and returned it for screening`
        : `Updated vendor ${merged.legalName}`,
      previousValues: mapVendor(existing),
      newValues: { ...merged }
    });
  });

  const vendor = await repository.findVendor(stateId, vendorId);
  return mapVendor(vendor);
};

const screenVendor = async ({ scope, actor, vendorId, payload }) => {
  const stateId = requireState(scope);
  const existing = await repository.findVendor(stateId, vendorId);
  assertVendor(existing);

  if (existing.status !== VENDOR_STATUS.PENDING) {
    throw new ConflictError('Only a vendor waiting for screening can be screened', 'VENDOR_STATUS_INVALID');
  }

  const approved = payload.decision === 'approve';
  const nextStatus = approved ? VENDOR_STATUS.SCREENED : VENDOR_STATUS.DRAFT;

  await withTransaction(async (client) => {
    await repository.setVendorStatus(client, {
      vendorId,
      status: nextStatus,
      statusReason: approved ? null : payload.notes || 'Screening rejected',
      screeningNotes: payload.notes === undefined ? null : payload.notes,
      screenedBy: approved ? actor.id : null,
      screenedByName: approved ? actor.fullName : null
    });

    await repository.insertStatusHistory(client, {
      vendorId,
      stateId,
      fromStatus: existing.status,
      toStatus: nextStatus,
      reason: payload.notes || (approved ? 'Screened and confirmed' : 'Screening rejected'),
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: approved ? 'vendor.screened' : 'vendor.screening_rejected',
      entityType: 'vendor',
      entityId: vendorId,
      summary: `${approved ? 'Screened' : 'Returned'} vendor ${existing.legal_name}`,
      previousValues: { status: existing.status },
      newValues: { status: nextStatus, notes: payload.notes || null }
    });

    await notifyVendorUsers(client, {
      vendorId,
      excludeUserId: actor.id,
      type: approved ? 'vendor_screened' : 'vendor_screening_rejected',
      title: approved ? 'Screening confirmed' : 'Screening returned your profile',
      message: approved
        ? 'Your vendor profile passed screening and is waiting for registration.'
        : `Your vendor profile was returned: ${payload.notes || 'details need attention'}`,
      entityType: 'vendor',
      entityId: vendorId
    });
  });

  const vendor = await repository.findVendor(stateId, vendorId);
  return mapVendor(vendor);
};

const registerVendor = async ({ scope, actor, vendorId, payload }) => {
  const stateId = requireState(scope);
  const existing = await repository.findVendor(stateId, vendorId);
  assertVendor(existing);

  if (existing.status !== VENDOR_STATUS.SCREENED) {
    throw new ConflictError('Only a screened vendor can be registered', 'VENDOR_STATUS_INVALID');
  }

  const accepted = payload.decision === 'register';
  const nextStatus = accepted ? VENDOR_STATUS.REGISTERED : VENDOR_STATUS.DRAFT;

  await withTransaction(async (client) => {
    await repository.setVendorStatus(client, {
      vendorId,
      status: nextStatus,
      statusReason: accepted ? null : payload.notes || 'Registration declined',
      registeredBy: accepted ? actor.id : null,
      registeredByName: accepted ? actor.fullName : null
    });

    await repository.insertStatusHistory(client, {
      vendorId,
      stateId,
      fromStatus: existing.status,
      toStatus: nextStatus,
      reason: payload.notes || (accepted ? 'Registered for procurement' : 'Registration declined'),
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: accepted ? 'vendor.registered' : 'vendor.registration_declined',
      entityType: 'vendor',
      entityId: vendorId,
      summary: `${accepted ? 'Registered' : 'Declined'} vendor ${existing.legal_name}`,
      previousValues: { status: existing.status },
      newValues: { status: nextStatus, notes: payload.notes || null }
    });

    await notifyVendorUsers(client, {
      vendorId,
      excludeUserId: actor.id,
      type: accepted ? 'vendor_registered' : 'vendor_registration_declined',
      title: accepted ? 'You are registered' : 'Registration was declined',
      message: accepted
        ? 'Local governments can now see and request your stock.'
        : `Registration was declined: ${payload.notes || 'contact the state team'}`,
      entityType: 'vendor',
      entityId: vendorId
    });
  });

  const vendor = await repository.findVendor(stateId, vendorId);
  return mapVendor(vendor);
};

const changeVendorStatus = async ({ scope, actor, vendorId, payload }) => {
  const stateId = requireState(scope);
  const existing = await repository.findVendor(stateId, vendorId);
  assertVendor(existing);

  const transitions = {
    suspend: {
      from: [VENDOR_STATUS.REGISTERED],
      to: VENDOR_STATUS.SUSPENDED,
      action: 'vendor.suspended',
      label: 'Suspended',
      reasonRequired: true
    },
    reinstate: {
      from: [VENDOR_STATUS.SUSPENDED],
      to: VENDOR_STATUS.REGISTERED,
      action: 'vendor.reinstated',
      label: 'Reinstated',
      reasonRequired: false
    },
    exclude: {
      from: [VENDOR_STATUS.REGISTERED, VENDOR_STATUS.SUSPENDED],
      to: VENDOR_STATUS.EXCLUDED,
      action: 'vendor.excluded',
      label: 'Excluded',
      reasonRequired: true
    },
    reopen: {
      from: [VENDOR_STATUS.EXCLUDED],
      to: VENDOR_STATUS.PENDING,
      action: 'vendor.reopened',
      label: 'Reopened for screening',
      reasonRequired: true
    }
  };

  const transition = transitions[payload.action];
  if (!transition) {
    throw new ValidationError('Unknown status change', [
      { field: 'action', message: 'Pick suspend, reinstate, exclude or reopen' }
    ]);
  }
  if (!transition.from.includes(existing.status)) {
    throw new ConflictError(`A ${existing.status} vendor cannot be changed this way`, 'VENDOR_STATUS_INVALID');
  }
  if (transition.reasonRequired && !payload.reason) {
    throw new ValidationError('A reason is required for this change', [
      { field: 'reason', message: 'Explain why this vendor is being changed' }
    ]);
  }

  await withTransaction(async (client) => {
    await repository.setVendorStatus(client, {
      vendorId,
      status: transition.to,
      statusReason: payload.reason || null
    });

    await repository.insertStatusHistory(client, {
      vendorId,
      stateId,
      fromStatus: existing.status,
      toStatus: transition.to,
      reason: payload.reason || null,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: transition.action,
      entityType: 'vendor',
      entityId: vendorId,
      summary: `${transition.label} vendor ${existing.legal_name}`,
      previousValues: { status: existing.status },
      newValues: { status: transition.to },
      reason: payload.reason || null
    });

    await notifyVendorUsers(client, {
      vendorId,
      excludeUserId: actor.id,
      type: `vendor_${transition.to}`,
      title: `${transition.label} by the state team`,
      message: payload.reason || `Your vendor account is now ${transition.to}.`,
      entityType: 'vendor',
      entityId: vendorId
    });
  });

  const vendor = await repository.findVendor(stateId, vendorId);
  return mapVendor(vendor);
};

const requireVendorScope = (scope) => {
  if (!scope || scope.scopeType !== 'vendor' || !scope.vendorId) {
    throw new ForbiddenError('This screen is only available to vendor accounts', 'VENDOR_ONLY');
  }
  return scope.vendorId;
};

const getPortalProfile = async ({ scope }) => {
  const vendorId = requireVendorScope(scope);
  const vendor = await repository.findVendorById(vendorId);
  assertVendor(vendor);
  const [stock, accounts] = await Promise.all([
    repository.listStock(vendorId, { activeOnly: true }),
    repository.listVendorUsers(vendorId)
  ]);
  return {
    vendor: mapVendor(vendor),
    stock: stock.map(mapStock),
    accounts: accounts.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      isPrimary: row.is_primary,
      lastLoginAt: row.last_login_at
    }))
  };
};

const listPortalStock = async ({ scope, filters }) => {
  const vendorId = requireVendorScope(scope);
  const vendor = await repository.findVendorById(vendorId);
  assertVendor(vendor);
  const includeRetired = filters.includeRetired === 'true' || filters.includeRetired === true;
  const stock = await repository.listStock(vendorId, { activeOnly: !includeRetired });
  return { items: stock.map(mapStock) };
};

const listPortalDrugs = async ({ scope, filters }) => {
  requireVendorScope(scope);
  const rows = await repository.searchStateDrugs({
    stateId: scope.stateId,
    search: filters.search || null,
    limit: Math.min(Number(filters.limit) || 20, 50)
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      strength: row.strength,
      dosageForm: row.dosage_form,
      unitOfMeasure: row.unit_of_measure
    }))
  };
};

const createPortalStock = async ({ scope, actor, payload }) => {
  const vendorId = requireVendorScope(scope);
  const vendor = await repository.findVendorById(vendorId);
  assertVendor(vendor);

  const drug = await repository.findStateDrug(scope.stateId, payload.drugId);
  if (!drug) {
    throw new NotFoundError('That drug is not in the state catalogue');
  }
  if (!drug.is_active) {
    throw new ConflictError(`${drug.name} is retired from the catalogue`, 'DRUG_INACTIVE');
  }

  const duplicate = await repository.findStockDuplicate({
    vendorId,
    stateDrugId: payload.drugId,
    batchNumber: payload.batchNumber,
    expiryDate: payload.expiryDate
  });
  if (duplicate) {
    throw new ConflictError(
      'You already list this drug with the same batch number and expiry',
      'DUPLICATE_STOCK_LINE'
    );
  }

  const createdId = await withTransaction(async (client) => {
    const inserted = await repository.insertStockLine(client, {
      vendorId,
      stateDrugId: payload.drugId,
      vendorSku: normaliseOptional(payload.vendorSku),
      batchNumber: payload.batchNumber,
      expiryDate: payload.expiryDate,
      quantityAvailable: payload.quantityAvailable,
      unitPrice: payload.unitPrice,
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor.stock_added',
      entityType: 'vendor_stock',
      entityId: inserted.id,
      summary: `Added ${drug.name} batch ${payload.batchNumber} to vendor stock`,
      newValues: {
        drug: drug.name,
        batchNumber: payload.batchNumber,
        expiryDate: payload.expiryDate,
        quantityAvailable: payload.quantityAvailable,
        unitPrice: payload.unitPrice
      }
    });

    return inserted.id;
  });

  const stock = await repository.findStockLine(vendorId, createdId);
  return mapStock(stock);
};

const updatePortalStock = async ({ scope, actor, stockId, payload }) => {
  const vendorId = requireVendorScope(scope);
  const existing = await repository.findStockLine(vendorId, stockId);
  if (!existing) {
    throw new NotFoundError('That stock line was not found');
  }

  const batchNumber =
    payload.batchNumber === undefined ? existing.batch_number : payload.batchNumber;
  const expiryDate = payload.expiryDate === undefined ? existing.expiry_date : payload.expiryDate;

  if (
    normaliseIdentity(batchNumber) !== normaliseIdentity(existing.batch_number) ||
    expiryDate !== existing.expiry_date
  ) {
    const duplicate = await repository.findStockDuplicate({
      vendorId,
      stateDrugId: existing.state_drug_id,
      batchNumber,
      expiryDate,
      excludeId: stockId
    });
    if (duplicate) {
      throw new ConflictError(
        'You already list this drug with the same batch number and expiry',
        'DUPLICATE_STOCK_LINE'
      );
    }
  }

  const values = {
    vendorSku: payload.vendorSku === undefined ? existing.vendor_sku : normaliseOptional(payload.vendorSku),
    batchNumber,
    expiryDate,
    quantityAvailable:
      payload.quantityAvailable === undefined
        ? Number(existing.quantity_available)
        : payload.quantityAvailable,
    unitPrice: payload.unitPrice === undefined ? Number(existing.unit_price) : payload.unitPrice,
    isActive: payload.isActive === undefined ? existing.is_active : payload.isActive
  };

  await withTransaction(async (client) => {
    await repository.updateStockLine(client, { stockId, vendorId, values });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor.stock_updated',
      entityType: 'vendor_stock',
      entityId: stockId,
      summary: `Updated stock line ${existing.drug_name} batch ${values.batchNumber}`,
      previousValues: mapStock(existing),
      newValues: values
    });
  });

  const stock = await repository.findStockLine(vendorId, stockId);
  return mapStock(stock);
};

const submitForScreening = async ({ scope, actor }) => {
  const vendorId = requireVendorScope(scope);
  const vendor = await repository.findVendorById(vendorId);
  assertVendor(vendor);

  if (vendor.status !== VENDOR_STATUS.DRAFT) {
    throw new ConflictError(
      vendor.status === VENDOR_STATUS.PENDING
        ? 'Your profile is already waiting for screening'
        : 'Only a draft profile can be submitted for screening',
      'VENDOR_STATUS_INVALID'
    );
  }

  const stock = await repository.listStock(vendorId, { activeOnly: true });
  const sellable = stock.filter((line) => Number(line.quantity_available) > 0);
  if (sellable.length === 0) {
    throw new ConflictError('Add at least one stock line with quantity before submitting', 'VENDOR_STOCK_REQUIRED');
  }

  await withTransaction(async (client) => {
    await repository.setVendorStatus(client, {
      vendorId,
      status: VENDOR_STATUS.PENDING
    });

    await repository.insertStatusHistory(client, {
      vendorId,
      stateId: vendor.state_id,
      fromStatus: vendor.status,
      toStatus: VENDOR_STATUS.PENDING,
      reason: 'Submitted for screening',
      actorId: actor.id,
      actorName: actor.fullName
    });

    await recordAudit(client, {
      vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: 'vendor',
      action: 'vendor.submitted',
      entityType: 'vendor',
      entityId: vendorId,
      summary: `Submitted vendor ${vendor.legal_name} for screening`
    });
  });

  return mapVendor(await repository.findVendorById(vendorId));
};

module.exports = {
  VENDOR_STATUS,
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  screenVendor,
  registerVendor,
  changeVendorStatus,
  getPortalProfile,
  listPortalStock,
  listPortalDrugs,
  createPortalStock,
  updatePortalStock,
  submitForScreening
};

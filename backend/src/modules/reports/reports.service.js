const { roundQuantity, roundMoney } = require('../../shared/utils/numbers');
const { parseDateInput } = require('../../shared/utils/date');
const { MOVEMENT_TYPES } = require('../../shared/constants');
const repository = require('./reports.repository');

const formatDateTime = (value) => {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const formatDate = (value) => {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return new Date(value).toISOString().slice(0, 10);
};

const getDashboard = async (healthcareCentreId, options = {}) => {
  const nearExpiryDays = options.days || 90;
  const [overview, expiry, pending, recentMovements, lowStockItems, upcomingExpiries, recentRequisitions] =
    await Promise.all([
      repository.getStockOverview(healthcareCentreId),
      repository.getExpiryOverview(healthcareCentreId, nearExpiryDays),
      repository.getPendingCounts(healthcareCentreId),
      repository.getRecentMovements(healthcareCentreId, 10),
      repository.getLowStockItems(healthcareCentreId, 10),
      repository.getUpcomingExpiries(healthcareCentreId, nearExpiryDays, 10),
      repository.getRecentRequisitions(healthcareCentreId, 5)
    ]);

  return {
    overview: {
      activeDrugs: Number(overview.active_drugs),
      usableQuantity: roundQuantity(Number(overview.usable_quantity)),
      blockedQuantity: roundQuantity(Number(overview.blocked_quantity)),
      expiredQuantity: roundQuantity(Number(overview.expired_quantity)),
      lowStockCount: Number(overview.low_stock),
      outOfStockCount: Number(overview.out_of_stock)
    },
    expiry: {
      nearExpiryDays,
      nearExpiryBatches: Number(expiry.near_expiry_batches),
      nearExpiryQuantity: roundQuantity(Number(expiry.near_expiry_quantity)),
      expiredBatches: Number(expiry.expired_batches),
      expiredQuantity: roundQuantity(Number(expiry.expired_quantity))
    },
    pending: {
      requisitions: Number(pending.pending_requisitions),
      adjustments: Number(pending.pending_adjustments),
      returns: Number(pending.pending_returns)
    },
    lowStockItems: lowStockItems.map((row) => ({
      drugId: row.id,
      code: row.code,
      name: row.name,
      unitOfMeasure: row.unit_of_measure,
      usableQuantity: roundQuantity(Number(row.usable_quantity)),
      minimumStockLevel: roundQuantity(Number(row.minimum_stock_level))
    })),
    upcomingExpiries: upcomingExpiries.map((row) => ({
      batchId: row.id,
      batchNumber: row.batch_number,
      drugCode: row.drug_code,
      drugName: row.drug_name,
      unitOfMeasure: row.unit_of_measure,
      expiryDate: formatDate(row.expiry_date),
      daysToExpiry: Number(row.days_to_expiry),
      quantity: roundQuantity(Number(row.quantity))
    })),
    recentMovements: recentMovements.map((row) => ({
      id: row.id,
      movementType: row.movement_type,
      drugCode: row.drug_code,
      drugName: row.drug_name,
      batchNumber: row.batch_number,
      quantity: roundQuantity(Number(row.quantity)),
      unitOfMeasure: row.unit_of_measure,
      reason: row.reason,
      actorFullName: row.actor_full_name,
      createdAt: row.created_at
    })),
    recentRequisitions: recentRequisitions.map((row) => ({
      id: row.id,
      requisitionNumber: row.requisition_number,
      status: row.status,
      source: row.source,
      createdByName: row.created_by_name,
      itemCount: Number(row.item_count),
      createdAt: row.created_at
    }))
  };
};

const getReportOptions = async (healthcareCentreId) => {
  const [users, drugs] = await Promise.all([
    repository.listUsers(healthcareCentreId),
    repository.listDrugs(healthcareCentreId)
  ]);
  return {
    users: users.map((user) => ({ id: user.id, fullName: user.full_name, email: user.email })),
    drugs: drugs.map((drug) => ({ id: drug.id, code: drug.code, name: drug.name })),
    movementTypes: Object.values(MOVEMENT_TYPES),
    requisitionStatuses: ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed'],
    expiryStatuses: ['near_expiry', 'expired', 'all']
  };
};

const buildInventoryReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.inventoryRows(healthcareCentreId, {
    search: filters.search || null
  });
  return {
    title: 'Inventory Report',
    subtitle: `Generated ${formatDateTime(new Date())}`,
    filename: 'inventory-report',
    columns: [
      { header: 'Code', key: 'code', width: 16 },
      { header: 'Drug', key: 'name', width: 28 },
      { header: 'Strength', key: 'strength', width: 14 },
      { header: 'Dosage form', key: 'dosageForm', width: 14 },
      { header: 'Unit', key: 'unitOfMeasure', width: 12 },
      { header: 'Usable', key: 'usableQuantity', width: 12 },
      { header: 'Blocked', key: 'blockedQuantity', width: 12 },
      { header: 'Expired', key: 'expiredQuantity', width: 12 },
      { header: 'Minimum', key: 'minimumStockLevel', width: 12 },
      { header: 'Status', key: 'status', width: 14 }
    ],
    rows: rows.map((row) => ({
      code: row.code,
      name: row.name,
      strength: row.strength || '',
      dosageForm: row.dosage_form,
      unitOfMeasure: row.unit_of_measure,
      usableQuantity: roundQuantity(Number(row.usable_quantity)),
      blockedQuantity: roundQuantity(Number(row.blocked_quantity)),
      expiredQuantity: roundQuantity(Number(row.expired_quantity)),
      minimumStockLevel: roundQuantity(Number(row.minimum_stock_level)),
      status: row.stock_status
    }))
  };
};

const buildMovementReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.movementRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    drugId: filters.drugId || null,
    movementType: filters.movementType || null,
    userId: filters.userId || null
  });
  const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  return {
    title: 'Stock Movement Report',
    subtitle: `Generated ${formatDateTime(new Date())} | Net movement: ${roundQuantity(total)}`,
    filename: 'stock-movement-report',
    columns: [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Drug code', key: 'drugCode', width: 14 },
      { header: 'Drug', key: 'drugName', width: 24 },
      { header: 'Batch', key: 'batchNumber', width: 14 },
      { header: 'Type', key: 'movementType', width: 14 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Reason', key: 'reason', width: 30 },
      { header: 'Reference', key: 'reference', width: 18 },
      { header: 'Actor', key: 'actorFullName', width: 22 }
    ],
    rows: rows.map((row) => ({
      date: formatDateTime(row.created_at),
      drugCode: row.drug_code,
      drugName: row.drug_name,
      batchNumber: row.batch_number,
      movementType: row.movement_type,
      quantity: roundQuantity(Number(row.quantity)),
      reason: row.reason || '',
      reference: row.source_reference || '',
      actorFullName: row.actor_full_name
    }))
  };
};

const buildDispensingReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.dispensingRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    drugId: filters.drugId || null,
    userId: filters.userId || null
  });
  return {
    title: 'Dispensing Report',
    subtitle: `Generated ${formatDateTime(new Date())} | Total dispensed: ${roundQuantity(
      rows.reduce((sum, row) => sum + Number(row.quantity), 0)
    )}`,
    filename: 'dispensing-report',
    columns: [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Drug code', key: 'drugCode', width: 14 },
      { header: 'Drug', key: 'drugName', width: 24 },
      { header: 'Batch', key: 'batchNumber', width: 14 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Actor', key: 'actor', width: 22 },
      { header: 'Note', key: 'note', width: 28 }
    ],
    rows: rows.map((row) => ({
      date: formatDateTime(row.created_at),
      reference: row.reference || '',
      drugCode: row.drug_code,
      drugName: row.drug_name,
      batchNumber: row.batch_number,
      quantity: roundQuantity(Number(row.quantity)),
      actor: row.created_by_name,
      note: row.note || ''
    }))
  };
};

const buildExpiryReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.expiryRows(healthcareCentreId, {
    status: filters.status || 'all',
    days: filters.days || 90
  });
  return {
    title: 'Expiry Report',
    subtitle: `Generated ${formatDateTime(new Date())} | Window: ${filters.days || 90} days`,
    filename: 'expiry-report',
    columns: [
      { header: 'Expiry date', key: 'expiryDate', width: 14 },
      { header: 'Days remaining', key: 'daysRemaining', width: 16 },
      { header: 'Drug code', key: 'drugCode', width: 14 },
      { header: 'Drug', key: 'drugName', width: 26 },
      { header: 'Batch', key: 'batchNumber', width: 14 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Status', key: 'status', width: 18 }
    ],
    rows: rows.map((row) => ({
      expiryDate: formatDate(row.expiry_date),
      daysRemaining: Number(row.days_remaining),
      drugCode: row.drug_code,
      drugName: row.drug_name,
      batchNumber: row.batch_number,
      quantity: roundQuantity(Number(row.quantity)),
      status: row.status
    }))
  };
};

const buildRequisitionReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.requisitionRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    status: filters.status || null
  });
  return {
    title: 'Requisition Report',
    subtitle: `Generated ${formatDateTime(new Date())}`,
    filename: 'requisition-report',
    columns: [
      { header: 'Created', key: 'createdAt', width: 20 },
      { header: 'Requisition', key: 'requisitionNumber', width: 20 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Items', key: 'itemCount', width: 8 },
      { header: 'Total quantity', key: 'totalQuantity', width: 14 },
      { header: 'Created by', key: 'createdByName', width: 20 },
      { header: 'Reviewed by', key: 'reviewedByName', width: 20 },
      { header: 'Reviewed at', key: 'reviewedAt', width: 20 },
      { header: 'Reason', key: 'reviewReason', width: 26 }
    ],
    rows: rows.map((row) => ({
      createdAt: formatDateTime(row.created_at),
      requisitionNumber: row.requisition_number,
      status: row.status,
      source: row.source,
      itemCount: Number(row.item_count),
      totalQuantity: roundQuantity(Number(row.total_quantity)),
      createdByName: row.created_by_name,
      reviewedByName: row.reviewed_by_name || '',
      reviewedAt: formatDateTime(row.reviewed_at),
      reviewReason: row.review_reason || ''
    }))
  };
};

const buildAdjustmentReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.adjustmentRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    status: filters.status || null,
    drugId: filters.drugId || null
  });
  return {
    title: 'Stock Adjustment Report',
    subtitle: `Generated ${formatDateTime(new Date())}`,
    filename: 'adjustment-report',
    columns: [
      { header: 'Created', key: 'createdAt', width: 20 },
      { header: 'Drug code', key: 'drugCode', width: 14 },
      { header: 'Drug', key: 'drugName', width: 24 },
      { header: 'Batch', key: 'batchNumber', width: 14 },
      { header: 'Type', key: 'adjustmentType', width: 16 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Value', key: 'valueImpact', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Requested by', key: 'requestedByName', width: 20 },
      { header: 'Reviewed by', key: 'reviewedByName', width: 20 },
      { header: 'Reason', key: 'reason', width: 30 }
    ],
    rows: rows.map((row) => ({
      createdAt: formatDateTime(row.created_at),
      drugCode: row.drug_code,
      drugName: row.drug_name,
      batchNumber: row.batch_number,
      adjustmentType: row.adjustment_type,
      quantity: roundQuantity(Number(row.quantity)),
      valueImpact: row.unit_cost === null ? '' : roundMoney(Math.abs(Number(row.quantity)) * Number(row.unit_cost)),
      status: row.status,
      requestedByName: row.requested_by_name,
      reviewedByName: row.reviewed_by_name || '',
      reason: row.reason
    }))
  };
};

const buildReturnReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.returnRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    status: filters.status || null
  });
  return {
    title: 'Return Report',
    subtitle: `Generated ${formatDateTime(new Date())}`,
    filename: 'return-report',
    columns: [
      { header: 'Created', key: 'createdAt', width: 20 },
      { header: 'Return', key: 'requestNumber', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Items', key: 'itemCount', width: 8 },
      { header: 'Total quantity', key: 'totalQuantity', width: 14 },
      { header: 'Requested by', key: 'requestedByName', width: 20 },
      { header: 'Reviewed by', key: 'reviewedByName', width: 20 },
      { header: 'Reason', key: 'reason', width: 30 },
      { header: 'Review comment', key: 'reviewComment', width: 26 }
    ],
    rows: rows.map((row) => ({
      createdAt: formatDateTime(row.created_at),
      requestNumber: row.request_number,
      status: row.status,
      itemCount: Number(row.item_count),
      totalQuantity: roundQuantity(Number(row.total_quantity)),
      requestedByName: row.requested_by_name,
      reviewedByName: row.reviewed_by_name || '',
      reason: row.reason,
      reviewComment: row.review_comment || ''
    }))
  };
};

const buildAuditReport = async (healthcareCentreId, filters = {}) => {
  const rows = await repository.auditRows(healthcareCentreId, {
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    action: filters.action || null,
    userId: filters.userId || null
  });
  return {
    title: 'Audit History Report',
    subtitle: `Generated ${formatDateTime(new Date())}`,
    filename: 'audit-history-report',
    columns: [
      { header: 'Timestamp', key: 'createdAt', width: 20 },
      { header: 'Actor', key: 'actorFullName', width: 22 },
      { header: 'User ID', key: 'actorUserId', width: 36 },
      { header: 'Action', key: 'action', width: 24 },
      { header: 'Entity', key: 'entityType', width: 18 },
      { header: 'Entity ID', key: 'entityId', width: 36 },
      { header: 'Summary', key: 'summary', width: 40 },
      { header: 'Reason', key: 'reason', width: 28 }
    ],
    rows: rows.map((row) => ({
      createdAt: formatDateTime(row.created_at),
      actorFullName: row.actor_full_name,
      actorUserId: row.actor_user_id || '',
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id || '',
      summary: row.summary || '',
      reason: row.reason || ''
    }))
  };
};

module.exports = {
  getDashboard,
  getReportOptions,
  buildInventoryReport,
  buildMovementReport,
  buildDispensingReport,
  buildExpiryReport,
  buildRequisitionReport,
  buildAdjustmentReport,
  buildReturnReport,
  buildAuditReport
};

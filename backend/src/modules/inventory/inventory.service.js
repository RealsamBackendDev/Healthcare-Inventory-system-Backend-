const { NotFoundError } = require('../../shared/errors/AppError');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { roundQuantity } = require('../../shared/utils/numbers');
const repository = require('./inventory.repository');

const mapInventoryRow = (row) => ({
  drugId: row.id,
  code: row.code,
  name: row.name,
  genericName: row.generic_name,
  brandName: row.brand_name,
  strength: row.strength,
  dosageForm: row.dosage_form,
  unitOfMeasure: row.unit_of_measure,
  minimumStockLevel: roundQuantity(Number(row.minimum_stock_level)),
  usableQuantity: roundQuantity(Number(row.usable_quantity)),
  blockedQuantity: roundQuantity(Number(row.blocked_quantity)),
  expiredQuantity: roundQuantity(Number(row.expired_quantity)),
  destroyedQuantity: roundQuantity(Number(row.destroyed_quantity)),
  totalQuantity: roundQuantity(Number(row.total_quantity)),
  batchCount: Number(row.batch_count),
  stockStatus: row.stock_status
});

const mapBatch = (row) => ({
  id: row.id,
  batchNumber: row.batch_number,
  drugId: row.drug_id,
  drugCode: row.drug_code,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  expiryDate: row.expiry_date,
  daysToExpiry: row.days_to_expiry === null ? null : Number(row.days_to_expiry),
  quantity: roundQuantity(Number(row.quantity)),
  unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
  receivedDate: row.received_date,
  supplierReference: row.supplier_reference,
  status: row.is_usable ? 'usable' : row.status === 'usable' ? 'expired' : row.status,
  recordedStatus: row.status,
  isUsable: row.is_usable
});

const listInventory = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listInventory({
    healthcareCentreId,
    search: filters.search || null,
    status: filters.status || null,
    limit,
    offset
  });
  return {
    items: rows.map(mapInventoryRow),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const listBatches = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listBatches({
    healthcareCentreId,
    drugId: filters.drugId || null,
    status: filters.status || null,
    expiryStatus: filters.expiryStatus || null,
    search: filters.search || null,
    nearExpiryDays: filters.nearExpiryDays || 90,
    limit,
    offset
  });
  return {
    items: rows.map(mapBatch),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getDrugInventory = async (healthcareCentreId, drugId, nearExpiryDays) => {
  const summary = await repository.findDrugStock(healthcareCentreId, drugId);
  if (!summary) {
    throw new NotFoundError('Drug was not found in this healthcare centre');
  }
  const batches = await repository.listBatches({
    healthcareCentreId,
    drugId,
    nearExpiryDays: nearExpiryDays || 90,
    limit: 500,
    offset: 0
  });
  return {
    drug: mapInventoryRow(summary),
    batches: batches.rows.map(mapBatch)
  };
};

module.exports = {
  listInventory,
  listBatches,
  getDrugInventory,
  mapBatch,
  mapInventoryRow
};

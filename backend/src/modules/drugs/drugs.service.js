const { withTransaction } = require('../../database/connection');
const { ConflictError, NotFoundError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const repository = require('./drugs.repository');

const mapDrug = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  genericName: row.generic_name,
  brandName: row.brand_name,
  strength: row.strength,
  dosageForm: row.dosage_form,
  unitOfMeasure: row.unit_of_measure,
  minimumStockLevel: Number(row.minimum_stock_level),
  isActive: row.is_active,
  batchCount: row.batch_count === undefined ? undefined : Number(row.batch_count),
  totalQuantity: row.total_quantity === undefined ? undefined : Number(row.total_quantity),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const listDrugs = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  let isActive;
  if (filters.status === 'active') {
    isActive = true;
  } else if (filters.status === 'inactive') {
    isActive = false;
  }
  const { rows, total } = await repository.list({
    healthcareCentreId,
    search: filters.search || null,
    isActive,
    limit,
    offset
  });
  return {
    items: rows.map(mapDrug),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getDrug = async (healthcareCentreId, drugId) => {
  const drug = await repository.findById(healthcareCentreId, drugId);
  if (!drug) {
    throw new NotFoundError('Drug was not found in this healthcare centre');
  }
  return mapDrug(drug);
};

const ensureCodeIsAvailable = async (healthcareCentreId, code, excludeDrugId) => {
  const existing = await repository.findByCode(healthcareCentreId, code);
  if (existing && existing.id !== excludeDrugId && existing.is_active) {
    throw new ConflictError('Another active drug already uses this code', 'DUPLICATE_DRUG_CODE');
  }
  return existing;
};

const createDrug = async ({ actor, healthcareCentreId, payload }) => {
  await ensureCodeIsAvailable(healthcareCentreId, payload.code);

  return withTransaction(async (client) => {
    const drug = await repository.create(client, {
      healthcareCentreId,
      code: payload.code,
      name: payload.name,
      genericName: payload.genericName,
      brandName: payload.brandName,
      strength: payload.strength,
      dosageForm: payload.dosageForm,
      unitOfMeasure: payload.unitOfMeasure,
      minimumStockLevel: payload.minimumStockLevel,
      createdBy: actor.id
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'drug.created',
      entityType: 'drug',
      entityId: drug.id,
      summary: `Created drug ${drug.name} (${drug.code})`,
      newValues: mapDrug(drug)
    });

    return mapDrug(drug);
  });
};

const updateDrug = async ({ actor, healthcareCentreId, drugId, payload }) => {
  const existing = await repository.findById(healthcareCentreId, drugId);
  if (!existing) {
    throw new NotFoundError('Drug was not found in this healthcare centre');
  }

  if (payload.code) {
    await ensureCodeIsAvailable(healthcareCentreId, payload.code, drugId);
  }

  return withTransaction(async (client) => {
    const updated = await repository.update(client, {
      healthcareCentreId,
      drugId,
      fields: payload
    });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'drug.updated',
      entityType: 'drug',
      entityId: drugId,
      summary: `Updated drug ${updated.name} (${updated.code})`,
      previousValues: mapDrug(existing),
      newValues: mapDrug(updated)
    });

    return mapDrug(updated);
  });
};

const setDrugActiveState = async ({ actor, healthcareCentreId, drugId, isActive }) => {
  const existing = await repository.findById(healthcareCentreId, drugId);
  if (!existing) {
    throw new NotFoundError('Drug was not found in this healthcare centre');
  }

  if (isActive) {
    await ensureCodeIsAvailable(healthcareCentreId, existing.code, drugId);
  }

  return withTransaction(async (client) => {
    const updated = await repository.setActive(client, { healthcareCentreId, drugId, isActive });

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: isActive ? 'drug.reactivated' : 'drug.deactivated',
      entityType: 'drug',
      entityId: drugId,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} drug ${updated.name} (${updated.code})`,
      previousValues: { isActive: existing.is_active },
      newValues: { isActive: updated.is_active }
    });

    return mapDrug(updated);
  });
};

module.exports = {
  listDrugs,
  getDrug,
  createDrug,
  updateDrug,
  setDrugActiveState
};

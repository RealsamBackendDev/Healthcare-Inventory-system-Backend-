const { withTransaction } = require('../../database/connection');
const { roundQuantity } = require('../../shared/utils/numbers');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { recordAudit } = require('../../shared/utils/audit');
const { EXPIRY_WINDOWS } = require('../../shared/constants');
const repository = require('./expiry.repository');

const mapExpiringBatch = (row) => ({
  id: row.id,
  batchNumber: row.batch_number,
  drugId: row.drug_id,
  drugCode: row.drug_code,
  drugName: row.drug_name,
  unitOfMeasure: row.unit_of_measure,
  expiryDate: row.expiry_date,
  daysToExpiry: row.days_to_expiry === undefined ? undefined : Number(row.days_to_expiry),
  daysExpired: row.days_expired === undefined ? undefined : Number(row.days_expired),
  quantity: roundQuantity(Number(row.quantity)),
  unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
  status: row.status
});

const getNearExpiry = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const days = filters.days || 90;
  const { rows, total } = await repository.listNearExpiry({
    healthcareCentreId,
    days,
    limit,
    offset
  });
  return {
    items: rows.map(mapExpiringBatch),
    windowDays: days,
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getExpired = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listExpired({
    healthcareCentreId,
    limit,
    offset
  });
  return {
    items: rows.map(mapExpiringBatch),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getSummary = async (healthcareCentreId) => {
  const summary = await repository.getExpirySummary(healthcareCentreId);
  return {
    expiredBatches: Number(summary.expired_batches),
    expiredQuantity: roundQuantity(Number(summary.expired_quantity)),
    within7Days: Number(summary.within_7_days),
    within30Days: Number(summary.within_30_days),
    within90Days: Number(summary.within_90_days),
    windows: EXPIRY_WINDOWS
  };
};

const refreshCentre = async (centre) =>
  withTransaction(async (client) => {
    const expiredBatches = await repository.markExpiredBatches(client, centre.id);
    let notifications = 0;

    notifications += await repository.createExpiredNotifications(client, centre.id);

    for (const days of EXPIRY_WINDOWS) {
      notifications += await repository.createNearExpiryNotifications(client, {
        healthcareCentreId: centre.id,
        days,
        type: `near_expiry_${days}`
      });
    }

    if (expiredBatches.length > 0) {
      await recordAudit(client, {
        healthcareCentreId: centre.id,
        actor: null,
        action: 'expiry.batches_expired',
        entityType: 'batch',
        summary: `${expiredBatches.length} batch(es) marked expired by the expiry monitor`,
        newValues: {
          batches: expiredBatches.map((batch) => ({
            batchNumber: batch.batch_number,
            quantity: Number(batch.quantity)
          }))
        }
      });
    }

    return {
      centreId: centre.id,
      expiredBatches: expiredBatches.length,
      notifications
    };
  });

const refreshAllCentres = async () => {
  const centres = await repository.listActiveCentres();
  const results = [];
  for (const centre of centres) {
    results.push(await refreshCentre(centre));
  }
  return {
    centres: results.length,
    expiredBatches: results.reduce((total, result) => total + result.expiredBatches, 0),
    notifications: results.reduce((total, result) => total + result.notifications, 0)
  };
};

const refreshCurrentCentre = async (healthcareCentreId) => {
  const centres = await repository.listActiveCentres();
  const centre = centres.find((item) => item.id === healthcareCentreId);
  if (!centre) {
    return { centreId: healthcareCentreId, expiredBatches: 0, notifications: 0 };
  }
  return refreshCentre(centre);
};

module.exports = {
  getNearExpiry,
  getExpired,
  getSummary,
  refreshAllCentres,
  refreshCurrentCentre
};

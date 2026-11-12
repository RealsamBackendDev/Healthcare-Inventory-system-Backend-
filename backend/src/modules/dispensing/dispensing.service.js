const crypto = require('crypto');
const { withTransaction } = require('../../database/connection');
const { InsufficientStockError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { roundQuantity, subtractQuantity, hasSufficient, isPositive } = require('../../shared/utils/numbers');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { parseDateInput, todayIsoDate } = require('../../shared/utils/date');
const { recordAudit } = require('../../shared/utils/audit');
const repository = require('./dispensing.repository');

const generateReference = () => {
  const date = todayIsoDate().replace(/-/g, '');
  return `DSP-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

const mergeItems = (items) => {
  const merged = new Map();
  items.forEach((item) => {
    const existing = merged.get(item.drugId);
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + Number(item.quantity));
    } else {
      merged.set(item.drugId, {
        drugId: item.drugId,
        quantity: Number(item.quantity)
      });
    }
  });
  return [...merged.values()].sort((left, right) => left.drugId.localeCompare(right.drugId));
};

const dispense = async ({ actor, healthcareCentreId, payload }) => {
  const items = mergeItems(payload.items);

  return withTransaction(async (client) => {
    const drugs = await repository.findDrugs(
      client,
      healthcareCentreId,
      items.map((item) => item.drugId)
    );
    const drugsById = new Map(drugs.map((drug) => [drug.id, drug]));

    items.forEach((item, index) => {
      const drug = drugsById.get(item.drugId);
      if (!drug) {
        throw new ValidationError('One or more dispensing rows reference an unknown drug', [
          { field: `items.${index}.drugId`, message: 'Drug is not available in this healthcare centre' }
        ]);
      }
      if (!drug.is_active) {
        throw new ValidationError('Inactive drugs cannot be dispensed', [
          { field: `items.${index}.drugId`, message: `${drug.name} is inactive` }
        ]);
      }
    });

    const record = await repository.insertDispensingRecord(client, {
      healthcareCentreId,
      reference: payload.reference || generateReference(),
      note: payload.note || null,
      actorId: actor.id,
      actorName: actor.fullName
    });

    const allocations = [];

    for (const item of items) {
      const drug = drugsById.get(item.drugId);
      const batches = await repository.lockEligibleBatches(client, {
        healthcareCentreId,
        drugId: item.drugId
      });

      const available = batches.reduce((total, batch) => roundQuantity(total + Number(batch.quantity)), 0);

      if (!hasSufficient(available, item.quantity)) {
        throw new InsufficientStockError(
          `There is not enough usable stock for ${drug.name}. Available: ${available}, requested: ${item.quantity}`,
          { drugId: drug.id, drugName: drug.name, available, requested: item.quantity }
        );
      }

      let remaining = item.quantity;

      for (const batch of batches) {
        if (!isPositive(remaining)) {
          break;
        }
        const batchQuantity = Number(batch.quantity);
        if (!isPositive(batchQuantity)) {
          continue;
        }

        const allocated = Math.min(remaining, batchQuantity);
        const newBatchQuantity = subtractQuantity(batchQuantity, allocated);

        await repository.setBatchQuantity(client, { batchId: batch.id, quantity: newBatchQuantity });

        await repository.insertDispensingItem(client, {
          dispensingRecordId: record.id,
          drugId: drug.id,
          batchId: batch.id,
          quantity: roundQuantity(allocated)
        });

        await repository.insertMovement(client, {
          healthcareCentreId,
          drugId: drug.id,
          batchId: batch.id,
          quantity: roundQuantity(-allocated),
          reason: payload.note || 'Dispensed',
          actorId: actor.id,
          actorName: actor.fullName,
          sourceReference: record.reference,
          dispensingRecordId: record.id
        });

        allocations.push({
          drugId: drug.id,
          drugName: drug.name,
          batchId: batch.id,
          batchNumber: batch.batch_number,
          expiryDate: batch.expiry_date,
          quantity: roundQuantity(allocated)
        });

        remaining = subtractQuantity(remaining, allocated);
      }

      if (isPositive(remaining)) {
        throw new InsufficientStockError(`Usable stock for ${drug.name} changed during dispensing`, {
          drugId: drug.id,
          remaining
        });
      }
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'stock.dispensed',
      entityType: 'dispensing_record',
      entityId: record.id,
      summary: `Dispensed ${items.length} drug line(s) on ${record.reference}`,
      newValues: {
        reference: record.reference,
        items: allocations.map((allocation) => ({
          drugName: allocation.drugName,
          batchNumber: allocation.batchNumber,
          quantity: allocation.quantity
        }))
      }
    });

    return {
      dispensing: {
        id: record.id,
        reference: record.reference,
        note: record.note,
        createdAt: record.created_at,
        createdByName: record.created_by_name
      },
      allocations
    };
  });
};

const listDispensing = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const { rows, total } = await repository.listRecords({
    healthcareCentreId,
    search: filters.search || null,
    from: parseDateInput(filters.from),
    to: parseDateInput(filters.to),
    limit,
    offset
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      note: row.note,
      itemCount: Number(row.item_count),
      totalQuantity: Number(row.total_quantity),
      createdByName: row.created_by_name,
      createdAt: row.created_at
    })),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getDispensing = async (healthcareCentreId, recordId) => {
  const record = await repository.findRecord(healthcareCentreId, recordId);
  if (!record) {
    throw new NotFoundError('Dispensing record was not found');
  }
  const items = await repository.listRecordItems(record.id);
  return {
    dispensing: {
      id: record.id,
      reference: record.reference,
      note: record.note,
      createdByName: record.created_by_name,
      createdAt: record.created_at
    },
    items: items.map((item) => ({
      id: item.id,
      drugId: item.drug_id,
      drugCode: item.drug_code,
      drugName: item.drug_name,
      unitOfMeasure: item.unit_of_measure,
      batchId: item.batch_id,
      batchNumber: item.batch_number,
      expiryDate: item.expiry_date,
      quantity: roundQuantity(Number(item.quantity))
    }))
  };
};

module.exports = {
  dispense,
  listDispensing,
  getDispensing
};

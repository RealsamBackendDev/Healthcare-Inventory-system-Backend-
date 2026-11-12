const crypto = require('crypto');
const { withTransaction } = require('../../database/connection');
const { ConflictError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { addQuantity, roundMoney } = require('../../shared/utils/numbers');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { recordAudit } = require('../../shared/utils/audit');
const { parseDateInput, isoDateOf, todayIsoDate } = require('../../shared/utils/date');
const { BATCH_STATUS, MOVEMENT_TYPES } = require('../../shared/constants');
const repository = require('./receiving.repository');

const generateReference = (prefix) => {
  const date = todayIsoDate().replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${date}-${suffix}`;
};

const normaliseReceiptItems = (items) =>
  items.map((item, index) => {
    const expiryDate = parseDateInput(item.expiryDate);
    const receivedDate = parseDateInput(item.receivedDate);
    if (item.expiryDate && !expiryDate) {
      throw new ValidationError('One or more receipt rows are invalid', [
        { field: `items.${index}.expiryDate`, message: 'Expiry date is not a valid date' }
      ]);
    }
    if (item.receivedDate && !receivedDate) {
      throw new ValidationError('One or more receipt rows are invalid', [
        { field: `items.${index}.receivedDate`, message: 'Received date is not a valid date' }
      ]);
    }
    return {
      drugId: item.drugId,
      batchNumber: item.batchNumber.trim(),
      quantity: Number(item.quantity),
      expiryDate,
      unitCost: item.unitCost === undefined || item.unitCost === null ? undefined : roundMoney(Number(item.unitCost)),
      receivedDate,
      supplierReference: item.supplierReference || null
    };
  });

const applyItem = async (client, { actor, healthcareCentreId, item, drug, receipt, movementType }) => {
  const today = todayIsoDate();
  const existing = await repository.findBatchForUpdate(client, {
    healthcareCentreId,
    drugId: item.drugId,
    batchNumber: item.batchNumber
  });

  let batch;
  let updatedExisting = false;

  if (existing) {
    const existingExpiry = isoDateOf(existing.expiry_date);

    if (existing.status !== BATCH_STATUS.USABLE) {
      throw new ConflictError(
        `Batch ${existing.batch_number} for ${drug.name} is marked ${existing.status} and cannot receive more stock. Use a new batch number instead`,
        'BATCH_NOT_RECEIVABLE'
      );
    }

    if (existingExpiry && existingExpiry < today) {
      throw new ConflictError(
        `Batch ${existing.batch_number} for ${drug.name} has already expired and cannot receive more stock`,
        'BATCH_EXPIRED'
      );
    }

    if (existingExpiry && item.expiryDate && existingExpiry !== item.expiryDate) {
      throw new ConflictError(
        `Batch ${existing.batch_number} for ${drug.name} already exists with expiry ${existingExpiry}`,
        'BATCH_EXPIRY_CONFLICT'
      );
    }

    const newQuantity = addQuantity(Number(existing.quantity), item.quantity);
    batch = await repository.updateBatchAfterReceipt(client, {
      batchId: existing.id,
      quantity: newQuantity,
      unitCost: item.unitCost,
      expiryDate: item.expiryDate,
      supplierReference: item.supplierReference
    });
    updatedExisting = true;
  } else {
    batch = await repository.insertBatch(client, {
      healthcareCentreId,
      drugId: item.drugId,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate,
      quantity: item.quantity,
      unitCost: item.unitCost,
      receivedDate: item.receivedDate,
      supplierReference: item.supplierReference
    });
  }

  await repository.insertReceiptItem(client, {
    receiptId: receipt.id,
    drugId: item.drugId,
    batchId: batch.id,
    batchNumber: batch.batch_number,
    quantity: item.quantity,
    unitCost: item.unitCost,
    expiryDate: item.expiryDate || isoDateOf(batch.expiry_date),
    receivedDate: item.receivedDate,
    supplierReference: item.supplierReference
  });

  await repository.insertMovement(client, {
    healthcareCentreId,
    drugId: item.drugId,
    batchId: batch.id,
    movementType,
    quantity: item.quantity,
    reason: movementType === MOVEMENT_TYPES.IMPORT ? 'Stock import' : 'Stock received',
    actorId: actor.id,
    actorName: actor.fullName,
    sourceReference: receipt.receipt_reference,
    receiptId: receipt.id
  });

  return {
    drugId: item.drugId,
    drugName: drug.name,
    batchId: batch.id,
    batchNumber: batch.batch_number,
    quantity: item.quantity,
    updatedExisting
  };
};

const createReceipt = async ({
  actor,
  healthcareCentreId,
  payload,
  source = 'manual',
  movementType = MOVEMENT_TYPES.RECEIPT,
  receiptReference,
  supplier,
  note
}) => {
  const items = normaliseReceiptItems(payload.items);
  const receivedDate = parseDateInput(payload.receivedDate);

  if (payload.receivedDate && !receivedDate) {
    throw new ValidationError('Received date is not a valid date', [
      { field: 'receivedDate', message: 'Use a valid date' }
    ]);
  }

  const duplicateKeys = new Set();
  items.forEach((item, index) => {
    const key = `${item.drugId}::${item.batchNumber.toLowerCase()}`;
    if (duplicateKeys.has(key)) {
      throw new ValidationError('The same drug and batch number appears more than once', [
        { field: `items.${index}.batchNumber`, message: 'Duplicate batch in this receipt' }
      ]);
    }
    duplicateKeys.add(key);
  });

  return withTransaction(async (client) => {
    const drugs = await repository.findActiveDrugs(
      client,
      healthcareCentreId,
      [...new Set(items.map((item) => item.drugId))]
    );
    const drugsById = new Map(drugs.map((drug) => [drug.id, drug]));

    items.forEach((item, index) => {
      const drug = drugsById.get(item.drugId);
      if (!drug || !drug.is_active) {
        throw new ValidationError('One or more receipt rows reference an unknown or inactive drug', [
          { field: `items.${index}.drugId`, message: 'Drug is not available in this healthcare centre' }
        ]);
      }
    });

    const reference = receiptReference || payload.receiptReference || generateReference(source === 'import' ? 'IMP' : 'RCV');

    const receipt = await repository.insertReceipt(client, {
      healthcareCentreId,
      receiptReference: reference,
      supplier: supplier !== undefined ? supplier : payload.supplier,
      source,
      receivedDate,
      totalItems: items.length,
      note: note !== undefined ? note : payload.note,
      actorId: actor.id,
      actorName: actor.fullName
    });

    const appliedItems = [];
    for (const item of items) {
      appliedItems.push(
        await applyItem(client, {
          actor,
          healthcareCentreId,
          item,
          drug: drugsById.get(item.drugId),
          receipt,
          movementType
        })
      );
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: source === 'import' ? 'stock.imported' : 'stock.received',
      entityType: 'receipt',
      entityId: receipt.id,
      summary: `${items.length} batch(es) received on ${reference}`,
      newValues: {
        receiptReference: reference,
        supplier: receipt.supplier,
        source,
        items: appliedItems.map((item) => ({
          drugName: item.drugName,
          batchNumber: item.batchNumber,
          quantity: item.quantity
        }))
      }
    });

    return {
      receipt: {
        id: receipt.id,
        receiptReference: receipt.receipt_reference,
        supplier: receipt.supplier,
        source: receipt.source,
        receivedDate: receipt.received_date,
        createdAt: receipt.created_at,
        createdByName: receipt.created_by_name
      },
      items: appliedItems
    };
  });
};

const listReceipts = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  const from = parseDateInput(filters.from);
  const to = parseDateInput(filters.to);
  const { rows, total } = await repository.listReceipts({
    healthcareCentreId,
    search: filters.search || null,
    from,
    to,
    limit,
    offset
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      receiptReference: row.receipt_reference,
      supplier: row.supplier,
      source: row.source,
      receivedDate: row.received_date,
      totalItems: row.total_items,
      totalQuantity: Number(row.total_quantity),
      note: row.note,
      createdByName: row.created_by_name,
      createdAt: row.created_at
    })),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getReceipt = async (healthcareCentreId, receiptId) => {
  const receipt = await repository.findReceipt(healthcareCentreId, receiptId);
  if (!receipt) {
    throw new NotFoundError('Receipt was not found');
  }
  const items = await repository.listReceiptItems(receipt.id);
  return {
    receipt: {
      id: receipt.id,
      receiptReference: receipt.receipt_reference,
      supplier: receipt.supplier,
      source: receipt.source,
      receivedDate: receipt.received_date,
      note: receipt.note,
      createdByName: receipt.created_by_name,
      createdAt: receipt.created_at
    },
    items: items.map((item) => ({
      id: item.id,
      drugId: item.drug_id,
      drugCode: item.drug_code,
      drugName: item.drug_name,
      unitOfMeasure: item.unit_of_measure,
      batchId: item.batch_id,
      batchNumber: item.batch_number,
      batchStatus: item.batch_status,
      quantity: Number(item.quantity),
      unitCost: item.unit_cost === null ? null : Number(item.unit_cost),
      expiryDate: item.expiry_date,
      receivedDate: item.received_date,
      supplierReference: item.supplier_reference
    }))
  };
};

module.exports = {
  createReceipt,
  listReceipts,
  getReceipt,
  generateReference
};

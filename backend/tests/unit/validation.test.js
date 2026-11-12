const { createReceiptSchema } = require('../../src/modules/receiving/receiving.validation');
const { createAdjustmentSchema } = require('../../src/modules/adjustments/adjustments.validation');
const { createRequisitionSchema } = require('../../src/modules/requisitions/requisitions.validation');
const { createDispensingSchema } = require('../../src/modules/dispensing/dispensing.validation');

const drugId = '11111111-1111-4111-8111-111111111111';

describe('request validation', () => {
  test('accepts decimal receipt quantities', () => {
    const result = createReceiptSchema.safeParse({
      items: [{ drugId, batchNumber: 'B-1', quantity: 1.25 }]
    });
    expect(result.success).toBe(true);
  });

  test('rejects receipts without items', () => {
    const result = createReceiptSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  test('rejects a receipt item with zero quantity', () => {
    const result = createReceiptSchema.safeParse({
      items: [{ drugId, batchNumber: 'B-1', quantity: 0 }]
    });
    expect(result.success).toBe(false);
  });

  test('requires an adjustment reason', () => {
    const result = createAdjustmentSchema.safeParse({
      drugId,
      batchId: drugId,
      adjustmentType: 'damage',
      quantity: -5,
      reason: ''
    });
    expect(result.success).toBe(false);
  });

  test('accepts negative adjustment quantities but not zero', () => {
    const valid = createAdjustmentSchema.safeParse({
      drugId,
      batchId: drugId,
      adjustmentType: 'loss',
      quantity: -2.5,
      reason: 'Broken bottles'
    });
    const invalid = createAdjustmentSchema.safeParse({
      drugId,
      batchId: drugId,
      adjustmentType: 'loss',
      quantity: 0,
      reason: 'Broken bottles'
    });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  test('rejects requisitions with no items', () => {
    const result = createRequisitionSchema.safeParse({ notes: 'Restock', items: [] });
    expect(result.success).toBe(false);
  });

  test('rejects dispensing with a negative quantity', () => {
    const result = createDispensingSchema.safeParse({
      items: [{ drugId, quantity: -1 }]
    });
    expect(result.success).toBe(false);
  });
});

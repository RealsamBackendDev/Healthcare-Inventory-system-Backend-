const { z } = require('zod');

const receiptItemSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required'),
  batchNumber: z.string().trim().min(1, 'Batch number is required').max(80),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000),
  expiryDate: z.string().trim().max(40).nullable().optional(),
  unitCost: z.coerce.number().min(0, 'Unit cost cannot be negative').max(1000000000).nullable().optional(),
  receivedDate: z.string().trim().max(40).nullable().optional(),
  supplierReference: z.string().trim().max(160).nullable().optional()
});

const createReceiptSchema = z.object({
  receiptReference: z.string().trim().max(80).nullable().optional(),
  supplier: z.string().trim().max(160).nullable().optional(),
  receivedDate: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(receiptItemSchema).min(1, 'Add at least one item').max(200)
});

const listReceiptsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const receiptIdParamSchema = z.object({
  receiptId: z.string().uuid('A valid receipt id is required')
});

const importRowSchema = z.object({
  rowNumber: z.coerce.number().int().min(1).optional(),
  drugCode: z.string().trim().max(64).nullable().optional(),
  drugName: z.string().trim().max(160).nullable().optional(),
  batchNumber: z.string().trim().max(80).nullable().optional(),
  expiryDate: z.union([z.string(), z.date()]).nullable().optional(),
  quantity: z.union([z.number(), z.string()]).nullable().optional(),
  unitCost: z.union([z.number(), z.string()]).nullable().optional(),
  receivedDate: z.union([z.string(), z.date()]).nullable().optional(),
  supplierReference: z.string().trim().max(160).nullable().optional()
});

const commitImportSchema = z.object({
  mode: z.enum(['all_or_nothing', 'valid_only']).default('all_or_nothing'),
  supplier: z.string().trim().max(160).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  rows: z.array(importRowSchema).min(1, 'At least one row is required').max(1000)
});

module.exports = {
  createReceiptSchema,
  listReceiptsQuerySchema,
  receiptIdParamSchema,
  commitImportSchema
};

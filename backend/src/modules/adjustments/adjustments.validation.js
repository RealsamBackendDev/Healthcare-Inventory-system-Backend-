const { z } = require('zod');

const ADJUSTMENT_TYPES = ['physical_count', 'damage', 'loss', 'correction', 'expiry_writeoff', 'other'];
const RETURN_DISPOSITIONS = ['return_to_supplier', 'quarantined', 'blocked', 'destroyed', 'restock_usable'];

const createAdjustmentSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required'),
  batchId: z.string().uuid('A valid batch id is required'),
  adjustmentType: z.enum(ADJUSTMENT_TYPES),
  quantity: z.coerce
    .number()
    .finite('Quantity must be a number')
    .refine((value) => Math.abs(value) > 0, 'Quantity cannot be zero'),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  reference: z.string().trim().max(120).nullable().optional()
});

const listAdjustmentsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  drugId: z.string().uuid().optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const adjustmentIdParamSchema = z.object({
  adjustmentId: z.string().uuid('A valid adjustment id is required')
});

const reviewSchema = z.object({
  comment: z.string().trim().max(500).nullable().optional()
});

const rejectSchema = z.object({
  comment: z.string().trim().min(3, 'A rejection reason is required').max(500)
});

const stockCountSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  lines: z
    .array(
      z.object({
        batchId: z.string().uuid('A valid batch id is required'),
        countedQuantity: z.coerce.number().min(0, 'Counted quantity cannot be negative').max(1000000000),
        reason: z.string().trim().max(500).nullable().optional(),
        reference: z.string().trim().max(120).nullable().optional()
      })
    )
    .min(1, 'Add at least one batch to count')
    .max(200)
});

const createReturnSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  reference: z.string().trim().max(120).nullable().optional(),
  items: z
    .array(
      z.object({
        batchId: z.string().uuid('A valid batch id is required'),
        quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000),
        disposition: z.enum(RETURN_DISPOSITIONS)
      })
    )
    .min(1, 'Add at least one item')
    .max(50)
});

const listReturnsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const returnIdParamSchema = z.object({
  returnId: z.string().uuid('A valid return id is required')
});

module.exports = {
  createAdjustmentSchema,
  listAdjustmentsQuerySchema,
  adjustmentIdParamSchema,
  reviewSchema,
  rejectSchema,
  stockCountSchema,
  createReturnSchema,
  listReturnsQuerySchema,
  returnIdParamSchema
};

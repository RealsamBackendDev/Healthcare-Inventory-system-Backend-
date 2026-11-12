const { z } = require('zod');

const listInventoryQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['in_stock', 'low_stock', 'out_of_stock']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const listBatchesQuerySchema = z.object({
  drugId: z.string().uuid().optional(),
  status: z
    .enum(['usable', 'expired', 'quarantined', 'blocked', 'recalled', 'returned_pending_inspection', 'destroyed'])
    .optional(),
  expiryStatus: z.enum(['usable', 'near_expiry', 'expired', 'no_expiry']).optional(),
  search: z.string().trim().max(120).optional(),
  nearExpiryDays: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const drugIdParamSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required')
});

const drugInventoryQuerySchema = z.object({
  nearExpiryDays: z.coerce.number().int().min(1).max(365).optional()
});

module.exports = {
  listInventoryQuerySchema,
  listBatchesQuerySchema,
  drugIdParamSchema,
  drugInventoryQuerySchema
};

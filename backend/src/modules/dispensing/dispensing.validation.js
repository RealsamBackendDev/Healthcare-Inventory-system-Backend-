const { z } = require('zod');

const dispensingItemSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000)
});

const createDispensingSchema = z.object({
  reference: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(dispensingItemSchema).min(1, 'Add at least one drug').max(50)
});

const listDispensingQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const dispensingIdParamSchema = z.object({
  dispensingId: z.string().uuid('A valid dispensing id is required')
});

module.exports = {
  createDispensingSchema,
  listDispensingQuerySchema,
  dispensingIdParamSchema
};

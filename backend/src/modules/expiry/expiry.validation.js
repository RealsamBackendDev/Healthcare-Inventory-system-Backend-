const { z } = require('zod');

const nearExpiryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const expiredQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

module.exports = {
  nearExpiryQuerySchema,
  expiredQuerySchema
};

const { z } = require('zod');

const reportQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx', 'excel', 'pdf']).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  drugId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  movementType: z
    .enum([
      'receipt',
      'import',
      'opening_stock',
      'dispensing',
      'adjustment',
      'return',
      'return_restock',
      'reconciliation'
    ])
    .optional(),
  status: z.string().trim().max(30).optional(),
  action: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120).optional(),
  days: z.coerce.number().int().min(1).max(365).optional()
});

module.exports = {
  reportQuerySchema
};

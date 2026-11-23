const { z } = require('zod');

const batchIdParamSchema = z.object({
  batchId: z.string().uuid('A valid batch id is required')
});

const confirmationSchema = z.object({
  outcome: z.enum(['restock', 'write_off'], {
    errorMap: () => ({ message: 'Choose whether the returned stock is usable or written off' })
  }),
  note: z.string().trim().min(3, 'Explain what happened to the returned stock').max(500)
});

module.exports = {
  batchIdParamSchema,
  confirmationSchema
};

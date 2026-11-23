const { z } = require('zod');

const batchIdParamSchema = z.object({
  batchId: z.string().uuid('A valid batch id is required')
});

const dispositionSchema = z.object({
  disposition: z.enum(['restocked', 'written_off', 'returned'], {
    errorMap: () => ({ message: 'Choose restocked, written off or returned to the sender' })
  }),
  quantity: z.coerce.number().positive('Enter the quantity being decided').max(1000000000),
  lossBearer: z
    .enum(['sender', 'receiver'], {
      errorMap: () => ({ message: 'Choose whether the sender or this facility bears the loss' })
    })
    .optional(),
  agreedWithName: z
    .string()
    .trim()
    .min(2, 'Enter the name of the person who agreed to this')
    .max(120),
  note: z.string().trim().min(3, 'Explain the decision in a few words').max(500)
});

const returnConfirmationSchema = z.object({
  outcome: z.enum(['restock', 'write_off'], {
    errorMap: () => ({ message: 'Choose whether the returned stock is usable or written off' })
  }),
  note: z.string().trim().min(3, 'Explain what happened to the returned stock').max(500)
});

module.exports = {
  batchIdParamSchema,
  dispositionSchema,
  returnConfirmationSchema
};

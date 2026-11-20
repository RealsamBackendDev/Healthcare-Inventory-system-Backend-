const { z } = require('zod');

const createRequestSchema = z.object({
  fromCentreId: z.string().uuid('Choose a facility to request from'),
  note: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        drugId: z.string().uuid('A valid drug id is required'),
        quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000)
      })
    )
    .min(1, 'Add at least one drug')
    .max(50)
});

const listRequestsQuerySchema = z.object({
  direction: z.enum(['outgoing', 'incoming']).optional()
});

const requestIdParamSchema = z.object({
  requestId: z.string().uuid('A valid request id is required')
});

const facilityIdParamSchema = z.object({
  facilityId: z.string().uuid('A valid facility id is required')
});

const decisionSchema = z.object({
  note: z.string().trim().max(500).nullable().optional()
});

const declineSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason for declining').max(500)
});

const receiveSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        transferItemId: z.string().uuid('A valid transfer line is required'),
        acceptedQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        damagedQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        missingQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        reason: z.string().trim().max(500).nullable().optional()
      })
    )
    .max(500)
    .optional()
});

const shortageParamSchema = z.object({
  requestId: z.string().uuid('A valid request id is required'),
  lineId: z.string().uuid('A valid shortage id is required')
});

const resolveShortageSchema = z.object({
  resolution: z.enum(['reissue', 'written_off'], {
    errorMap: () => ({ message: 'Choose whether the stock will be replaced or written off' })
  }),
  note: z.string().trim().min(3, 'Explain the decision in a few words').max(500)
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason for cancelling').max(500)
});

module.exports = {
  createRequestSchema,
  listRequestsQuerySchema,
  requestIdParamSchema,
  facilityIdParamSchema,
  decisionSchema,
  declineSchema,
  receiveSchema,
  shortageParamSchema,
  resolveShortageSchema,
  cancelSchema
};

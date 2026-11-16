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
  note: z.string().trim().max(500).nullable().optional()
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
  cancelSchema
};

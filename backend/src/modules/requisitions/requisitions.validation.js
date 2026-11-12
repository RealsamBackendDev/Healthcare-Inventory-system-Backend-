const { z } = require('zod');

const requisitionItemSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required'),
  requestedQuantity: z.coerce.number().positive('Requested quantity must be greater than zero').max(1000000000)
});

const createRequisitionSchema = z.object({
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(requisitionItemSchema).min(1, 'Add at least one drug').max(100)
});

const updateRequisitionSchema = z
  .object({
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z.array(requisitionItemSchema).min(1, 'Add at least one drug').max(100).optional()
  })
  .refine((value) => value.notes !== undefined || value.items !== undefined, {
    message: 'Provide notes or items to update'
  });

const listRequisitionsQuerySchema = z.object({
  status: z
    .enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed'])
    .optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const requisitionIdParamSchema = z.object({
  requisitionId: z.string().uuid('A valid requisition id is required')
});

const reviewRequisitionSchema = z.object({
  comment: z.string().trim().max(500).nullable().optional()
});

const rejectRequisitionSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required').max(500)
});

const cancelRequisitionSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional()
});

module.exports = {
  createRequisitionSchema,
  updateRequisitionSchema,
  listRequisitionsQuerySchema,
  requisitionIdParamSchema,
  reviewRequisitionSchema,
  rejectRequisitionSchema,
  cancelRequisitionSchema
};

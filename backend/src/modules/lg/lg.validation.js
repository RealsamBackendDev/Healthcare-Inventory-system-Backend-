const { z } = require('zod');

const receiptItemSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required'),
  batchNumber: z.string().trim().min(1, 'A batch number is required').max(60),
  expiryDate: z.string().trim().max(40).nullable().optional(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000),
  unitCost: z.coerce.number().min(0).max(1000000000).nullable().optional()
});

const createReceiptSchema = z.object({
  supplierName: z.string().trim().max(160).nullable().optional(),
  supplierReference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  thresholdApproved: z.boolean().optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
  items: z.array(receiptItemSchema).min(1, 'Add at least one batch').max(100)
});

const warehouseQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  drugId: z.string().uuid().optional()
});

const listRequisitionsQuerySchema = z.object({
  status: z
    .enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed'])
    .optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const requisitionIdParamSchema = z.object({
  requisitionId: z.string().uuid('A valid requisition id is required')
});

const dispatchIdParamSchema = z.object({
  dispatchId: z.string().uuid('A valid dispatch id is required')
});

const discrepancyIdParamSchema = z.object({
  itemId: z.string().uuid('A valid shortage id is required')
});

const resolveDiscrepancySchema = z.object({
  resolution: z.enum(['reissue', 'written_off'], {
    errorMap: () => ({ message: 'Choose whether the stock will be replaced or written off' })
  }),
  note: z.string().trim().min(3, 'Explain the decision in a few words').max(500)
});

const closeShortSchema = z.object({
  reason: z.string().trim().min(3, 'Explain why the balance cannot be supplied').max(500),
  items: z
    .array(
      z.object({
        drugId: z.string().uuid('A valid drug id is required'),
        quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000)
      })
    )
    .min(1, 'Add at least one drug to close')
    .max(100)
});

const approveRequisitionSchema = z.object({
  comment: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        drugId: z.string().uuid('A valid drug id is required'),
        approvedQuantity: z.coerce.number().min(0).max(1000000000)
      })
    )
    .max(200)
    .optional()
});

const rejectRequisitionSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required').max(500)
});

const dispatchSchema = z.object({
  notes: z.string().trim().max(1000).nullable().optional(),
  thresholdApproved: z.boolean().optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
  items: z
    .array(
      z.object({
        drugId: z.string().uuid('A valid drug id is required'),
        quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1000000000)
      })
    )
    .min(1)
    .max(100)
    .optional()
});

const listLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const warehouseMovementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  drugId: z.string().uuid().optional(),
  movementType: z.string().trim().max(40).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional()
});

const receiveDeliverySchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  dispatchId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        dispatchItemId: z.string().uuid('A valid dispatch line is required'),
        acceptedQuantity: z.coerce.number().min(0).max(1000000000),
        damagedQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        missingQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        rejectedQuantity: z.coerce.number().min(0).max(1000000000).optional(),
        reason: z.string().trim().max(500).nullable().optional()
      })
    )
    .max(200)
    .optional()
});

const transferIdParamSchema = z.object({
  transferId: z.string().uuid('A valid transfer id is required')
});

const facilityStockQuerySchema = z.object({
  facilityId: z.string().uuid('Pick a facility')
});

const createFacilityTransferSchema = z.object({
  fromCentreId: z.string().uuid('Pick the facility sending stock'),
  toCentreId: z.string().uuid('Pick the facility receiving stock'),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        drugId: z.string().uuid(),
        quantity: z.coerce.number().positive('Quantity must be greater than zero')
      })
    )
    .min(1, 'Add at least one drug')
    .max(100)
});

const listFacilityTransfersQuerySchema = z.object({
  status: z.enum(['in_transit', 'received', 'cancelled']).optional()
});

const cancelTransferSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500)
});

const receiveTransferSchema = z.object({
  note: z.string().trim().max(500).nullable().optional()
});

const orderIdParamSchema = z.object({
  orderId: z.string().uuid('A valid order id is required')
});

const createOrderSchema = z.object({
  consolidationId: z.string().uuid('Pick a finalized consolidation'),
  mode: z.enum(['gap', 'full']).optional(),
  notes: z.string().trim().max(500).nullable().optional()
});

const listOrdersQuerySchema = z.object({
  status: z
    .enum(['draft', 'submitted', 'fulfilled', 'partially_received', 'received', 'cancelled'])
    .optional()
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500)
});

const fulfillOrderSchema = z.object({
  note: z.string().trim().max(500).nullable().optional()
});

const orderReceiptSchema = z.object({
  supplierName: z.string().trim().max(160).nullable().optional(),
  supplierReference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(receiptItemSchema).min(1, 'Add at least one batch').max(100)
});

const consolidationIdParamSchema = z.object({
  consolidationId: z.string().uuid('A valid consolidation id is required')
});

const createConsolidationSchema = z.object({
  requisitionIds: z.array(z.string().uuid()).min(1, 'Select at least one request').max(100),
  notes: z.string().trim().max(500).nullable().optional()
});

const previewConsolidationSchema = z.object({
  requisitionIds: z.array(z.string().uuid()).min(1, 'Select at least one request').max(100)
});

const listConsolidationsQuerySchema = z.object({
  status: z.enum(['draft', 'finalized', 'cancelled']).optional()
});

const approvalIdParamSchema = z.object({
  approvalId: z.string().uuid('A valid approval id is required')
});

const listApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional()
});

const approveThresholdSchema = z.object({
  comment: z.string().trim().max(500).nullable().optional()
});

const rejectThresholdSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500)
});

const reportQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx', 'excel', 'pdf']).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  status: z.string().trim().max(30).optional()
});

module.exports = {
  createReceiptSchema,
  warehouseQuerySchema,
  listRequisitionsQuerySchema,
  requisitionIdParamSchema,
  dispatchIdParamSchema,
  discrepancyIdParamSchema,
  resolveDiscrepancySchema,
  closeShortSchema,
  approveRequisitionSchema,
  rejectRequisitionSchema,
  dispatchSchema,
  listLimitQuerySchema,
  warehouseMovementsQuerySchema,
  receiveDeliverySchema,
  reportQuerySchema,
  transferIdParamSchema,
  facilityStockQuerySchema,
  createFacilityTransferSchema,
  listFacilityTransfersQuerySchema,
  cancelTransferSchema,
  receiveTransferSchema,
  orderIdParamSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  cancelOrderSchema,
  fulfillOrderSchema,
  orderReceiptSchema,
  consolidationIdParamSchema,
  createConsolidationSchema,
  previewConsolidationSchema,
  listConsolidationsQuerySchema,
  approvalIdParamSchema,
  listApprovalsQuerySchema,
  approveThresholdSchema,
  rejectThresholdSchema
};

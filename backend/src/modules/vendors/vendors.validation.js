const { z } = require('zod');

const identifier = z
  .string()
  .trim()
  .max(60, 'Use 60 characters or fewer')
  .nullable()
  .optional();

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');

const vendorFields = {
  legalName: z.string().trim().min(2, 'Enter the registered vendor name').max(160),
  tradingName: z.string().trim().max(160).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().email('Enter a valid email address').max(160).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  tin: identifier,
  registrationNumber: identifier,
  bankName: z.string().trim().max(120).nullable().optional(),
  bankAccountName: z.string().trim().max(120).nullable().optional(),
  bankAccountNumber: z.string().trim().max(40).nullable().optional()
};

const vendorBodySchema = z.object({
  ...vendorFields,
  loginEmail: z.string().trim().email('Enter the email the vendor will sign in with').max(160),
  loginPassword: z.string().min(8, 'Use at least 8 characters').max(120),
  loginFullName: z.string().trim().max(120).nullable().optional()
});

const updateVendorSchema = z
  .object(vendorFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z
    .enum(['draft', 'pending_screening', 'screened', 'registered', 'suspended', 'excluded', 'all'])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const vendorIdParamSchema = z.object({
  vendorId: z.string().uuid('A valid vendor id is required')
});

const screenSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  notes: z.string().trim().max(1000).nullable().optional()
});

const registerSchema = z.object({
  decision: z.enum(['register', 'reject']),
  notes: z.string().trim().max(1000).nullable().optional()
});

const statusSchema = z.object({
  action: z.enum(['suspend', 'reinstate', 'exclude', 'reopen']),
  reason: z.string().trim().max(1000).nullable().optional()
});

const stockBodySchema = z.object({
  drugId: z.string().uuid('Pick a drug from the catalogue'),
  vendorSku: z.string().trim().max(60).nullable().optional(),
  batchNumber: z.string().trim().min(1, 'Enter the batch number').max(60),
  expiryDate: dateString,
  quantityAvailable: z.coerce.number().min(0, 'Quantity cannot be negative').max(100000000),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').max(100000000)
});

const stockUpdateSchema = z
  .object({
    vendorSku: z.string().trim().max(60).nullable().optional(),
    batchNumber: z.string().trim().min(1).max(60).optional(),
    expiryDate: dateString.optional(),
    quantityAvailable: z.coerce.number().min(0).max(100000000).optional(),
    unitPrice: z.coerce.number().min(0).max(100000000).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

const stockIdParamSchema = z.object({
  stockId: z.string().uuid('A valid stock line id is required')
});

const portalListQuerySchema = z.object({
  includeRetired: z.enum(['true', 'false']).optional()
});

const drugSearchQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

const listRequestsQuerySchema = z.object({
  status: z
    .enum(['draft', 'sent', 'accepted', 'confirmed', 'declined', 'cancelled', 'all'])
    .optional(),
  vendorId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const createRequestSchema = z.object({
  consolidationId: z.string().uuid('Pick a finalized consolidation'),
  vendorId: z.string().uuid('Pick a registered vendor'),
  mode: z.enum(['gap', 'full']).default('gap'),
  notes: z.string().trim().max(1000).nullable().optional()
});

const requestIdParamSchema = z.object({
  requestId: z.string().uuid('A valid request id is required')
});

const requestItemParamSchema = z.object({
  requestId: z.string().uuid('A valid request id is required'),
  itemId: z.string().uuid('A valid line id is required')
});

const cancelRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Explain why this request is being cancelled').max(1000)
});

const respondRequestSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid('A valid request line is required'),
        quantityConfirmed: z.coerce.number().min(0, 'Quantity cannot be negative').max(100000000),
        unitPrice: z.coerce.number().min(0, 'Price cannot be negative').max(100000000)
      })
    )
    .min(1, 'Answer at least one line')
});

const declineRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Explain why the request cannot be supplied').max(1000)
});

module.exports = {
  listRequestsQuerySchema,
  createRequestSchema,
  requestIdParamSchema,
  requestItemParamSchema,
  cancelRequestSchema,
  respondRequestSchema,
  declineRequestSchema,
  vendorBodySchema,
  updateVendorSchema,
  listQuerySchema,
  vendorIdParamSchema,
  screenSchema,
  registerSchema,
  statusSchema,
  stockBodySchema,
  stockUpdateSchema,
  stockIdParamSchema,
  portalListQuerySchema,
  drugSearchQuerySchema
};

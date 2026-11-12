const { z } = require('zod');

const drugBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Drug code is required')
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'Drug code may only contain letters, numbers, dots, dashes and underscores'),
  name: z.string().trim().min(1, 'Drug name is required').max(120),
  genericName: z.string().trim().max(120).nullable().optional(),
  brandName: z.string().trim().max(120).nullable().optional(),
  strength: z.string().trim().max(60).nullable().optional(),
  dosageForm: z.string().trim().min(1, 'Dosage form is required').max(60),
  unitOfMeasure: z.string().trim().min(1, 'Unit of measure is required').max(30),
  minimumStockLevel: z.coerce.number().min(0, 'Minimum stock level cannot be negative').max(100000000)
});

const createDrugSchema = drugBodySchema;

const updateDrugSchema = drugBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update'
  });

const setActiveSchema = z.object({
  isActive: z.boolean()
});

const listDrugsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const drugIdParamSchema = z.object({
  drugId: z.string().uuid('A valid drug id is required')
});

module.exports = {
  createDrugSchema,
  updateDrugSchema,
  setActiveSchema,
  listDrugsQuerySchema,
  drugIdParamSchema
};

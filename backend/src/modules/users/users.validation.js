const { z } = require('zod');

const listUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const createUserSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('A valid email address is required').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  roleCode: z.enum(['ADMINISTRATOR', 'STAFF'])
});

const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    isActive: z.boolean().optional(),
    roleCode: z.enum(['ADMINISTRATOR', 'STAFF']).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update'
  });

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

const updateSettingsSchema = z
  .object({
    staffAdjustmentQuantityThreshold: z.number().min(0).max(1000000).optional(),
    staffAdjustmentValueThreshold: z.number().min(0).max(1000000000).optional(),
    nearExpiryDays: z.number().int().min(1).max(365).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update'
  });

const userIdParamSchema = z.object({
  userId: z.string().uuid('A valid user id is required')
});

module.exports = {
  listUsersQuerySchema,
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  updateSettingsSchema,
  userIdParamSchema
};

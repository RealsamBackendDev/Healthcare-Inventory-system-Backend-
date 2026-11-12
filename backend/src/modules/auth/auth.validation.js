const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required').max(255),
  password: z.string().min(1, 'Password is required').max(128)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password is too long')
});

module.exports = {
  loginSchema,
  changePasswordSchema
};

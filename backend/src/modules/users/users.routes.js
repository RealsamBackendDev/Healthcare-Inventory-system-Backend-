const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./users.controller');
const schemas = require('./users.validation');

const router = express.Router();

router.get(
  '/users',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ query: schemas.listUsersQuerySchema }),
  controller.listUsers
);

router.get('/users/roles', authenticate, authorize(PERMISSIONS.USERS_MANAGE), controller.listRoles);

router.post(
  '/users',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ body: schemas.createUserSchema }),
  controller.createUser
);

router.patch(
  '/users/:userId',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ params: schemas.userIdParamSchema, body: schemas.updateUserSchema }),
  controller.updateUser
);

router.post(
  '/users/:userId/reset-password',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ params: schemas.userIdParamSchema, body: schemas.resetPasswordSchema }),
  controller.resetPassword
);

router.get('/settings', authenticate, controller.getSettings);

router.put(
  '/settings',
  authenticate,
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: schemas.updateSettingsSchema }),
  controller.updateSettings
);

module.exports = router;

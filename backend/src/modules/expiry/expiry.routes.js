const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireRole } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS, ROLES } = require('../../shared/constants');
const controller = require('./expiry.controller');
const schemas = require('./expiry.validation');

const router = express.Router();

router.get(
  '/expiry/near-expiry',
  authenticate,
  authorize(PERMISSIONS.EXPIRY_VIEW),
  validate({ query: schemas.nearExpiryQuerySchema }),
  controller.getNearExpiry
);

router.get(
  '/expiry/expired',
  authenticate,
  authorize(PERMISSIONS.EXPIRY_VIEW),
  validate({ query: schemas.expiredQuerySchema }),
  controller.getExpired
);

router.get('/expiry/summary', authenticate, authorize(PERMISSIONS.EXPIRY_VIEW), controller.getSummary);

router.post(
  '/expiry/refresh',
  authenticate,
  requireRole(ROLES.ADMINISTRATOR),
  controller.refresh
);

module.exports = router;

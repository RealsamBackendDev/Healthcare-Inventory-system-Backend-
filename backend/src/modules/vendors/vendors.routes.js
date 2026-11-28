const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireLocalGovernmentScope } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./vendors.controller');
const schemas = require('./vendors.validation');

const router = express.Router();

router.use(authenticate, requireLocalGovernmentScope);

router.get(
  '/vendors',
  authorize(PERMISSIONS.VENDORS_VIEW),
  validate({ query: schemas.listQuerySchema }),
  controller.listVendors
);

router.post(
  '/vendors',
  authorize(PERMISSIONS.VENDORS_MANAGE),
  validate({ body: schemas.vendorBodySchema }),
  controller.createVendor
);

router.get(
  '/vendors/:vendorId',
  authorize(PERMISSIONS.VENDORS_VIEW),
  validate({ params: schemas.vendorIdParamSchema }),
  controller.getVendor
);

router.patch(
  '/vendors/:vendorId',
  authorize(PERMISSIONS.VENDORS_MANAGE),
  validate({ params: schemas.vendorIdParamSchema, body: schemas.updateVendorSchema }),
  controller.updateVendor
);

router.post(
  '/vendors/:vendorId/screen',
  authorize(PERMISSIONS.VENDORS_SCREEN),
  validate({ params: schemas.vendorIdParamSchema, body: schemas.screenSchema }),
  controller.screenVendor
);

router.post(
  '/vendors/:vendorId/register',
  authorize(PERMISSIONS.VENDORS_REGISTER),
  validate({ params: schemas.vendorIdParamSchema, body: schemas.registerSchema }),
  controller.registerVendor
);

router.post(
  '/vendors/:vendorId/status',
  authorize(PERMISSIONS.VENDORS_MANAGE),
  validate({ params: schemas.vendorIdParamSchema, body: schemas.statusSchema }),
  controller.changeVendorStatus
);

module.exports = router;

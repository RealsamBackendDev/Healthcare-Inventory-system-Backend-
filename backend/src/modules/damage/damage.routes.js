const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./damage.controller');
const schemas = require('./damage.validation');

const router = express.Router();

router.get(
  '/stock/damage',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  controller.listDamagedStock
);

router.get(
  '/stock/damage/returns',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  controller.listReturnsInTransit
);

router.post(
  '/stock/damage/:batchId/disposition',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_CREATE),
  validate({ params: schemas.batchIdParamSchema, body: schemas.dispositionSchema }),
  controller.recordDisposition
);

router.post(
  '/stock/damage/returns/:batchId/receive',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_CREATE),
  validate({ params: schemas.batchIdParamSchema, body: schemas.returnConfirmationSchema }),
  controller.confirmReturn
);

module.exports = router;

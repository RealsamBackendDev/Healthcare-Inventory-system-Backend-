const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireLocalGovernmentScope } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./warehouse-returns.controller');
const schemas = require('./warehouse-returns.validation');

const router = express.Router();

router.get(
  '/lg/warehouse/returns',
  authenticate,
  requireLocalGovernmentScope,
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  controller.listWarehouseReturns
);

router.post(
  '/lg/warehouse/returns/:batchId/receive',
  authenticate,
  requireLocalGovernmentScope,
  authorize(PERMISSIONS.WAREHOUSE_RECEIVE),
  validate({ params: schemas.batchIdParamSchema, body: schemas.confirmationSchema }),
  controller.confirmWarehouseReturn
);

module.exports = router;

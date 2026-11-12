const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./adjustments.controller');
const schemas = require('./adjustments.validation');

const router = express.Router();

router.get(
  '/adjustments',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listAdjustmentsQuerySchema }),
  controller.listAdjustments
);

router.post(
  '/adjustments',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_CREATE),
  validate({ body: schemas.createAdjustmentSchema }),
  controller.createAdjustment
);

router.post(
  '/adjustments/stock-count',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_CREATE),
  validate({ body: schemas.stockCountSchema }),
  controller.createStockCount
);

router.get(
  '/adjustments/:adjustmentId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.adjustmentIdParamSchema }),
  controller.getAdjustment
);

router.post(
  '/adjustments/:adjustmentId/approve',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_APPROVE),
  validate({ params: schemas.adjustmentIdParamSchema, body: schemas.reviewSchema }),
  controller.approveAdjustment
);

router.post(
  '/adjustments/:adjustmentId/reject',
  authenticate,
  authorize(PERMISSIONS.ADJUSTMENTS_APPROVE),
  validate({ params: schemas.adjustmentIdParamSchema, body: schemas.rejectSchema }),
  controller.rejectAdjustment
);

router.get(
  '/returns',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listReturnsQuerySchema }),
  controller.listReturns
);

router.post(
  '/returns',
  authenticate,
  authorize(PERMISSIONS.RETURNS_REQUEST),
  validate({ body: schemas.createReturnSchema }),
  controller.createReturn
);

router.get(
  '/returns/:returnId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.returnIdParamSchema }),
  controller.getReturn
);

router.post(
  '/returns/:returnId/approve',
  authenticate,
  authorize(PERMISSIONS.RETURNS_APPROVE),
  validate({ params: schemas.returnIdParamSchema, body: schemas.reviewSchema }),
  controller.approveReturn
);

router.post(
  '/returns/:returnId/reject',
  authenticate,
  authorize(PERMISSIONS.RETURNS_APPROVE),
  validate({ params: schemas.returnIdParamSchema, body: schemas.rejectSchema }),
  controller.rejectReturn
);

module.exports = router;

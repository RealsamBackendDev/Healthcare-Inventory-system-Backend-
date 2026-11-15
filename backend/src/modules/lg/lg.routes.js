const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./lg.controller');
const schemas = require('./lg.validation');

const router = express.Router();

router.get(
  '/warehouse',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouse
);

router.get(
  '/warehouse/batches',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouseBatches
);

router.get(
  '/warehouse/receipts',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listReceipts
);

router.post(
  '/warehouse/receipts',
  authenticate,
  authorize(PERMISSIONS.WAREHOUSE_RECEIVE),
  validate({ body: schemas.createReceiptSchema }),
  controller.createReceipt
);

router.get(
  '/requisitions',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listRequisitionsQuerySchema }),
  controller.listRequisitions
);

router.get(
  '/requisitions/:requisitionId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.getRequisition
);

router.post(
  '/requisitions/:requisitionId/approve',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.approveRequisitionSchema }),
  controller.approveRequisition
);

router.post(
  '/requisitions/:requisitionId/reject',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.rejectRequisitionSchema }),
  controller.rejectRequisition
);

router.post(
  '/requisitions/:requisitionId/dispatch',
  authenticate,
  authorize(PERMISSIONS.DISPATCHES_POST),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.dispatchSchema }),
  controller.dispatchRequisition
);

router.get(
  '/dispatches',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listDispatches
);

router.get(
  '/dispatches/:dispatchId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.dispatchIdParamSchema }),
  controller.getDispatch
);

module.exports = router;

const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./inventory.controller');
const schemas = require('./inventory.validation');

const router = express.Router();

router.get(
  '/inventory',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listInventoryQuerySchema }),
  controller.listInventory
);

router.get(
  '/inventory/batches',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listBatchesQuerySchema }),
  controller.listBatches
);

router.get(
  '/inventory/drugs/:drugId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.drugIdParamSchema, query: schemas.drugInventoryQuerySchema }),
  controller.getDrugInventory
);

module.exports = router;

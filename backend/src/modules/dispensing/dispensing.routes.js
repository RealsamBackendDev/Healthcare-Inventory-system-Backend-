const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./dispensing.controller');
const schemas = require('./dispensing.validation');

const router = express.Router();

router.post(
  '/dispensing',
  authenticate,
  authorize(PERMISSIONS.STOCK_DISPENSE),
  validate({ body: schemas.createDispensingSchema }),
  controller.dispense
);

router.get(
  '/dispensing',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listDispensingQuerySchema }),
  controller.listDispensing
);

router.get(
  '/dispensing/:dispensingId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.dispensingIdParamSchema }),
  controller.getDispensing
);

module.exports = router;

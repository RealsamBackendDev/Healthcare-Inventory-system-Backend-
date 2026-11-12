const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./drugs.controller');
const schemas = require('./drugs.validation');

const router = express.Router();

router.get(
  '/drugs',
  authenticate,
  authorize(PERMISSIONS.DRUGS_VIEW),
  validate({ query: schemas.listDrugsQuerySchema }),
  controller.listDrugs
);

router.get(
  '/drugs/:drugId',
  authenticate,
  authorize(PERMISSIONS.DRUGS_VIEW),
  validate({ params: schemas.drugIdParamSchema }),
  controller.getDrug
);

router.post(
  '/drugs',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ body: schemas.createDrugSchema }),
  controller.createDrug
);

router.patch(
  '/drugs/:drugId',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ params: schemas.drugIdParamSchema, body: schemas.updateDrugSchema }),
  controller.updateDrug
);

router.post(
  '/drugs/:drugId/status',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ params: schemas.drugIdParamSchema, body: schemas.setActiveSchema }),
  controller.setDrugActiveState
);

module.exports = router;

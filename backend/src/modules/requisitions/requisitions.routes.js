const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./requisitions.controller');
const schemas = require('./requisitions.validation');

const router = express.Router();

router.get(
  '/requisitions',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ query: schemas.listRequisitionsQuerySchema }),
  controller.listRequisitions
);

router.get(
  '/requisitions/shortages',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  controller.getShortages
);

router.post(
  '/requisitions/suggestions',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  controller.generateSuggestions
);

router.post(
  '/requisitions',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ body: schemas.createRequisitionSchema }),
  controller.createRequisition
);

router.get(
  '/requisitions/:requisitionId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.getRequisition
);

router.patch(
  '/requisitions/:requisitionId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.updateRequisitionSchema }),
  controller.updateRequisition
);

router.delete(
  '/requisitions/:requisitionId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.deleteRequisition
);

router.post(
  '/requisitions/:requisitionId/submit',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.submitRequisition
);

router.post(
  '/requisitions/:requisitionId/approve',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_APPROVE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.reviewRequisitionSchema }),
  controller.approveRequisition
);

router.post(
  '/requisitions/:requisitionId/reject',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_APPROVE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.rejectRequisitionSchema }),
  controller.rejectRequisition
);

router.post(
  '/requisitions/:requisitionId/cancel',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.cancelRequisitionSchema }),
  controller.cancelRequisition
);

router.post(
  '/requisitions/:requisitionId/close',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_APPROVE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.reviewRequisitionSchema }),
  controller.closeRequisition
);

router.post(
  '/requisitions/:requisitionId/amend',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.amendRequisition
);

module.exports = router;

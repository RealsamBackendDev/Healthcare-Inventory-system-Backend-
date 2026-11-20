const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./transfers.controller');
const schemas = require('./transfers.validation');

const router = express.Router();

router.get(
  '/transfers/neighbours',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  controller.listNeighbours
);

router.get(
  '/transfers/neighbours/:facilityId/stock',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.facilityIdParamSchema }),
  controller.neighbourStock
);

router.get(
  '/transfers/requests',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ query: schemas.listRequestsQuerySchema }),
  controller.listRequests
);

router.post(
  '/transfers/requests',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ body: schemas.createRequestSchema }),
  controller.createRequest
);

router.get(
  '/transfers/requests/:requestId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requestIdParamSchema }),
  controller.getRequest
);

router.post(
  '/transfers/requests/:requestId/approve',
  authenticate,
  authorize(PERMISSIONS.STOCK_DISPENSE),
  validate({ params: schemas.requestIdParamSchema, body: schemas.decisionSchema }),
  controller.approveRequest
);

router.post(
  '/transfers/requests/:requestId/decline',
  authenticate,
  authorize(PERMISSIONS.STOCK_DISPENSE),
  validate({ params: schemas.requestIdParamSchema, body: schemas.declineSchema }),
  controller.declineRequest
);

router.post(
  '/transfers/requests/:requestId/receive',
  authenticate,
  authorize(PERMISSIONS.STOCK_RECEIVE),
  validate({ params: schemas.requestIdParamSchema, body: schemas.receiveSchema }),
  controller.receiveRequest
);

router.post(
  '/transfers/requests/:requestId/shortages/:lineId/resolve',
  authenticate,
  authorize(PERMISSIONS.STOCK_RECEIVE),
  validate({
    params: schemas.shortageParamSchema,
    body: schemas.resolveShortageSchema
  }),
  controller.resolveShortage
);

router.post(
  '/transfers/requests/:requestId/cancel',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_CREATE),
  validate({ params: schemas.requestIdParamSchema, body: schemas.cancelSchema }),
  controller.cancelRequest
);

module.exports = router;

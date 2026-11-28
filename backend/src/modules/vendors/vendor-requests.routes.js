const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireLocalGovernmentScope } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./vendor-requests.controller');
const schemas = require('./vendors.validation');

const router = express.Router();

router.use(authenticate, requireLocalGovernmentScope);

router.get(
  '/vendor-requests',
  authorize(PERMISSIONS.VENDOR_REQUESTS_VIEW),
  validate({ query: schemas.listRequestsQuerySchema }),
  controller.listRequests
);

router.get(
  '/vendor-requests/candidates',
  authorize(PERMISSIONS.VENDOR_REQUESTS_MANAGE),
  controller.listCandidates
);

router.post(
  '/vendor-requests',
  authorize(PERMISSIONS.VENDOR_REQUESTS_MANAGE),
  validate({ body: schemas.createRequestSchema }),
  controller.createRequest
);

router.get(
  '/vendor-requests/:requestId',
  authorize(PERMISSIONS.VENDOR_REQUESTS_VIEW),
  validate({ params: schemas.requestIdParamSchema }),
  controller.getRequest
);

router.post(
  '/vendor-requests/:requestId/send',
  authorize(PERMISSIONS.VENDOR_REQUESTS_MANAGE),
  validate({ params: schemas.requestIdParamSchema }),
  controller.sendRequest
);

router.delete(
  '/vendor-requests/:requestId/items/:itemId',
  authorize(PERMISSIONS.VENDOR_REQUESTS_MANAGE),
  validate({ params: schemas.requestItemParamSchema }),
  controller.removeRequestItem
);

router.post(
  '/vendor-requests/:requestId/cancel',
  authorize(PERMISSIONS.VENDOR_REQUESTS_MANAGE),
  validate({ params: schemas.requestIdParamSchema, body: schemas.cancelRequestSchema }),
  controller.cancelRequest
);

module.exports = router;

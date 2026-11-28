const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./vendor-portal.controller');
const requestsController = require('./vendor-requests.controller');
const schemas = require('./vendors.validation');

const router = express.Router();

router.use(authenticate);

router.get('/profile', authorize(PERMISSIONS.VENDOR_STOCK_VIEW), controller.getProfile);

router.get(
  '/stock',
  authorize(PERMISSIONS.VENDOR_STOCK_VIEW),
  validate({ query: schemas.portalListQuerySchema }),
  controller.listStock
);

router.post(
  '/stock',
  authorize(PERMISSIONS.VENDOR_STOCK_MANAGE),
  validate({ body: schemas.stockBodySchema }),
  controller.createStock
);

router.patch(
  '/stock/:stockId',
  authorize(PERMISSIONS.VENDOR_STOCK_MANAGE),
  validate({ params: schemas.stockIdParamSchema, body: schemas.stockUpdateSchema }),
  controller.updateStock
);

router.get(
  '/drugs',
  authorize(PERMISSIONS.VENDOR_STOCK_VIEW),
  validate({ query: schemas.drugSearchQuerySchema }),
  controller.listDrugs
);

router.post(
  '/submit',
  authorize(PERMISSIONS.VENDOR_STOCK_MANAGE),
  controller.submitForScreening
);

router.get(
  '/requests',
  authorize(PERMISSIONS.VENDOR_PORTAL_REQUESTS_VIEW),
  validate({ query: schemas.listRequestsQuerySchema }),
  requestsController.listPortalRequests
);

router.get(
  '/requests/:requestId',
  authorize(PERMISSIONS.VENDOR_PORTAL_REQUESTS_VIEW),
  validate({ params: schemas.requestIdParamSchema }),
  requestsController.getPortalRequest
);

router.post(
  '/requests/:requestId/accept',
  authorize(PERMISSIONS.VENDOR_PORTAL_REQUESTS_RESPOND),
  validate({ params: schemas.requestIdParamSchema }),
  requestsController.acceptPortalRequest
);

router.post(
  '/requests/:requestId/respond',
  authorize(PERMISSIONS.VENDOR_PORTAL_REQUESTS_RESPOND),
  validate({ params: schemas.requestIdParamSchema, body: schemas.respondRequestSchema }),
  requestsController.respondPortalRequest
);

router.post(
  '/requests/:requestId/decline',
  authorize(PERMISSIONS.VENDOR_PORTAL_REQUESTS_RESPOND),
  validate({ params: schemas.requestIdParamSchema, body: schemas.declineRequestSchema }),
  requestsController.declinePortalRequest
);

module.exports = router;

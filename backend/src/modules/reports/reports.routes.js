const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./reports.controller');
const schemas = require('./reports.validation');

const router = express.Router();

router.get('/reports/dashboard', authenticate, authorize(PERMISSIONS.REPORTS_VIEW), controller.getDashboard);
router.get('/reports/options', authenticate, authorize(PERMISSIONS.REPORTS_VIEW), controller.getOptions);

router.get(
  '/reports/inventory',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.inventory
);

router.get(
  '/reports/stock-movements',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.stockMovements
);

router.get(
  '/reports/dispensing',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.dispensing
);

router.get(
  '/reports/expiry',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.expiry
);

router.get(
  '/reports/requisitions',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.requisitions
);

router.get(
  '/reports/adjustments',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.adjustments
);

router.get(
  '/reports/returns',
  authenticate,
  authorize(PERMISSIONS.REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.returns
);

router.get(
  '/reports/audit',
  authenticate,
  authorize(PERMISSIONS.AUDIT_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.audit
);

module.exports = router;

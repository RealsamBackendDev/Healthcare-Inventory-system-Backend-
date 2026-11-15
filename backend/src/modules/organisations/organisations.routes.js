const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireRole } = require('../../middleware/authorize');
const { ROLES, PERMISSIONS } = require('../../shared/constants');
const controller = require('./organisations.controller');

const router = express.Router();

router.get('/organisations/me', authenticate, controller.getActiveCentre);
router.get('/organisations/structure', authenticate, requireRole(ROLES.ADMINISTRATOR), controller.getStructure);
router.get(
  '/organisations/lg',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  controller.getLocalGovernment
);

module.exports = router;

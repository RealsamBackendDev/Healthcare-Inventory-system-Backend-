const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./organisations.controller');

const router = express.Router();

router.get('/organisations/me', authenticate, controller.getActiveCentre);
router.get(
  '/organisations/structure',
  authenticate,
  authorize(PERMISSIONS.ORGANISATIONS_MANAGE),
  controller.getStructure
);
router.get(
  '/organisations/lg',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  controller.getLocalGovernment
);

module.exports = router;

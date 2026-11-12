const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { requireRole } = require('../../middleware/authorize');
const { ROLES } = require('../../shared/constants');
const controller = require('./organisations.controller');

const router = express.Router();

router.get('/organisations/me', authenticate, controller.getActiveCentre);
router.get('/organisations/structure', authenticate, requireRole(ROLES.ADMINISTRATOR), controller.getStructure);

module.exports = router;

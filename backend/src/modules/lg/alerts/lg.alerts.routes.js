const express = require('express');
const authenticate = require('../../../middleware/authenticate');
const { authorize } = require('../../../middleware/authorize');
const asyncHandler = require('../../../shared/utils/asyncHandler');
const { PERMISSIONS } = require('../../../shared/constants');
const service = require('./lg.alerts.service');

const router = express.Router();

router.get(
  '/alerts',
  authenticate,
  authorize(PERMISSIONS.NOTIFICATIONS_VIEW),
  asyncHandler(async (req, res) => {
    const result = await service.getAlerts({ scope: req.scope });
    res.json({ success: true, data: result });
  })
);

module.exports = router;

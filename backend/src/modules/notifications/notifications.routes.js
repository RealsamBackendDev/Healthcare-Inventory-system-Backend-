const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./notifications.controller');

const router = express.Router();

router.get(
  '/notifications',
  authenticate,
  authorize(PERMISSIONS.NOTIFICATIONS_VIEW),
  controller.listNotifications
);

router.get(
  '/notifications/unread-count',
  authenticate,
  authorize(PERMISSIONS.NOTIFICATIONS_VIEW),
  controller.getUnreadCount
);

router.patch(
  '/notifications/:notificationId/read',
  authenticate,
  authorize(PERMISSIONS.NOTIFICATIONS_VIEW),
  controller.markRead
);

router.post(
  '/notifications/read-all',
  authenticate,
  authorize(PERMISSIONS.NOTIFICATIONS_VIEW),
  controller.markAllRead
);

module.exports = router;

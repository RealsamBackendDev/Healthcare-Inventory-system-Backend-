const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./notifications.service');

const listNotifications = asyncHandler(async (req, res) => {
  const result = await service.listNotifications(
    req.scope.healthcareCentreId,
    req.user.id,
    req.query
  );
  res.json({ success: true, data: result });
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await service.getUnreadCount(req.scope.healthcareCentreId, req.user.id);
  res.json({ success: true, data: result });
});

const markRead = asyncHandler(async (req, res) => {
  const result = await service.markRead(
    req.scope.healthcareCentreId,
    req.user.id,
    req.params.notificationId
  );
  res.json({ success: true, data: result });
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await service.markAllRead(req.scope.healthcareCentreId, req.user.id);
  res.json({ success: true, data: result });
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead
};

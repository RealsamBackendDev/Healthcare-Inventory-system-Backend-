const { NotFoundError } = require('../../shared/errors/AppError');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const repository = require('./notifications.repository');

const mapNotification = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  message: row.message,
  entityType: row.entity_type,
  entityId: row.entity_id,
  isRead: row.is_read,
  createdAt: row.created_at
});

const listNotifications = async (healthcareCentreId, userId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  let isRead;
  if (filters.isRead === 'unread') {
    isRead = false;
  } else if (filters.isRead === 'read') {
    isRead = true;
  }

  const { rows, total } = await repository.listForUser({
    healthcareCentreId,
    userId,
    isRead,
    limit,
    offset
  });

  return {
    items: rows.map(mapNotification),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const getUnreadCount = async (healthcareCentreId, userId) => ({
  unread: await repository.countUnread(healthcareCentreId, userId)
});

const markRead = async (healthcareCentreId, userId, notificationId) => {
  const updated = await repository.markRead(healthcareCentreId, userId, notificationId);
  if (!updated) {
    throw new NotFoundError('Notification was not found');
  }
  return { id: updated.id, isRead: updated.is_read };
};

const markAllRead = async (healthcareCentreId, userId) => {
  const updated = await repository.markAllRead(healthcareCentreId, userId);
  return { updated };
};

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead
};

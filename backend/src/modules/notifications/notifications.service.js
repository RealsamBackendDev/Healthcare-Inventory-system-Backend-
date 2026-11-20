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

const scopeOf = (scope) => ({
  healthcareCentreId: scope.healthcareCentreId || null,
  localGovernmentId: scope.localGovernmentId || null
});

const listNotifications = async (scope, userId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  let isRead;
  if (filters.isRead === 'unread') {
    isRead = false;
  } else if (filters.isRead === 'read') {
    isRead = true;
  }

  const { rows, total } = await repository.listForUser({
    ...scopeOf(scope),
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

const getUnreadCount = async (scope, userId) => ({
  unread: await repository.countUnread({ ...scopeOf(scope), userId })
});

const markRead = async (scope, userId, notificationId) => {
  const updated = await repository.markRead({
    ...scopeOf(scope),
    userId,
    notificationId
  });
  if (!updated) {
    throw new NotFoundError('Notification was not found');
  }
  return { id: updated.id, isRead: updated.is_read };
};

const markAllRead = async (scope, userId) => {
  const updated = await repository.markAllRead({ ...scopeOf(scope), userId });
  return { updated };
};

module.exports = {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead
};

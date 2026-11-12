const { query } = require('../../database/connection');

const listForUser = async ({ healthcareCentreId, userId, isRead, limit, offset }) => {
  const params = [healthcareCentreId, userId, isRead === undefined ? null : isRead];
  const { rows } = await query(
    `SELECT id, type, title, message, entity_type, entity_id, is_read, created_at
       FROM notifications
      WHERE healthcare_centre_id = $1
        AND user_id = $2
        AND ($3::boolean IS NULL OR is_read = $3)
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM notifications
      WHERE healthcare_centre_id = $1
        AND user_id = $2
        AND ($3::boolean IS NULL OR is_read = $3)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const countUnread = async (healthcareCentreId, userId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS total FROM notifications WHERE healthcare_centre_id = $1 AND user_id = $2 AND is_read = FALSE',
    [healthcareCentreId, userId]
  );
  return rows[0].total;
};

const markRead = async (healthcareCentreId, userId, notificationId) => {
  const { rows } = await query(
    `UPDATE notifications
        SET is_read = TRUE
      WHERE healthcare_centre_id = $1 AND user_id = $2 AND id = $3
      RETURNING id, is_read`,
    [healthcareCentreId, userId, notificationId]
  );
  return rows[0] || null;
};

const markAllRead = async (healthcareCentreId, userId) => {
  const { rowCount } = await query(
    'UPDATE notifications SET is_read = TRUE WHERE healthcare_centre_id = $1 AND user_id = $2 AND is_read = FALSE',
    [healthcareCentreId, userId]
  );
  return rowCount;
};

module.exports = {
  listForUser,
  countUnread,
  markRead,
  markAllRead
};

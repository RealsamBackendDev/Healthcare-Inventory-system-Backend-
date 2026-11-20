const { query } = require('../../database/connection');

const scopeCondition = `(
  ($1::uuid IS NOT NULL AND n.healthcare_centre_id = $1)
  OR ($1::uuid IS NULL AND n.healthcare_centre_id IS NULL AND n.local_government_id = $2)
)`;

const listForUser = async ({
  healthcareCentreId,
  localGovernmentId,
  userId,
  isRead,
  limit,
  offset
}) => {
  const params = [healthcareCentreId, localGovernmentId, userId, isRead === undefined ? null : isRead];
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.message, n.entity_type, n.entity_id, n.is_read, n.created_at
       FROM notifications n
      WHERE ${scopeCondition}
        AND n.user_id = $3
        AND ($4::boolean IS NULL OR n.is_read = $4)
      ORDER BY n.created_at DESC
      LIMIT $5 OFFSET $6`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM notifications n
      WHERE ${scopeCondition}
        AND n.user_id = $3
        AND ($4::boolean IS NULL OR n.is_read = $4)`,
    params
  );

  return { rows, total: countRows[0].total };
};

const countUnread = async ({ healthcareCentreId, localGovernmentId, userId }) => {
  const { rows } = await query(
    `SELECT count(*)::int AS total
       FROM notifications n
      WHERE ${scopeCondition}
        AND n.user_id = $3
        AND n.is_read = FALSE`,
    [healthcareCentreId, localGovernmentId, userId]
  );
  return rows[0].total;
};

const markRead = async ({ healthcareCentreId, localGovernmentId, userId, notificationId }) => {
  const { rows } = await query(
    `UPDATE notifications n
        SET is_read = TRUE
      WHERE ${scopeCondition}
        AND n.user_id = $3
        AND n.id = $4
      RETURNING n.id, n.is_read`,
    [healthcareCentreId, localGovernmentId, userId, notificationId]
  );
  return rows[0] || null;
};

const markAllRead = async ({ healthcareCentreId, localGovernmentId, userId }) => {
  const { rowCount } = await query(
    `UPDATE notifications n
        SET is_read = TRUE
      WHERE ${scopeCondition}
        AND n.user_id = $3
        AND n.is_read = FALSE`,
    [healthcareCentreId, localGovernmentId, userId]
  );
  return rowCount;
};

module.exports = {
  listForUser,
  countUnread,
  markRead,
  markAllRead
};

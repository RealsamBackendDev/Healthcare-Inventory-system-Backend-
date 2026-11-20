const notifyCentreMembers = async (
  client,
  { healthcareCentreId, excludeUserId, type, title, message, entityType, entityId }
) => {
  if (!healthcareCentreId) {
    return 0;
  }

  const { rowCount } = await client.query(
    `INSERT INTO notifications (healthcare_centre_id, user_id, type, title, message, entity_type, entity_id)
     SELECT DISTINCT $1::uuid, m.user_id, $2::text, $3::text, $4::text, $5::text, $6::text
       FROM user_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.healthcare_centre_id = $1
        AND m.is_active = TRUE
        AND u.is_active = TRUE
        AND ($7::uuid IS NULL OR m.user_id <> $7)`,
    [healthcareCentreId, type, title, message, entityType, entityId, excludeUserId || null]
  );

  return rowCount;
};

const notifyLocalGovernmentMembers = async (
  client,
  { localGovernmentId, permissionCode, excludeUserId, type, title, message, entityType, entityId }
) => {
  if (!localGovernmentId) {
    return 0;
  }

  const { rowCount } = await client.query(
    `INSERT INTO notifications (local_government_id, user_id, type, title, message, entity_type, entity_id)
     SELECT DISTINCT $1::uuid, m.user_id, $2::text, $3::text, $4::text, $5::text, $6::text
       FROM user_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.local_government_id = $1
        AND m.healthcare_centre_id IS NULL
        AND m.is_active = TRUE
        AND u.is_active = TRUE
        AND (
          $7::text IS NULL
          OR EXISTS (
            SELECT 1
              FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = m.role_id
               AND p.code = $7
          )
        )
        AND ($8::uuid IS NULL OR m.user_id <> $8)`,
    [
      localGovernmentId,
      type,
      title,
      message,
      entityType,
      entityId,
      permissionCode || null,
      excludeUserId || null
    ]
  );

  return rowCount;
};

module.exports = {
  notifyCentreMembers,
  notifyLocalGovernmentMembers
};

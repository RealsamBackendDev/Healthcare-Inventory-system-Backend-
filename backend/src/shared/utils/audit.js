const recordAudit = async (
  client,
  {
    healthcareCentreId,
    actor,
    action,
    entityType,
    entityId = null,
    summary = null,
    previousValues = null,
    newValues = null,
    reason = null
  }
) => {
  await client.query(
    `INSERT INTO audit_events
       (healthcare_centre_id, actor_user_id, actor_full_name, action, entity_type, entity_id, summary, previous_values, new_values, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      healthcareCentreId,
      actor ? actor.id : null,
      actor ? actor.fullName : 'System',
      action,
      entityType,
      entityId,
      summary,
      previousValues ? JSON.stringify(previousValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      reason
    ]
  );
};

module.exports = {
  recordAudit
};

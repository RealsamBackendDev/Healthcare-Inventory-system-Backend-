const recordAudit = async (
  client,
  {
    healthcareCentreId = null,
    localGovernmentId = null,
    vendorId = null,
    actor,
    actorRoleCode = null,
    actorScopeType = null,
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
       (healthcare_centre_id, local_government_id, vendor_id, actor_user_id, actor_full_name, actor_role_code,
        actor_scope_type, action, entity_type, entity_id, summary, previous_values, new_values, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)`,
    [
      healthcareCentreId || null,
      localGovernmentId || null,
      vendorId || null,
      actor ? actor.id : null,
      actor ? actor.fullName : 'System',
      actorRoleCode,
      actorScopeType,
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

ALTER TABLE audit_events ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD COLUMN actor_role_code TEXT;
ALTER TABLE audit_events ADD COLUMN actor_scope_type TEXT;

UPDATE audit_events ae
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = ae.healthcare_centre_id;

ALTER TABLE audit_events ALTER COLUMN healthcare_centre_id DROP NOT NULL;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR local_government_id IS NOT NULL
);

CREATE INDEX audit_events_lg_created_idx ON audit_events (local_government_id, created_at DESC);

ALTER TABLE notifications ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;

UPDATE notifications n
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = n.healthcare_centre_id;

ALTER TABLE notifications ALTER COLUMN healthcare_centre_id DROP NOT NULL;
ALTER TABLE notifications ADD CONSTRAINT notifications_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR local_government_id IS NOT NULL
);

CREATE INDEX notifications_lg_created_idx ON notifications (local_government_id, created_at DESC);

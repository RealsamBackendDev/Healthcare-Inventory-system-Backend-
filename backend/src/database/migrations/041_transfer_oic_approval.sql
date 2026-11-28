ALTER TABLE facility_transfers DROP CONSTRAINT facility_transfers_status_check;

ALTER TABLE facility_transfers ADD CONSTRAINT facility_transfers_status_check CHECK (
    status IN ('pending_approval', 'requested', 'in_transit', 'partially_received', 'received', 'cancelled', 'declined')
);

ALTER TABLE facility_transfers ADD COLUMN endorsed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE facility_transfers ADD COLUMN endorsed_by_name TEXT;
ALTER TABLE facility_transfers ADD COLUMN endorsed_at TIMESTAMPTZ;

CREATE INDEX facility_transfers_oic_approval_idx
    ON facility_transfers (to_healthcare_centre_id, status, created_at DESC);

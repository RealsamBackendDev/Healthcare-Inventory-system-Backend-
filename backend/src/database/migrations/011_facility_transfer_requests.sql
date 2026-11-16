ALTER TABLE facility_transfers DROP CONSTRAINT facility_transfers_status_check;

ALTER TABLE facility_transfers ADD CONSTRAINT facility_transfers_status_check CHECK (
    status IN ('requested', 'in_transit', 'received', 'cancelled', 'declined')
);

ALTER TABLE facility_transfers ADD COLUMN request_note TEXT;
ALTER TABLE facility_transfers ADD COLUMN requested_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE facility_transfers ADD COLUMN requested_by_name TEXT;
ALTER TABLE facility_transfers ADD COLUMN requested_at TIMESTAMPTZ;
ALTER TABLE facility_transfers ADD COLUMN decided_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE facility_transfers ADD COLUMN decided_by_name TEXT;
ALTER TABLE facility_transfers ADD COLUMN decided_at TIMESTAMPTZ;
ALTER TABLE facility_transfers ADD COLUMN decision_note TEXT;

CREATE INDEX facility_transfers_source_status_idx
    ON facility_transfers (from_healthcare_centre_id, status, created_at DESC);

CREATE TABLE facility_transfer_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES facility_transfers(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX facility_transfer_request_items_transfer_idx
    ON facility_transfer_request_items (transfer_id);

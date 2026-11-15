CREATE TABLE facility_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    transfer_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_transit',
    from_healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    from_centre_name TEXT NOT NULL,
    to_healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    to_centre_name TEXT NOT NULL,
    notes TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    total_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    received_by_name TEXT,
    received_at TIMESTAMPTZ,
    received_note TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_by_name TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT facility_transfers_status_check CHECK (status IN ('in_transit', 'received', 'cancelled')),
    CONSTRAINT facility_transfers_centres_check CHECK (from_healthcare_centre_id <> to_healthcare_centre_id),
    CONSTRAINT facility_transfers_number_unique UNIQUE (local_government_id, transfer_number)
);

CREATE TABLE facility_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES facility_transfers(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    source_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_cost DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX facility_transfers_lg_status_idx
    ON facility_transfers (local_government_id, status, created_at DESC);
CREATE INDEX facility_transfers_destination_idx
    ON facility_transfers (to_healthcare_centre_id, status, created_at DESC);
CREATE INDEX facility_transfer_items_transfer_idx
    ON facility_transfer_items (transfer_id);

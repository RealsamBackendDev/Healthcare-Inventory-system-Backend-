CREATE TABLE damage_dispositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_number TEXT NOT NULL,
    source_reference TEXT,
    quantity NUMERIC(14,4) NOT NULL,
    disposition TEXT NOT NULL,
    loss_bearer TEXT NOT NULL,
    replacement_owed BOOLEAN NOT NULL DEFAULT FALSE,
    agreed_with_name TEXT NOT NULL,
    note TEXT NOT NULL,
    restocked_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT damage_dispositions_quantity_check CHECK (quantity > 0),
    CONSTRAINT damage_dispositions_disposition_check
        CHECK (disposition IN ('restocked', 'written_off', 'returned')),
    CONSTRAINT damage_dispositions_loss_bearer_check
        CHECK (loss_bearer IN ('sender', 'receiver'))
);

CREATE INDEX damage_dispositions_batch_idx
    ON damage_dispositions (batch_id, created_at DESC);

CREATE INDEX damage_dispositions_centre_idx
    ON damage_dispositions (healthcare_centre_id, created_at DESC);

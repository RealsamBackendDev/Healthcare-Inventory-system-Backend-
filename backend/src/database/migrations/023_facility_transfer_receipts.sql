ALTER TABLE facility_transfers DROP CONSTRAINT facility_transfers_status_check;

ALTER TABLE facility_transfers ADD CONSTRAINT facility_transfers_status_check CHECK (
    status IN ('requested', 'in_transit', 'partially_received', 'received', 'cancelled', 'declined')
);

ALTER TABLE facility_transfer_items
    ADD COLUMN accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN discrepancy_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN discrepancy_resolution TEXT,
    ADD COLUMN discrepancy_note TEXT,
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD COLUMN resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN resolved_by_name TEXT;

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_quantities_check
    CHECK (accepted_quantity >= 0 AND damaged_quantity >= 0 AND missing_quantity >= 0);

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_balance_check
    CHECK (accepted_quantity + damaged_quantity + missing_quantity <= quantity + 0.0005);

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_discrepancy_status_check
    CHECK (discrepancy_status IN ('none', 'open', 'resolved'));

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_discrepancy_resolution_check
    CHECK (discrepancy_resolution IS NULL OR discrepancy_resolution IN ('reissue', 'written_off'));

UPDATE facility_transfer_items ti
   SET accepted_quantity = ti.quantity
  FROM facility_transfers t
 WHERE t.id = ti.transfer_id
   AND t.status = 'received';

CREATE INDEX facility_transfer_items_discrepancy_idx
    ON facility_transfer_items (discrepancy_status)
 WHERE discrepancy_status = 'open';

CREATE TABLE facility_transfer_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    transfer_id UUID NOT NULL REFERENCES facility_transfers(id) ON DELETE RESTRICT,
    note TEXT,
    accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    received_by_name TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX facility_transfer_receipts_transfer_idx
    ON facility_transfer_receipts (transfer_id, received_at);

CREATE INDEX facility_transfer_receipts_centre_idx
    ON facility_transfer_receipts (healthcare_centre_id, received_at DESC);

CREATE TABLE facility_transfer_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES facility_transfer_receipts(id) ON DELETE CASCADE,
    transfer_item_id UUID NOT NULL REFERENCES facility_transfer_items(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX facility_transfer_receipt_items_receipt_idx
    ON facility_transfer_receipt_items (receipt_id);

CREATE INDEX facility_transfer_receipt_items_line_idx
    ON facility_transfer_receipt_items (transfer_item_id);

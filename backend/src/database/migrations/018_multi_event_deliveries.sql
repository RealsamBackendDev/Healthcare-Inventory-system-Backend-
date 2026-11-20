ALTER TABLE lg_dispatch_items
    DROP CONSTRAINT lg_dispatch_items_balance_check;

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_balance_check
    CHECK (accepted_quantity + damaged_quantity + missing_quantity <= quantity + 0.0005);

ALTER TABLE lg_dispatch_receipts
    DROP CONSTRAINT IF EXISTS lg_dispatch_receipts_dispatch_id_key;

ALTER TABLE lg_dispatch_receipts
    ADD COLUMN accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX lg_dispatch_receipts_dispatch_idx
    ON lg_dispatch_receipts (dispatch_id, received_at);

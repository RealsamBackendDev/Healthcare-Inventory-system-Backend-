ALTER TABLE facility_transfer_items
    ADD COLUMN replacement_authorised_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN replacement_transfer_id UUID REFERENCES facility_transfers(id) ON DELETE SET NULL;

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_replacement_check
    CHECK (replacement_authorised_quantity >= 0);

CREATE INDEX facility_transfer_items_replacement_idx
    ON facility_transfer_items (replacement_transfer_id)
 WHERE replacement_transfer_id IS NOT NULL;

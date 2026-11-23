ALTER TABLE facility_transfer_items
    DROP CONSTRAINT facility_transfer_items_balance_check;

ALTER TABLE facility_transfer_items
    DROP CONSTRAINT facility_transfer_items_quantities_check;

ALTER TABLE facility_transfer_items
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_quantities_check
    CHECK (accepted_quantity >= 0 AND damaged_quantity >= 0 AND missing_quantity >= 0
        AND rejected_quantity >= 0);

ALTER TABLE facility_transfer_items
    ADD CONSTRAINT facility_transfer_items_balance_check
    CHECK (accepted_quantity + damaged_quantity + missing_quantity + rejected_quantity
        <= quantity + 0.0005);

ALTER TABLE facility_transfer_receipts
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE facility_transfer_receipt_items
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

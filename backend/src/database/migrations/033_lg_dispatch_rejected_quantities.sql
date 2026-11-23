ALTER TABLE lg_dispatch_items
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE lg_dispatch_items
    DROP CONSTRAINT lg_dispatch_items_quantities_check;

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_quantities_check
    CHECK (
        accepted_quantity >= 0
        AND damaged_quantity >= 0
        AND missing_quantity >= 0
        AND rejected_quantity >= 0
    );

ALTER TABLE lg_dispatch_items
    DROP CONSTRAINT lg_dispatch_items_balance_check;

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_balance_check
    CHECK (accepted_quantity + damaged_quantity + missing_quantity + rejected_quantity <= quantity + 0.0005);

ALTER TABLE lg_dispatches
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE lg_dispatch_receipts
    ADD COLUMN rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0;

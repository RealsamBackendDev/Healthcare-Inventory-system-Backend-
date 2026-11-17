ALTER TABLE requisition_items
    ADD COLUMN approved_quantity DOUBLE PRECISION;

UPDATE requisition_items
   SET approved_quantity = requested_quantity
 WHERE approved_quantity IS NULL;

ALTER TABLE requisition_items
    ALTER COLUMN approved_quantity SET NOT NULL;

ALTER TABLE requisition_items
    ADD CONSTRAINT requisition_items_approved_check
    CHECK (approved_quantity >= 0 AND approved_quantity <= requested_quantity);

ALTER TABLE lg_dispatch_items
    ADD COLUMN accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN discrepancy_reason TEXT;

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_quantities_check
    CHECK (accepted_quantity >= 0 AND damaged_quantity >= 0 AND missing_quantity >= 0);

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_balance_check
    CHECK (
        accepted_quantity = 0
        OR abs(accepted_quantity + damaged_quantity + missing_quantity - quantity) < 0.0005
    );

ALTER TABLE lg_dispatches
    ADD COLUMN received_note TEXT,
    ADD COLUMN accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN damaged_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN missing_quantity DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE lg_dispatches
    DROP CONSTRAINT lg_dispatches_status_check;

ALTER TABLE lg_dispatches
    ADD CONSTRAINT lg_dispatches_status_check
    CHECK (status IN ('dispatched', 'partially_received', 'received', 'cancelled'));

DROP INDEX IF EXISTS lg_dispatches_requisition_unique;

CREATE INDEX lg_dispatches_requisition_idx
    ON lg_dispatches (requisition_id)
 WHERE status <> 'cancelled';

CREATE TABLE lg_dispatch_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    dispatch_id UUID NOT NULL UNIQUE REFERENCES lg_dispatches(id) ON DELETE RESTRICT,
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE RESTRICT,
    note TEXT,
    received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    received_by_name TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lg_dispatch_receipts_centre_idx
    ON lg_dispatch_receipts (healthcare_centre_id, received_at DESC);

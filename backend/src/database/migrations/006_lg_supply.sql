ALTER TABLE batches ADD COLUMN stock_location_id UUID REFERENCES stock_locations(id) ON DELETE RESTRICT;
ALTER TABLE batches ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;

UPDATE batches b
   SET stock_location_id = sl.id,
       local_government_id = sl.local_government_id
  FROM stock_locations sl
 WHERE sl.healthcare_centre_id = b.healthcare_centre_id
   AND sl.location_type = 'facility';

ALTER TABLE batches ALTER COLUMN stock_location_id SET NOT NULL;
ALTER TABLE batches ALTER COLUMN healthcare_centre_id DROP NOT NULL;

ALTER TABLE batches ADD CONSTRAINT batches_owner_check CHECK (
    local_government_id IS NOT NULL
    AND (healthcare_centre_id IS NULL OR healthcare_centre_id IS NOT NULL)
);

CREATE INDEX batches_location_drug_idx ON batches (stock_location_id, drug_id, status);
CREATE UNIQUE INDEX batches_location_batch_unique ON batches (stock_location_id, drug_id, batch_number);

ALTER TABLE requisitions ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;

UPDATE requisitions r
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = r.healthcare_centre_id;

ALTER TABLE requisitions ALTER COLUMN local_government_id SET NOT NULL;

CREATE INDEX requisitions_lg_status_idx ON requisitions (local_government_id, status, created_at DESC);

CREATE TABLE lg_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    receipt_number TEXT NOT NULL,
    supplier_name TEXT,
    supplier_reference TEXT,
    notes TEXT,
    received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    received_by_name TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lg_receipts_number_unique UNIQUE (receipt_number)
);

CREATE TABLE lg_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES lg_receipts(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_cost DOUBLE PRECISION CHECK (unit_cost IS NULL OR unit_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lg_receipt_items_receipt_idx ON lg_receipt_items (receipt_id);

CREATE TABLE lg_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE RESTRICT,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    dispatch_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'dispatched',
    notes TEXT,
    dispatched_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_by_name TEXT NOT NULL,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    received_by_name TEXT,
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lg_dispatches_status_check CHECK (status IN ('dispatched', 'received', 'cancelled')),
    CONSTRAINT lg_dispatches_number_unique UNIQUE (dispatch_number)
);

CREATE UNIQUE INDEX lg_dispatches_requisition_unique ON lg_dispatches (requisition_id) WHERE status <> 'cancelled';
CREATE INDEX lg_dispatches_lg_status_idx ON lg_dispatches (local_government_id, status, dispatched_at DESC);

CREATE TABLE lg_dispatch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES lg_dispatches(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_cost DOUBLE PRECISION CHECK (unit_cost IS NULL OR unit_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lg_dispatch_items_dispatch_idx ON lg_dispatch_items (dispatch_id);

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (
    movement_type IN ('receipt', 'import', 'opening_stock', 'dispensing', 'adjustment', 'return',
                      'return_restock', 'reconciliation', 'transfer_in', 'transfer_out')
);

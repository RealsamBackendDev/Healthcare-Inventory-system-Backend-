CREATE TABLE lg_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    consolidation_id UUID REFERENCES lg_consolidations(id) ON DELETE SET NULL,
    consolidation_reference TEXT,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    total_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    submitted_by_name TEXT,
    submitted_at TIMESTAMPTZ,
    fulfilled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    fulfilled_by_name TEXT,
    fulfilled_at TIMESTAMPTZ,
    fulfilled_note TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_by_name TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT lg_orders_status_check CHECK (status IN ('draft', 'submitted', 'fulfilled', 'cancelled')),
    CONSTRAINT lg_orders_number_unique UNIQUE (local_government_id, order_number)
);

CREATE TABLE lg_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES lg_orders(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    requested_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    warehouse_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lg_orders_lg_status_idx ON lg_orders (local_government_id, status, created_at DESC);
CREATE INDEX lg_order_items_order_idx ON lg_order_items (order_id);

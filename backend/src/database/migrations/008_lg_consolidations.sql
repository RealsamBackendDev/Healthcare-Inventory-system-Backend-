CREATE TABLE lg_consolidations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    total_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    gap_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    finalized_by_name TEXT,
    finalized_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_by_name TEXT,
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT lg_consolidations_status_check CHECK (status IN ('draft', 'finalized', 'cancelled')),
    CONSTRAINT lg_consolidations_reference_unique UNIQUE (local_government_id, reference)
);

CREATE TABLE lg_consolidation_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidation_id UUID NOT NULL REFERENCES lg_consolidations(id) ON DELETE CASCADE,
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    centre_name TEXT NOT NULL,
    requisition_number TEXT NOT NULL,
    requested_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lg_consolidation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidation_id UUID NOT NULL REFERENCES lg_consolidations(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    requested_quantity DOUBLE PRECISION NOT NULL,
    warehouse_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    gap_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lg_consolidations_lg_status_idx
    ON lg_consolidations (local_government_id, status, created_at DESC);

CREATE UNIQUE INDEX lg_consolidation_sources_requisition_unique
    ON lg_consolidation_sources (requisition_id);

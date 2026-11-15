CREATE TABLE lg_threshold_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    approval_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    summary TEXT,
    payload JSONB NOT NULL,
    quantity DOUBLE PRECISION,
    value DOUBLE PRECISION,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_by_name TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_by_name TEXT,
    decided_at TIMESTAMPTZ,
    reason TEXT,
    reference_type TEXT,
    reference_id UUID,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lg_threshold_approvals_type_check CHECK (approval_type IN ('receipt', 'dispatch')),
    CONSTRAINT lg_threshold_approvals_status_check CHECK (
        status IN ('pending', 'processing', 'approved', 'rejected', 'expired')
    )
);

CREATE INDEX lg_threshold_approvals_lg_status_idx
    ON lg_threshold_approvals (local_government_id, status, requested_at DESC);

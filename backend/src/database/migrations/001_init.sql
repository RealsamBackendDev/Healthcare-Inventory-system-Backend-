CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT states_code_unique UNIQUE (code)
);

CREATE TABLE local_governments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT local_governments_code_unique UNIQUE (state_id, code)
);

CREATE TABLE healthcare_centres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT healthcare_centres_code_unique UNIQUE (code)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
    locked_until TIMESTAMPTZ,
    token_version INTEGER NOT NULL DEFAULT 0,
    password_changed_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT roles_code_unique UNIQUE (code)
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT permissions_code_unique UNIQUE (code)
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_memberships_unique UNIQUE (user_id, healthcare_centre_id)
);

CREATE INDEX user_memberships_user_idx ON user_memberships (user_id);

CREATE TABLE drugs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    generic_name TEXT,
    brand_name TEXT,
    strength TEXT,
    dosage_form TEXT NOT NULL,
    unit_of_measure TEXT NOT NULL,
    minimum_stock_level DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (minimum_stock_level >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX drugs_centre_code_active_unique ON drugs (healthcare_centre_id, lower(code)) WHERE is_active;
CREATE INDEX drugs_centre_active_idx ON drugs (healthcare_centre_id, is_active, name);

CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit_cost DOUBLE PRECISION CHECK (unit_cost IS NULL OR unit_cost >= 0),
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_reference TEXT,
    status TEXT NOT NULL DEFAULT 'usable',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT batches_status_check CHECK (status IN ('usable', 'expired', 'quarantined', 'blocked', 'recalled', 'returned_pending_inspection', 'destroyed'))
);

CREATE UNIQUE INDEX batches_identity_unique ON batches (healthcare_centre_id, drug_id, lower(batch_number));
CREATE INDEX batches_centre_status_idx ON batches (healthcare_centre_id, status, expiry_date);
CREATE INDEX batches_drug_idx ON batches (drug_id);

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    receipt_reference TEXT,
    supplier TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_items INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipts_centre_created_idx ON receipts (healthcare_centre_id, created_at DESC);

CREATE TABLE receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    batch_number TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_cost DOUBLE PRECISION CHECK (unit_cost IS NULL OR unit_cost >= 0),
    expiry_date DATE,
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispensing_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    reference TEXT,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dispensing_records_centre_created_idx ON dispensing_records (healthcare_centre_id, created_at DESC);

CREATE TABLE dispensing_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispensing_record_id UUID NOT NULL REFERENCES dispensing_records(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    adjustment_type TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity <> 0),
    reason TEXT NOT NULL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_by_name TEXT NOT NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_by_name TEXT,
    reviewed_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    review_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_adjustments_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT stock_adjustments_type_check CHECK (adjustment_type IN ('physical_count', 'damage', 'loss', 'correction', 'expiry_writeoff', 'other'))
);

CREATE INDEX stock_adjustments_centre_status_idx ON stock_adjustments (healthcare_centre_id, status, created_at DESC);

CREATE TABLE return_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    request_number TEXT NOT NULL,
    reason TEXT NOT NULL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_by_name TEXT NOT NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_by_name TEXT,
    reviewed_at TIMESTAMPTZ,
    review_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT return_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT return_requests_number_unique UNIQUE (request_number)
);

CREATE INDEX return_requests_centre_status_idx ON return_requests (healthcare_centre_id, status, created_at DESC);

CREATE TABLE return_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    disposition TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT return_request_items_disposition_check CHECK (disposition IN ('return_to_supplier', 'quarantined', 'blocked', 'destroyed', 'restock_usable'))
);

CREATE TABLE requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    requisition_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'manual',
    notes TEXT,
    review_reason TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_name TEXT NOT NULL,
    submitted_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_by_name TEXT,
    reviewed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    parent_requisition_id UUID REFERENCES requisitions(id) ON DELETE SET NULL,
    superseded_by_requisition_id UUID REFERENCES requisitions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT requisitions_status_check CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed')),
    CONSTRAINT requisitions_source_check CHECK (source IN ('manual', 'automatic')),
    CONSTRAINT requisitions_number_unique UNIQUE (requisition_number)
);

CREATE INDEX requisitions_centre_status_idx ON requisitions (healthcare_centre_id, status, created_at DESC);

CREATE TABLE requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    requested_quantity DOUBLE PRECISION NOT NULL CHECK (requested_quantity > 0),
    is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX requisition_items_requisition_idx ON requisition_items (requisition_id);

CREATE TABLE requisition_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_full_name TEXT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX requisition_events_requisition_idx ON requisition_events (requisition_id, created_at);

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity <> 0),
    reason TEXT,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_full_name TEXT NOT NULL,
    source_reference TEXT,
    receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    dispensing_record_id UUID REFERENCES dispensing_records(id) ON DELETE SET NULL,
    adjustment_id UUID REFERENCES stock_adjustments(id) ON DELETE SET NULL,
    return_request_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
    requisition_id UUID REFERENCES requisitions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_movements_type_check CHECK (movement_type IN ('receipt', 'import', 'opening_stock', 'dispensing', 'adjustment', 'return', 'return_restock', 'reconciliation'))
);

CREATE INDEX stock_movements_centre_created_idx ON stock_movements (healthcare_centre_id, created_at DESC);
CREATE INDEX stock_movements_drug_created_idx ON stock_movements (drug_id, created_at DESC);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_centre_created_idx ON notifications (healthcare_centre_id, created_at DESC);
CREATE INDEX notifications_user_read_idx ON notifications (user_id, is_read);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_full_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT,
    previous_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_centre_created_idx ON audit_events (healthcare_centre_id, created_at DESC);

CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT system_settings_key_unique UNIQUE (healthcare_centre_id, key)
);

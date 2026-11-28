CREATE SEQUENCE vendor_request_seq START 1;

CREATE TABLE vendor_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    consolidation_id UUID REFERENCES lg_consolidations(id) ON DELETE SET NULL,
    consolidation_reference TEXT,
    reference TEXT NOT NULL DEFAULT ('VREQ-' || lpad(nextval('vendor_request_seq')::text, 5, '0')),
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    requested_quantity NUMERIC(14, 2) NOT NULL DEFAULT 0,
    confirmed_quantity NUMERIC(14, 2) NOT NULL DEFAULT 0,
    confirmed_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_by_name TEXT,
    sent_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_by_name TEXT,
    accepted_at TIMESTAMPTZ,
    responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    responded_by_name TEXT,
    responded_at TIMESTAMPTZ,
    vendor_note TEXT,
    declined_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_by_name TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT vendor_requests_status_check CHECK (
        status IN ('draft', 'sent', 'accepted', 'confirmed', 'declined', 'cancelled')
    )
);

CREATE UNIQUE INDEX vendor_requests_reference_unique ON vendor_requests (local_government_id, reference);
CREATE INDEX vendor_requests_lg_status_idx ON vendor_requests (local_government_id, status, created_at DESC);
CREATE INDEX vendor_requests_vendor_status_idx ON vendor_requests (vendor_id, status, created_at DESC);

CREATE TABLE vendor_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES vendor_requests(id) ON DELETE CASCADE,
    state_drug_id UUID NOT NULL REFERENCES state_drugs(id) ON DELETE RESTRICT,
    drug_name TEXT NOT NULL,
    strength TEXT,
    dosage_form TEXT,
    unit_of_measure TEXT,
    requested_quantity NUMERIC(14, 2) NOT NULL,
    confirmed_quantity NUMERIC(14, 2),
    unit_price NUMERIC(14, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendor_request_items_quantity_check CHECK (requested_quantity > 0),
    CONSTRAINT vendor_request_items_confirmed_check CHECK (
        confirmed_quantity IS NULL OR confirmed_quantity >= 0
    ),
    CONSTRAINT vendor_request_items_price_check CHECK (unit_price IS NULL OR unit_price >= 0)
);

CREATE INDEX vendor_request_items_request_idx ON vendor_request_items (request_id);

CREATE TABLE vendor_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES vendor_requests(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    notes TEXT,
    actor_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vendor_request_events_request_idx ON vendor_request_events (request_id, created_at);

INSERT INTO permissions (code, name, description)
VALUES
    ('vendor_requests.view', 'View vendor requests', 'View requests sent to vendors and what the vendor answered'),
    ('vendor_requests.manage', 'Send vendor requests', 'Build a request from collated demand, send it to a vendor and cancel it'),
    ('vendor_portal.requests_view', 'View supply requests', 'View requests local governments have sent to the vendor account'),
    ('vendor_portal.requests_respond', 'Answer supply requests', 'Accept, adjust, confirm or decline supply requests')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('vendor_requests.view', 'vendor_requests.manage')
 WHERE r.code IN ('LG_ADMIN', 'LG_INVENTORY_OFFICER', 'SYSTEM_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('vendor_portal.requests_view', 'vendor_portal.requests_respond')
 WHERE r.code = 'VENDOR'
ON CONFLICT DO NOTHING;

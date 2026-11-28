CREATE TABLE state_drugs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    code TEXT,
    name TEXT NOT NULL,
    generic_name TEXT,
    strength TEXT,
    dosage_form TEXT NOT NULL,
    unit_of_measure TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX state_drugs_identity_unique ON state_drugs (
    state_id,
    lower(name),
    coalesce(lower(strength), ''),
    lower(dosage_form),
    lower(unit_of_measure)
);

CREATE INDEX state_drugs_state_active_idx ON state_drugs (state_id, is_active, name);

INSERT INTO state_drugs (state_id, code, name, generic_name, strength, dosage_form, unit_of_measure)
SELECT DISTINCT ON (
           lg.state_id,
           lower(d.name),
           coalesce(lower(d.strength), ''),
           lower(d.dosage_form),
           lower(d.unit_of_measure)
       )
       lg.state_id, d.code, d.name, d.generic_name, d.strength, d.dosage_form, d.unit_of_measure
  FROM drugs d
  JOIN local_governments lg ON lg.id = d.local_government_id
 ORDER BY lg.state_id,
          lower(d.name),
          coalesce(lower(d.strength), ''),
          lower(d.dosage_form),
          lower(d.unit_of_measure),
          d.created_at;

ALTER TABLE drugs ADD COLUMN state_drug_id UUID REFERENCES state_drugs(id) ON DELETE SET NULL;

UPDATE drugs d
   SET state_drug_id = sd.id
  FROM local_governments lg
  JOIN state_drugs sd ON sd.state_id = lg.state_id
 WHERE lg.id = d.local_government_id
   AND lower(sd.name) = lower(d.name)
   AND coalesce(lower(sd.strength), '') = coalesce(lower(d.strength), '')
   AND lower(sd.dosage_form) = lower(d.dosage_form)
   AND lower(sd.unit_of_measure) = lower(d.unit_of_measure);

CREATE INDEX drugs_state_drug_idx ON drugs (state_drug_id);

CREATE SEQUENCE vendor_code_seq START 1;

CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    vendor_code TEXT NOT NULL DEFAULT ('VEN-' || lpad(nextval('vendor_code_seq')::text, 5, '0')),
    legal_name TEXT NOT NULL,
    trading_name TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    address TEXT,
    tin TEXT,
    registration_number TEXT,
    bank_name TEXT,
    bank_account_name TEXT,
    bank_account_number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    status_reason TEXT,
    screening_notes TEXT,
    screened_by UUID REFERENCES users(id) ON DELETE SET NULL,
    screened_by_name TEXT,
    screened_at TIMESTAMPTZ,
    registered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    registered_by_name TEXT,
    registered_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendors_status_check CHECK (
        status IN ('draft', 'pending_screening', 'screened', 'registered', 'suspended', 'excluded')
    )
);

CREATE UNIQUE INDEX vendors_code_unique ON vendors (vendor_code);
CREATE UNIQUE INDEX vendors_name_unique ON vendors (state_id, lower(legal_name));
CREATE UNIQUE INDEX vendors_tin_unique ON vendors (state_id, lower(tin)) WHERE tin IS NOT NULL;
CREATE INDEX vendors_state_status_idx ON vendors (state_id, status, legal_name);

CREATE TABLE vendor_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
    from_status TEXT,
    to_status TEXT NOT NULL,
    reason TEXT,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vendor_status_history_vendor_idx ON vendor_status_history (vendor_id, created_at DESC);

CREATE TABLE vendor_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vendor_users_user_unique ON vendor_users (user_id);
CREATE INDEX vendor_users_vendor_idx ON vendor_users (vendor_id, is_active);

CREATE TABLE vendor_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    state_drug_id UUID NOT NULL REFERENCES state_drugs(id) ON DELETE RESTRICT,
    vendor_sku TEXT,
    batch_number TEXT NOT NULL,
    expiry_date DATE NOT NULL,
    quantity_available NUMERIC(14, 2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(14, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendor_stock_quantity_check CHECK (quantity_available >= 0),
    CONSTRAINT vendor_stock_price_check CHECK (unit_price >= 0)
);

CREATE UNIQUE INDEX vendor_stock_identity_unique ON vendor_stock (
    vendor_id,
    state_drug_id,
    lower(batch_number),
    expiry_date
);

CREATE INDEX vendor_stock_vendor_idx ON vendor_stock (vendor_id, is_active, expiry_date);
CREATE INDEX vendor_stock_drug_idx ON vendor_stock (state_drug_id, is_active);

ALTER TABLE audit_events ADD COLUMN vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_scope_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR local_government_id IS NOT NULL OR vendor_id IS NOT NULL
);

ALTER TABLE notifications ADD COLUMN vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_scope_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR local_government_id IS NOT NULL OR vendor_id IS NOT NULL
);

CREATE INDEX notifications_vendor_created_idx ON notifications (vendor_id, created_at DESC);

INSERT INTO permissions (code, name, description)
VALUES
    ('vendors.view', 'View vendors', 'View registered vendors and the stock they hold'),
    ('vendors.manage', 'Manage vendors', 'Create vendor profiles and vendor logins, edit details and change standing'),
    ('vendors.screen', 'Screen vendors', 'Screen a vendor submission and confirm or return it'),
    ('vendors.register', 'Register vendors', 'Register a screened vendor so local governments can buy from it'),
    ('vendor_portal.stock_view', 'View own stock', 'View the stock published by the vendor account'),
    ('vendor_portal.stock_manage', 'Maintain own stock', 'Add, edit and retire stock lines for the vendor account')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO roles (code, name, description)
VALUES ('VENDOR', 'Vendor', 'Supplier portal account for a vendor registered on the system')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('vendors.view', 'vendors.manage', 'vendors.screen', 'vendors.register')
 WHERE r.code = 'SYSTEM_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'vendors.view'
 WHERE r.code IN ('LG_ADMIN', 'LG_INVENTORY_OFFICER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('vendor_portal.stock_view', 'vendor_portal.stock_manage')
 WHERE r.code = 'VENDOR'
ON CONFLICT DO NOTHING;

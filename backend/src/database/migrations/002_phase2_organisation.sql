CREATE TABLE stock_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_government_id UUID NOT NULL REFERENCES local_governments(id) ON DELETE RESTRICT,
    healthcare_centre_id UUID REFERENCES healthcare_centres(id) ON DELETE RESTRICT,
    location_type TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_locations_type_check CHECK (location_type IN ('lg_warehouse', 'facility')),
    CONSTRAINT stock_locations_owner_check CHECK (
        (location_type = 'lg_warehouse' AND healthcare_centre_id IS NULL)
        OR (location_type = 'facility' AND healthcare_centre_id IS NOT NULL)
    ),
    CONSTRAINT stock_locations_code_unique UNIQUE (local_government_id, code)
);

CREATE INDEX stock_locations_lg_type_idx ON stock_locations (local_government_id, location_type, is_active);
CREATE UNIQUE INDEX stock_locations_warehouse_unique ON stock_locations (local_government_id) WHERE location_type = 'lg_warehouse';
CREATE UNIQUE INDEX stock_locations_facility_unique ON stock_locations (healthcare_centre_id) WHERE location_type = 'facility';

INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
SELECT hc.local_government_id, hc.id, 'facility', hc.name || ' Main Store', hc.code || '-MAIN'
  FROM healthcare_centres hc
 WHERE NOT EXISTS (
       SELECT 1 FROM stock_locations sl WHERE sl.healthcare_centre_id = hc.id
 );

INSERT INTO stock_locations (local_government_id, location_type, name, code)
SELECT lg.id, 'lg_warehouse', lg.name || ' LG Medical Warehouse', lg.code || '-WAREHOUSE'
  FROM local_governments lg
 WHERE NOT EXISTS (
       SELECT 1 FROM stock_locations sl
        WHERE sl.local_government_id = lg.id
          AND sl.location_type = 'lg_warehouse'
 );

ALTER TABLE user_memberships ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;

UPDATE user_memberships m
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = m.healthcare_centre_id;

ALTER TABLE user_memberships ALTER COLUMN local_government_id SET NOT NULL;
ALTER TABLE user_memberships ALTER COLUMN healthcare_centre_id DROP NOT NULL;
ALTER TABLE user_memberships ADD CONSTRAINT user_memberships_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR local_government_id IS NOT NULL
);

CREATE UNIQUE INDEX user_memberships_lg_unique ON user_memberships (user_id, local_government_id) WHERE healthcare_centre_id IS NULL;
CREATE INDEX user_memberships_lg_active_idx ON user_memberships (local_government_id, is_active);

ALTER TABLE system_settings ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE CASCADE;
ALTER TABLE system_settings ALTER COLUMN healthcare_centre_id DROP NOT NULL;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_scope_check CHECK (
    (healthcare_centre_id IS NOT NULL AND local_government_id IS NULL)
    OR (healthcare_centre_id IS NULL AND local_government_id IS NOT NULL)
);

CREATE UNIQUE INDEX system_settings_lg_unique ON system_settings (local_government_id, key) WHERE local_government_id IS NOT NULL;

CREATE TABLE facility_drug_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    healthcare_centre_id UUID NOT NULL REFERENCES healthcare_centres(id) ON DELETE CASCADE,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    minimum_stock_level DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (minimum_stock_level >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT facility_drug_settings_unique UNIQUE (healthcare_centre_id, drug_id)
);

CREATE INDEX facility_drug_settings_drug_idx ON facility_drug_settings (drug_id);

INSERT INTO facility_drug_settings (healthcare_centre_id, drug_id, minimum_stock_level, is_active)
SELECT d.healthcare_centre_id, d.id, d.minimum_stock_level, d.is_active
  FROM drugs d
ON CONFLICT DO NOTHING;

ALTER TABLE drugs ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;

UPDATE drugs d
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = d.healthcare_centre_id;

ALTER TABLE drugs ALTER COLUMN local_government_id SET NOT NULL;
ALTER TABLE drugs ALTER COLUMN healthcare_centre_id DROP NOT NULL;

INSERT INTO facility_drug_settings (healthcare_centre_id, drug_id, minimum_stock_level, is_active)
SELECT hc.id, d.id, d.minimum_stock_level, d.is_active
  FROM drugs d
  JOIN healthcare_centres hc ON hc.local_government_id = d.local_government_id
ON CONFLICT (healthcare_centre_id, drug_id) DO NOTHING;

DROP INDEX IF EXISTS drugs_centre_code_active_unique;

CREATE INDEX drugs_lg_active_idx ON drugs (local_government_id, is_active, name);
CREATE UNIQUE INDEX drugs_lg_code_active_unique ON drugs (local_government_id, lower(code)) WHERE is_active;

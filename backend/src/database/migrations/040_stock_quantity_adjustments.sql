INSERT INTO permissions (code, name, description)
VALUES ('adjustments.quantity', 'Correct stock quantities', 'Create single or bulk quantity corrections to batch stock')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'adjustments.quantity'
 WHERE r.code IN ('ADMINISTRATOR', 'SYSTEM_ADMIN')
ON CONFLICT DO NOTHING;

ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_group_id
  ON stock_adjustments (group_id)
  WHERE group_id IS NOT NULL;

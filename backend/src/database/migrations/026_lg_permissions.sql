INSERT INTO permissions (code, name, description) VALUES
    ('lg_warehouse.view', 'View LG warehouse', 'View local government warehouse stock, batches, movements, receipts and dispatches'),
    ('lg_orders.manage', 'Manage distribution orders', 'Prepare, submit, fulfil and cancel local government distribution orders'),
    ('lg_consolidations.manage', 'Manage consolidated demand', 'Build, preview, finalize and cancel consolidated demand'),
    ('lg_transfers.manage', 'Oversee facility transfers', 'View, create and cancel facility transfer requests at local government level')
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code IN ('lg_warehouse.view', 'lg_orders.manage', 'lg_consolidations.manage', 'lg_transfers.manage')
 WHERE r.code IN ('LG_INVENTORY_OFFICER', 'SYSTEM_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code = 'lg_warehouse.view'
 WHERE r.code = 'LG_ADMIN'
ON CONFLICT DO NOTHING;

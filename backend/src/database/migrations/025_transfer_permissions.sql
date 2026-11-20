INSERT INTO permissions (code, name, description) VALUES
    ('transfers.view', 'View transfers', 'View facility transfer requests and their progress'),
    ('transfers.request', 'Request transfers', 'Create transfer requests to neighbouring facilities'),
    ('transfers.approve', 'Approve transfers', 'Approve or decline transfer requests as the source facility'),
    ('transfers.receive', 'Receive transfers', 'Receive transfer shipments and resolve shortages'),
    ('transfers.cancel', 'Cancel transfers', 'Cancel transfer requests before they are received')
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code IN ('transfers.view', 'transfers.request', 'transfers.approve', 'transfers.receive', 'transfers.cancel')
 WHERE r.code IN ('ADMINISTRATOR', 'SYSTEM_ADMIN', 'STAFF')
ON CONFLICT DO NOTHING;

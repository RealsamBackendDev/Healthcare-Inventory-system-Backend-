UPDATE roles
   SET name = 'MOH (Medical Officer of Health)',
       description = 'Medical Officer of Health: oversees every facility, account and supply operation in the local government'
 WHERE code = 'LG_ADMIN';

UPDATE roles
   SET name = 'OIC (Officer In Charge)',
       description = 'Officer In Charge: runs the healthcare centre, including its staff accounts, stock, requisitions and approvals'
 WHERE code = 'ADMINISTRATOR';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code IN (
      'users.manage',
      'memberships.manage',
      'organisations.manage',
      'drugs.view',
      'drugs.manage',
      'inventory.view',
      'expiry.view',
      'reports.view',
      'lg_reports.view',
      'audit.view',
      'settings.manage',
      'notifications.view',
      'lg_warehouse.view',
      'lg_orders.manage',
      'lg_consolidations.manage',
      'lg_transfers.manage',
      'requisitions.lg_review',
      'consolidations.create',
      'consolidations.approve',
      'warehouse.receive',
      'warehouse.adjust',
      'distributions.manage',
      'dispatches.post',
      'deliveries.receive',
      'discrepancies.close',
      'thresholds.approve'
    )
 WHERE r.code IN ('LG_ADMIN', 'LG_INVENTORY_OFFICER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code IN (
      'users.manage',
      'drugs.view',
      'drugs.manage',
      'inventory.view',
      'stock.receive',
      'stock.dispense',
      'stock.import',
      'adjustments.create',
      'adjustments.approve',
      'returns.request',
      'returns.approve',
      'requisitions.create',
      'requisitions.approve',
      'requisitions.submit',
      'expiry.view',
      'reports.view',
      'audit.view',
      'settings.manage',
      'notifications.view',
      'deliveries.receive',
      'discrepancies.close',
      'transfers.view',
      'transfers.request',
      'transfers.approve',
      'transfers.receive',
      'transfers.cancel'
    )
 WHERE r.code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.code = 'ADMINISTRATOR'
   AND p.code IN (
     'organisations.manage',
     'memberships.manage',
     'requisitions.lg_review',
     'consolidations.create',
     'consolidations.approve',
     'warehouse.receive',
     'warehouse.adjust',
     'distributions.manage',
     'dispatches.post',
     'thresholds.approve',
     'lg_reports.view',
     'lg_warehouse.view',
     'lg_orders.manage',
     'lg_consolidations.manage',
     'lg_transfers.manage'
   );

DELETE FROM role_permissions
 WHERE role_id = (SELECT id FROM roles WHERE code = 'LG_INVENTORY_OFFICER')
   AND permission_id IN (SELECT id FROM permissions WHERE code = 'users.manage');

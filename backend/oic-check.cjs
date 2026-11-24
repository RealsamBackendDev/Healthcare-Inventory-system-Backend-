const { pool } = require('./src/database/connection');
const run = async () => {
  const mig = await pool.query(
    "select filename from schema_migrations where filename like '037%'"
  );
  console.log('MIG037 ' + mig.rows.length);
  const perms = await pool.query(
    'select p.code from role_permissions rp ' +
      'join roles r on r.id = rp.role_id ' +
      'join permissions p on p.id = rp.permission_id ' +
      "where r.code = 'ADMINISTRATOR' order by 1"
  );
  const codes = perms.rows.map((row) => row.code);
  console.log('OIC_COUNT ' + codes.length);
  console.log('OIC_USERS_MANAGE ' + codes.includes('users.manage'));
  await pool.end();
};
run().catch((error) => {
  console.log('ERR ' + error.message);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { pool } = require('./connection');

const migrationsDirectory = path.resolve(__dirname, 'migrations');

const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const listMigrations = () =>
  fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

const migrate = async () => {
  const client = await pool.connect();
  const applied = [];
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const appliedFiles = new Set(rows.map((row) => row.filename));

    for (const filename of listMigrations()) {
      if (appliedFiles.has(filename)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
        console.log(`Applied migration ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    if (applied.length === 0) {
      console.log('No pending migrations');
    }
  } finally {
    client.release();
  }
};

migrate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Migration failed', error.message);
    await pool.end();
    process.exit(1);
  });

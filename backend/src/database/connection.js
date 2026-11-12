const { Pool } = require('pg');
const config = require('../config/database');

const pool = new Pool(config);

pool.on('error', (error) => {
  console.error('Unexpected database pool error', error.message);
});

const query = (text, params) => pool.query(text, params);

const withTransaction = async (handler) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Transaction rollback failed', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
};

const close = () => pool.end();

module.exports = {
  pool,
  query,
  withTransaction,
  close
};

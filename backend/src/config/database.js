const environment = require('./environment');

const ssl = environment.database.ssl ? { rejectUnauthorized: false } : false;

const connectionConfig = environment.database.url
  ? { connectionString: environment.database.url, ssl }
  : {
      host: environment.database.host,
      port: environment.database.port,
      user: environment.database.user,
      password: environment.database.password,
      database: environment.database.name,
      ssl
    };

module.exports = {
  ...connectionConfig,
  max: environment.database.poolMax,
  idleTimeoutMillis: environment.database.idleTimeoutMillis,
  connectionTimeoutMillis: environment.database.connectionTimeoutMillis,
  application_name: 'healthcare-inventory-api'
};

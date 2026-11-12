const app = require('./app');
const environment = require('./config/environment');
const { query, close } = require('./database/connection');

let expiryTimer = null;

const startExpiryJob = () => {
  if (!environment.expiryJob.enabled || environment.isTest) {
    return;
  }
  const runRefresh = async () => {
    try {
      const expiryService = require('./modules/expiry/expiry.service');
      const result = await expiryService.refreshAllCentres();
      console.log(`Expiry refresh completed: ${result.expiredBatches} batches expired, ${result.notifications} notifications created`);
    } catch (error) {
      console.error('Expiry refresh failed', error.message);
    }
  };
  runRefresh();
  expiryTimer = setInterval(runRefresh, environment.expiryJob.intervalHours * 60 * 60 * 1000);
  expiryTimer.unref();
};

const start = async () => {
  try {
    await query('SELECT 1');
    console.log('Database connection established');
  } catch (error) {
    console.error('Unable to reach the database at startup', error.message);
  }

  const server = app.listen(environment.port, '0.0.0.0', () => {
    console.log(`API listening on port ${environment.port} in ${environment.nodeEnv} mode`);
  });

  startExpiryJob();

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down`);
    if (expiryTimer) {
      clearInterval(expiryTimer);
    }
    server.close(async () => {
      await close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

start();

module.exports = app;

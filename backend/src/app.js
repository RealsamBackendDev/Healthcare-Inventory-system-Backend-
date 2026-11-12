const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const environment = require('./config/environment');
const { query } = require('./database/connection');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const organisationsRoutes = require('./modules/organisations/organisations.routes');
const drugsRoutes = require('./modules/drugs/drugs.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const receivingRoutes = require('./modules/receiving/receiving.routes');
const dispensingRoutes = require('./modules/dispensing/dispensing.routes');
const adjustmentsRoutes = require('./modules/adjustments/adjustments.routes');
const requisitionsRoutes = require('./modules/requisitions/requisitions.routes');
const expiryRoutes = require('./modules/expiry/expiry.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || environment.cors.origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Healthcare-Centre-Id'],
    exposedHeaders: ['Content-Disposition']
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (!environment.isTest) {
  app.use(morgan(environment.isProduction ? 'combined' : 'dev'));
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please slow down'
    }
  }
});

app.use('/api', apiLimiter);

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({
      success: true,
      data: {
        status: 'ok',
        database: 'connected',
        environment: environment.nodeEnv,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is not reachable'
      }
    });
  }
});

app.use('/api', authRoutes);
app.use('/api', usersRoutes);
app.use('/api', organisationsRoutes);
app.use('/api', drugsRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', receivingRoutes);
app.use('/api', dispensingRoutes);
app.use('/api', adjustmentsRoutes);
app.use('/api', requisitionsRoutes);
app.use('/api', expiryRoutes);
app.use('/api', reportsRoutes);
app.use('/api', notificationsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

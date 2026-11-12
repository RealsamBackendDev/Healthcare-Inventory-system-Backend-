require('dotenv').config({ path: process.env.ENV_FILE || require('path').resolve(__dirname, '../../.env') });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toList = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const nodeEnv = process.env.NODE_ENV || 'development';

const environment = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: toInt(process.env.PORT, 4000),
  database: {
    url: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'healthcare_inventory',
    ssl: toBool(process.env.DB_SSL, false),
    poolMax: toInt(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: toInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10000)
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'development-only-secret-value',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer: process.env.JWT_ISSUER || 'healthcare-inventory'
  },
  security: {
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),
    maxLoginAttempts: toInt(process.env.MAX_LOGIN_ATTEMPTS, 5),
    lockMinutes: toInt(process.env.LOGIN_LOCK_MINUTES, 15)
  },
  defaults: {
    staffAdjustmentQuantityThreshold: toFloat(process.env.STAFF_ADJUSTMENT_QUANTITY_THRESHOLD, 10),
    staffAdjustmentValueThreshold: toFloat(process.env.STAFF_ADJUSTMENT_VALUE_THRESHOLD, 5000),
    nearExpiryDays: toInt(process.env.NEAR_EXPIRY_DAYS, 90)
  },
  bootstrap: {
    adminEmail: process.env.ADMIN_EMAIL || 'admin@healthcentre.local',
    adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
    adminFullName: process.env.ADMIN_FULL_NAME || 'System Administrator',
    centreName: process.env.CENTRE_NAME || 'Primary Healthcare Centre',
    centreCode: process.env.CENTRE_CODE || 'PHC-001',
    stateName: process.env.STATE_NAME || 'Lagos',
    stateCode: process.env.STATE_CODE || 'LA',
    localGovernmentName: process.env.LOCAL_GOVERNMENT_NAME || 'Ikeja',
    localGovernmentCode: process.env.LOCAL_GOVERNMENT_CODE || 'IKEJA'
  },
  cors: {
    origins: toList(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173'])
  },
  expiryJob: {
    enabled: toBool(process.env.EXPIRY_JOB_ENABLED, true),
    intervalHours: toInt(process.env.EXPIRY_JOB_INTERVAL_HOURS, 24)
  }
};

if (!environment.isTest && environment.jwt.secret.length < 16) {
  throw new Error('JWT_SECRET must be at least 16 characters');
}

module.exports = environment;

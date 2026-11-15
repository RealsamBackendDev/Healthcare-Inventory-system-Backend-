const { query } = require('../../database/connection');
const { SETTING_KEYS } = require('../constants');
const environment = require('../../config/environment');

const DEFAULT_SETTINGS = {
  [SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD]: String(environment.defaults.staffAdjustmentQuantityThreshold),
  [SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD]: String(environment.defaults.staffAdjustmentValueThreshold),
  [SETTING_KEYS.NEAR_EXPIRY_DAYS]: String(environment.defaults.nearExpiryDays)
};

const DEFAULT_LOCAL_GOVERNMENT_SETTINGS = {
  [SETTING_KEYS.LG_RECEIPT_QUANTITY_THRESHOLD]: '100',
  [SETTING_KEYS.LG_RECEIPT_VALUE_THRESHOLD]: '50000',
  [SETTING_KEYS.LG_DISPATCH_QUANTITY_THRESHOLD]: '200',
  [SETTING_KEYS.LG_CORRECTION_QUANTITY_THRESHOLD]: '100',
  [SETTING_KEYS.LG_CORRECTION_VALUE_THRESHOLD]: '50000',
  [SETTING_KEYS.LG_APPROVAL_WINDOW_HOURS]: '24'
};

const getSettingsMap = async (client, healthcareCentreId) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    'SELECT key, value FROM system_settings WHERE healthcare_centre_id = $1',
    [healthcareCentreId]
  );
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
};

const getNumberSetting = async (client, healthcareCentreId, key) => {
  const settings = await getSettingsMap(client, healthcareCentreId);
  const value = Number.parseFloat(settings[key]);
  if (Number.isFinite(value)) {
    return value;
  }
  const fallback = Number.parseFloat(DEFAULT_SETTINGS[key]);
  return Number.isFinite(fallback) ? fallback : 0;
};

const getLocalGovernmentSettingsMap = async (client, localGovernmentId) => {
  const executor = client || { query };
  const { rows } = await executor.query(
    'SELECT key, value FROM system_settings WHERE local_government_id = $1',
    [localGovernmentId]
  );
  const settings = { ...DEFAULT_LOCAL_GOVERNMENT_SETTINGS };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
};

const getLocalGovernmentNumberSetting = async (client, localGovernmentId, key) => {
  const settings = await getLocalGovernmentSettingsMap(client, localGovernmentId);
  const raw = settings[key];
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
};

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_LOCAL_GOVERNMENT_SETTINGS,
  getSettingsMap,
  getNumberSetting,
  getLocalGovernmentSettingsMap,
  getLocalGovernmentNumberSetting
};

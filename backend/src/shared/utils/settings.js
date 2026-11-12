const { query } = require('../../database/connection');
const { SETTING_KEYS } = require('../constants');
const environment = require('../../config/environment');

const DEFAULT_SETTINGS = {
  [SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD]: String(environment.defaults.staffAdjustmentQuantityThreshold),
  [SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD]: String(environment.defaults.staffAdjustmentValueThreshold),
  [SETTING_KEYS.NEAR_EXPIRY_DAYS]: String(environment.defaults.nearExpiryDays)
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

module.exports = {
  DEFAULT_SETTINGS,
  getSettingsMap,
  getNumberSetting
};

const { query } = require('../../database/connection');

const findCentre = async (healthcareCentreId) => {
  const { rows } = await query(
    `SELECT hc.id, hc.name, hc.code, hc.address, hc.is_active, hc.created_at,
            lg.id AS local_government_id, lg.name AS local_government_name, lg.code AS local_government_code,
            s.id AS state_id, s.name AS state_name, s.code AS state_code
       FROM healthcare_centres hc
       JOIN local_governments lg ON lg.id = hc.local_government_id
       JOIN states s ON s.id = lg.state_id
      WHERE hc.id = $1`,
    [healthcareCentreId]
  );
  return rows[0] || null;
};

const findLocalGovernment = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT lg.id, lg.name, lg.code, lg.created_at,
            s.id AS state_id, s.name AS state_name, s.code AS state_code
       FROM local_governments lg
       JOIN states s ON s.id = lg.state_id
      WHERE lg.id = $1`,
    [localGovernmentId]
  );
  return rows[0] || null;
};

const listStates = async () => {
  const { rows } = await query('SELECT id, name, code FROM states ORDER BY name');
  return rows;
};

const listLocalGovernments = async () => {
  const { rows } = await query(
    'SELECT id, state_id, name, code FROM local_governments ORDER BY name'
  );
  return rows;
};

const listCentres = async () => {
  const { rows } = await query(
    `SELECT hc.id, hc.name, hc.code, hc.address, hc.is_active,
            lg.id AS local_government_id, lg.name AS local_government_name,
            s.id AS state_id, s.name AS state_name
       FROM healthcare_centres hc
       JOIN local_governments lg ON lg.id = hc.local_government_id
       JOIN states s ON s.id = lg.state_id
      ORDER BY s.name, lg.name, hc.name`
  );
  return rows;
};

const listCentresForLocalGovernment = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT hc.id, hc.name, hc.code, hc.address, hc.is_active,
            sl.id AS stock_location_id, sl.name AS stock_location_name, sl.code AS stock_location_code
       FROM healthcare_centres hc
       LEFT JOIN stock_locations sl ON sl.healthcare_centre_id = hc.id AND sl.is_active = TRUE
      WHERE hc.local_government_id = $1
      ORDER BY hc.name`,
    [localGovernmentId]
  );
  return rows;
};

const listStockLocations = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT sl.id, sl.name, sl.code, sl.location_type, sl.is_active,
            hc.id AS healthcare_centre_id, hc.name AS centre_name
       FROM stock_locations sl
       LEFT JOIN healthcare_centres hc ON hc.id = sl.healthcare_centre_id
      WHERE sl.local_government_id = $1
      ORDER BY sl.location_type DESC, sl.name`,
    [localGovernmentId]
  );
  return rows;
};

const listLocalGovernmentSettings = async (localGovernmentId) => {
  const { rows } = await query(
    `SELECT key, value, description
       FROM system_settings
      WHERE local_government_id = $1
      ORDER BY key`,
    [localGovernmentId]
  );
  return rows;
};

module.exports = {
  findCentre,
  findLocalGovernment,
  listStates,
  listLocalGovernments,
  listCentres,
  listCentresForLocalGovernment,
  listStockLocations,
  listLocalGovernmentSettings
};

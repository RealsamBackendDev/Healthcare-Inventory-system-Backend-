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

module.exports = {
  findCentre,
  listStates,
  listLocalGovernments,
  listCentres
};

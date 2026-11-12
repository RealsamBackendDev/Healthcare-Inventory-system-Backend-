const { NotFoundError } = require('../../shared/errors/AppError');
const repository = require('./organisations.repository');

const mapCentre = (row) => ({
  id: row.id,
  name: row.name,
  code: row.code,
  address: row.address,
  isActive: row.is_active,
  localGovernment: {
    id: row.local_government_id,
    name: row.local_government_name,
    code: row.local_government_code
  },
  state: {
    id: row.state_id,
    name: row.state_name,
    code: row.state_code
  }
});

const getActiveCentre = async (healthcareCentreId) => {
  const centre = await repository.findCentre(healthcareCentreId);
  if (!centre) {
    throw new NotFoundError('Healthcare centre was not found');
  }
  return mapCentre(centre);
};

const getStructure = async () => {
  const [states, localGovernments, centres] = await Promise.all([
    repository.listStates(),
    repository.listLocalGovernments(),
    repository.listCentres()
  ]);

  return states.map((state) => ({
    id: state.id,
    name: state.name,
    code: state.code,
    localGovernments: localGovernments
      .filter((item) => item.state_id === state.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        code: item.code,
        centres: centres
          .filter((centre) => centre.local_government_id === item.id)
          .map((centre) => ({
            id: centre.id,
            name: centre.name,
            code: centre.code,
            address: centre.address,
            isActive: centre.is_active
          }))
      }))
  }));
};

module.exports = {
  getActiveCentre,
  getStructure
};

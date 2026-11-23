const { NotFoundError } = require('../../shared/errors/AppError');
const { ROLES } = require('../../shared/constants');
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

const getStructure = async (scope) => {
  const [states, localGovernments, centres] = await Promise.all([
    repository.listStates(),
    repository.listLocalGovernments(),
    repository.listCentres()
  ]);

  const seesEveryLocalGovernment = !scope || scope.roleCode === ROLES.SYSTEM_ADMIN;
  const visibleLocalGovernments = seesEveryLocalGovernment
    ? localGovernments
    : localGovernments.filter((item) => item.id === scope.localGovernmentId);
  const visibleStateIds = new Set(visibleLocalGovernments.map((item) => item.state_id));

  return states
    .filter((state) => visibleStateIds.has(state.id))
    .map((state) => ({
      id: state.id,
      name: state.name,
      code: state.code,
      localGovernments: visibleLocalGovernments
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

const getLocalGovernmentOverview = async (localGovernmentId) => {
  const localGovernment = await repository.findLocalGovernment(localGovernmentId);
  if (!localGovernment) {
    throw new NotFoundError('Local government was not found');
  }

  const [centres, locations, settings] = await Promise.all([
    repository.listCentresForLocalGovernment(localGovernmentId),
    repository.listStockLocations(localGovernmentId),
    repository.listLocalGovernmentSettings(localGovernmentId)
  ]);

  return {
    localGovernment: {
      id: localGovernment.id,
      name: localGovernment.name,
      code: localGovernment.code
    },
    state: {
      id: localGovernment.state_id,
      name: localGovernment.state_name,
      code: localGovernment.state_code
    },
    centres: centres.map((centre) => ({
      id: centre.id,
      name: centre.name,
      code: centre.code,
      address: centre.address,
      isActive: centre.is_active,
      stockLocation: centre.stock_location_id
        ? {
            id: centre.stock_location_id,
            name: centre.stock_location_name,
            code: centre.stock_location_code
          }
        : null
    })),
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      code: location.code,
      locationType: location.location_type,
      isActive: location.is_active,
      healthcareCentreId: location.healthcare_centre_id,
      centreName: location.centre_name
    })),
    settings: settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      description: setting.description
    }))
  };
};

module.exports = {
  getActiveCentre,
  getStructure,
  getLocalGovernmentOverview
};

const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./organisations.service');

const getActiveCentre = asyncHandler(async (req, res) => {
  const result = await service.getActiveCentre(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const getStructure = asyncHandler(async (req, res) => {
  const result = await service.getStructure(req.scope);
  res.json({ success: true, data: result });
});

const getLocalGovernment = asyncHandler(async (req, res) => {
  const result = await service.getLocalGovernmentOverview(req.scope.localGovernmentId);
  res.json({ success: true, data: result });
});

module.exports = {
  getActiveCentre,
  getStructure,
  getLocalGovernment
};

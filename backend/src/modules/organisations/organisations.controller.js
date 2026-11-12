const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./organisations.service');

const getActiveCentre = asyncHandler(async (req, res) => {
  const result = await service.getActiveCentre(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const getStructure = asyncHandler(async (req, res) => {
  const result = await service.getStructure();
  res.json({ success: true, data: result });
});

module.exports = {
  getActiveCentre,
  getStructure
};

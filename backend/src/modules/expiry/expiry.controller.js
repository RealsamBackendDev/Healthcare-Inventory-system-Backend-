const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./expiry.service');

const getNearExpiry = asyncHandler(async (req, res) => {
  const result = await service.getNearExpiry(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getExpired = asyncHandler(async (req, res) => {
  const result = await service.getExpired(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getSummary = asyncHandler(async (req, res) => {
  const result = await service.getSummary(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await service.refreshCurrentCentre(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

module.exports = {
  getNearExpiry,
  getExpired,
  getSummary,
  refresh
};

const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./dispensing.service');

const dispense = asyncHandler(async (req, res) => {
  const result = await service.dispense({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listDispensing = asyncHandler(async (req, res) => {
  const result = await service.listDispensing(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getDispensing = asyncHandler(async (req, res) => {
  const result = await service.getDispensing(req.scope.healthcareCentreId, req.params.dispensingId);
  res.json({ success: true, data: result });
});

module.exports = {
  dispense,
  listDispensing,
  getDispensing
};

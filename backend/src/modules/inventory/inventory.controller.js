const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./inventory.service');

const listInventory = asyncHandler(async (req, res) => {
  const result = await service.listInventory(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const listBatches = asyncHandler(async (req, res) => {
  const result = await service.listBatches(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getDrugInventory = asyncHandler(async (req, res) => {
  const result = await service.getDrugInventory(
    req.scope.healthcareCentreId,
    req.params.drugId,
    req.query.nearExpiryDays
  );
  res.json({ success: true, data: result });
});

module.exports = {
  listInventory,
  listBatches,
  getDrugInventory
};

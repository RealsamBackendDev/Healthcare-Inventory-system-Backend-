const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./warehouse-returns.service');

const listWarehouseReturns = asyncHandler(async (req, res) => {
  const result = await service.listWarehouseReturns({ scope: req.scope });
  res.json({ success: true, data: result });
});

const confirmWarehouseReturn = asyncHandler(async (req, res) => {
  const result = await service.confirmWarehouseReturn({
    actor: req.user,
    scope: req.scope,
    batchId: req.params.batchId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listWarehouseReturns,
  confirmWarehouseReturn
};

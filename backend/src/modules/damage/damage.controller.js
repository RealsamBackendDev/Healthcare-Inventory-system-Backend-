const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./damage.service');

const listDamagedStock = asyncHandler(async (req, res) => {
  const result = await service.listDamagedStock({ scope: req.scope });
  res.json({ success: true, data: result });
});

const listReturnsInTransit = asyncHandler(async (req, res) => {
  const result = await service.listReturnsInTransit({ scope: req.scope });
  res.json({ success: true, data: result });
});

const recordDisposition = asyncHandler(async (req, res) => {
  const result = await service.recordDisposition({
    actor: req.user,
    scope: req.scope,
    batchId: req.params.batchId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const markDamaged = asyncHandler(async (req, res) => {
  const result = await service.markDamaged({
    actor: req.user,
    scope: req.scope,
    batchId: req.params.batchId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const confirmReturn = asyncHandler(async (req, res) => {
  const result = await service.confirmReturn({
    actor: req.user,
    scope: req.scope,
    batchId: req.params.batchId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listDamagedStock,
  listReturnsInTransit,
  markDamaged,
  recordDisposition,
  confirmReturn
};

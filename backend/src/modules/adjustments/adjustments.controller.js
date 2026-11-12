const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./adjustments.service');
const returnsService = require('./returns.service');

const createAdjustment = asyncHandler(async (req, res) => {
  const result = await service.createAdjustment({
    actor: req.user,
    roleCode: req.scope.roleCode,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listAdjustments = asyncHandler(async (req, res) => {
  const result = await service.listAdjustments(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getAdjustment = asyncHandler(async (req, res) => {
  const result = await service.getAdjustment(req.scope.healthcareCentreId, req.params.adjustmentId);
  res.json({ success: true, data: result });
});

const approveAdjustment = asyncHandler(async (req, res) => {
  const result = await service.approveAdjustment({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    adjustmentId: req.params.adjustmentId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const rejectAdjustment = asyncHandler(async (req, res) => {
  const result = await service.rejectAdjustment({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    adjustmentId: req.params.adjustmentId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const createStockCount = asyncHandler(async (req, res) => {
  const result = await service.createStockCount({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    lines: req.body.lines,
    reason: req.body.reason,
    reference: req.body.reference
  });
  res.status(201).json({ success: true, data: result });
});

const createReturn = asyncHandler(async (req, res) => {
  const result = await returnsService.createReturn({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listReturns = asyncHandler(async (req, res) => {
  const result = await returnsService.listReturns(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getReturn = asyncHandler(async (req, res) => {
  const result = await returnsService.getReturn(req.scope.healthcareCentreId, req.params.returnId);
  res.json({ success: true, data: result });
});

const approveReturn = asyncHandler(async (req, res) => {
  const result = await returnsService.approveReturn({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    returnId: req.params.returnId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const rejectReturn = asyncHandler(async (req, res) => {
  const result = await returnsService.rejectReturn({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    returnId: req.params.returnId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

module.exports = {
  createAdjustment,
  listAdjustments,
  getAdjustment,
  approveAdjustment,
  rejectAdjustment,
  createStockCount,
  createReturn,
  listReturns,
  getReturn,
  approveReturn,
  rejectReturn
};

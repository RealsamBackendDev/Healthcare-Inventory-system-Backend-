const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./lg.service');

const getWarehouse = asyncHandler(async (req, res) => {
  const result = await service.getWarehouseOverview({ scope: req.scope, search: req.query.search });
  res.json({ success: true, data: result });
});

const getWarehouseBatches = asyncHandler(async (req, res) => {
  const result = await service.getWarehouseBatches({ scope: req.scope, drugId: req.query.drugId });
  res.json({ success: true, data: result });
});

const createReceipt = asyncHandler(async (req, res) => {
  const result = await service.receiveStock({ actor: req.user, scope: req.scope, payload: req.body });
  res.status(201).json({ success: true, data: result });
});

const listReceipts = asyncHandler(async (req, res) => {
  const result = await service.listReceipts({ scope: req.scope, limit: req.query.limit || 50 });
  res.json({ success: true, data: result });
});

const listRequisitions = asyncHandler(async (req, res) => {
  const result = await service.listRequisitions({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const getRequisition = asyncHandler(async (req, res) => {
  const result = await service.getRequisitionDetail({
    scope: req.scope,
    requisitionId: req.params.requisitionId
  });
  res.json({ success: true, data: result });
});

const approveRequisition = asyncHandler(async (req, res) => {
  const result = await service.reviewRequisition({
    actor: req.user,
    scope: req.scope,
    requisitionId: req.params.requisitionId,
    decision: 'approved',
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const rejectRequisition = asyncHandler(async (req, res) => {
  const result = await service.reviewRequisition({
    actor: req.user,
    scope: req.scope,
    requisitionId: req.params.requisitionId,
    decision: 'rejected',
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const dispatchRequisition = asyncHandler(async (req, res) => {
  const result = await service.dispatchRequisition({
    actor: req.user,
    scope: req.scope,
    requisitionId: req.params.requisitionId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listDispatches = asyncHandler(async (req, res) => {
  const result = await service.listDispatches({ scope: req.scope, limit: req.query.limit || 50 });
  res.json({ success: true, data: result });
});

const getDispatch = asyncHandler(async (req, res) => {
  const result = await service.getDispatchDetail({ scope: req.scope, dispatchId: req.params.dispatchId });
  res.json({ success: true, data: result });
});

module.exports = {
  getWarehouse,
  getWarehouseBatches,
  createReceipt,
  listReceipts,
  listRequisitions,
  getRequisition,
  approveRequisition,
  rejectRequisition,
  dispatchRequisition,
  listDispatches,
  getDispatch
};

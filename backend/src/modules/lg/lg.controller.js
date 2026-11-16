const asyncHandler = require('../../shared/utils/asyncHandler');
const { sendReport } = require('../../shared/utils/exporter');
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
  if (result && result.requiresApproval) {
    return res.status(202).json({ success: true, data: result });
  }
  return res.status(201).json({ success: true, data: result });
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
  if (result && result.requiresApproval) {
    return res.status(202).json({ success: true, data: result });
  }
  return res.status(201).json({ success: true, data: result });
});

const listDispatches = asyncHandler(async (req, res) => {
  const result = await service.listDispatches({ scope: req.scope, limit: req.query.limit || 50 });
  res.json({ success: true, data: result });
});

const getDispatch = asyncHandler(async (req, res) => {
  const result = await service.getDispatchDetail({ scope: req.scope, dispatchId: req.params.dispatchId });
  res.json({ success: true, data: result });
});

const getReportsSummary = asyncHandler(async (req, res) => {
  const result = await service.getReportsSummary({ scope: req.scope });
  res.json({ success: true, data: result });
});

const sendLgReport = (builder) =>
  asyncHandler(async (req, res) => {
    const report = await builder(req.scope, req.query);
    await sendReport(res, { format: req.query.format || 'json', ...report });
  });

const listTransferFacilities = asyncHandler(async (req, res) => {
  const result = await service.listTransferFacilities({ scope: req.scope });
  res.json({ success: true, data: result });
});

const getFacilityStock = asyncHandler(async (req, res) => {
  const result = await service.getTransferFacilityStock({
    scope: req.scope,
    facilityId: req.query.facilityId
  });
  res.json({ success: true, data: result });
});

const createTransfer = asyncHandler(async (req, res) => {
  const result = await service.createFacilityTransfer({
    actor: req.user,
    scope: req.scope,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listTransfers = asyncHandler(async (req, res) => {
  const result = await service.listFacilityTransfers({ scope: req.scope, status: req.query.status });
  res.json({ success: true, data: result });
});

const getTransfer = asyncHandler(async (req, res) => {
  const result = await service.getFacilityTransfer({
    scope: req.scope,
    transferId: req.params.transferId
  });
  res.json({ success: true, data: result });
});

const cancelTransfer = asyncHandler(async (req, res) => {
  const result = await service.cancelFacilityTransfer({
    actor: req.user,
    scope: req.scope,
    transferId: req.params.transferId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const listOrderCandidates = asyncHandler(async (req, res) => {
  const result = await service.listOrderCandidates({ scope: req.scope });
  res.json({ success: true, data: result });
});

const createOrder = asyncHandler(async (req, res) => {
  const result = await service.createOrder({
    actor: req.user,
    scope: req.scope,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listOrders = asyncHandler(async (req, res) => {
  const result = await service.listOrders({ scope: req.scope, status: req.query.status });
  res.json({ success: true, data: result });
});

const getOrder = asyncHandler(async (req, res) => {
  const result = await service.getOrder({ scope: req.scope, orderId: req.params.orderId });
  res.json({ success: true, data: result });
});

const submitOrder = asyncHandler(async (req, res) => {
  const result = await service.submitOrder({
    actor: req.user,
    scope: req.scope,
    orderId: req.params.orderId
  });
  res.json({ success: true, data: result });
});

const fulfillOrder = asyncHandler(async (req, res) => {
  const result = await service.fulfillOrder({
    actor: req.user,
    scope: req.scope,
    orderId: req.params.orderId,
    note: req.body.note
  });
  res.json({ success: true, data: result });
});

const cancelOrder = asyncHandler(async (req, res) => {
  const result = await service.cancelOrder({
    actor: req.user,
    scope: req.scope,
    orderId: req.params.orderId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const getConsolidationCandidates = asyncHandler(async (req, res) => {
  const result = await service.getConsolidationCandidates({ scope: req.scope });
  res.json({ success: true, data: result });
});

const previewConsolidation = asyncHandler(async (req, res) => {
  const result = await service.previewConsolidation({
    scope: req.scope,
    requisitionIds: req.body.requisitionIds
  });
  res.json({ success: true, data: result });
});

const createConsolidation = asyncHandler(async (req, res) => {
  const result = await service.createConsolidation({
    actor: req.user,
    scope: req.scope,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listConsolidations = asyncHandler(async (req, res) => {
  const result = await service.listConsolidations({ scope: req.scope, status: req.query.status });
  res.json({ success: true, data: result });
});

const getConsolidation = asyncHandler(async (req, res) => {
  const result = await service.getConsolidation({
    scope: req.scope,
    consolidationId: req.params.consolidationId
  });
  res.json({ success: true, data: result });
});

const finalizeConsolidation = asyncHandler(async (req, res) => {
  const result = await service.finalizeConsolidation({
    actor: req.user,
    scope: req.scope,
    consolidationId: req.params.consolidationId
  });
  res.json({ success: true, data: result });
});

const cancelConsolidation = asyncHandler(async (req, res) => {
  const result = await service.cancelConsolidation({
    actor: req.user,
    scope: req.scope,
    consolidationId: req.params.consolidationId
  });
  res.json({ success: true, data: result });
});

const listApprovals = asyncHandler(async (req, res) => {
  const result = await service.listThresholdApprovals({
    scope: req.scope,
    status: req.query.status
  });
  res.json({ success: true, data: result });
});

const approveApproval = asyncHandler(async (req, res) => {
  const result = await service.approveThresholdRequest({
    actor: req.user,
    scope: req.scope,
    approvalId: req.params.approvalId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const rejectApproval = asyncHandler(async (req, res) => {
  const result = await service.rejectThresholdRequest({
    actor: req.user,
    scope: req.scope,
    approvalId: req.params.approvalId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listTransferFacilities,
  getFacilityStock,
  createTransfer,
  listTransfers,
  getTransfer,
  cancelTransfer,
  listOrderCandidates,
  createOrder,
  listOrders,
  getOrder,
  submitOrder,
  fulfillOrder,
  cancelOrder,
  getConsolidationCandidates,
  previewConsolidation,
  createConsolidation,
  listConsolidations,
  getConsolidation,
  finalizeConsolidation,
  cancelConsolidation,
  listApprovals,
  approveApproval,
  rejectApproval,
  getReportsSummary,
  demandReport: sendLgReport(service.buildDemandReport),
  warehouseReport: sendLgReport(service.buildWarehouseReport),
  dispatchReport: sendLgReport(service.buildDispatchReport),
  receiptReport: sendLgReport(service.buildReceiptReport),
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

const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./requisitions.service');
const lgService = require('../lg/lg.service');
const receipts = require('../lg/lg.receipts');

const createRequisition = asyncHandler(async (req, res) => {
  const result = await service.createRequisition({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listRequisitions = asyncHandler(async (req, res) => {
  const result = await service.listRequisitions(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getRequisition = asyncHandler(async (req, res) => {
  const result = await service.getRequisition(req.scope.healthcareCentreId, req.params.requisitionId);
  res.json({ success: true, data: result });
});

const updateRequisition = asyncHandler(async (req, res) => {
  const result = await service.updateRequisition({
    actor: req.user,
    roleCode: req.scope.roleCode,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const deleteRequisition = asyncHandler(async (req, res) => {
  const result = await service.deleteRequisition({
    actor: req.user,
    roleCode: req.scope.roleCode,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId
  });
  res.json({ success: true, data: result });
});

const submitRequisition = asyncHandler(async (req, res) => {
  const result = await service.submitRequisition({
    actor: req.user,
    roleCode: req.scope.roleCode,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId
  });
  res.json({ success: true, data: result });
});

const approveRequisition = asyncHandler(async (req, res) => {
  const result = await service.approveRequisition({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId,
    items: req.body.items,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const rejectRequisition = asyncHandler(async (req, res) => {
  const result = await service.rejectRequisition({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const cancelRequisition = asyncHandler(async (req, res) => {
  const result = await service.cancelRequisition({
    actor: req.user,
    roleCode: req.scope.roleCode,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const closeRequisition = asyncHandler(async (req, res) => {
  const result = await service.closeRequisition({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId,
    comment: req.body.comment
  });
  res.json({ success: true, data: result });
});

const amendRequisition = asyncHandler(async (req, res) => {
  const result = await service.amendRequisition({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    requisitionId: req.params.requisitionId
  });
  res.status(201).json({ success: true, data: result });
});

const getShortages = asyncHandler(async (req, res) => {
  const result = await service.getShortages(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const generateSuggestions = asyncHandler(async (req, res) => {
  const result = await service.generateSuggestions({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId
  });
  res.status(201).json({ success: true, data: result });
});

const listIncomingDeliveries = asyncHandler(async (req, res) => {
  const result = await lgService.listIncomingDeliveries(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const getDelivery = asyncHandler(async (req, res) => {
  const result = await lgService.getRequisitionDelivery(
    req.scope.healthcareCentreId,
    req.params.requisitionId
  );
  res.json({ success: true, data: result });
});

const receiveDelivery = asyncHandler(async (req, res) => {
  const result = await receipts.receiveDelivery({
    actor: req.user,
    scope: req.scope,
    requisitionId: req.params.requisitionId,
    dispatchId: req.body.dispatchId,
    note: req.body.note,
    items: req.body.items
  });
  res.json({ success: true, data: result });
});

const getDispatchDelivery = asyncHandler(async (req, res) => {
  const result = await receipts.getDispatchDelivery(
    req.scope.healthcareCentreId,
    req.params.dispatchId
  );
  res.json({ success: true, data: result });
});

const receiveDispatchDelivery = asyncHandler(async (req, res) => {
  const result = await receipts.receiveDelivery({
    actor: req.user,
    scope: req.scope,
    dispatchId: req.params.dispatchId,
    note: req.body.note,
    items: req.body.items
  });
  res.json({ success: true, data: result });
});

const listIncomingTransfers = asyncHandler(async (req, res) => {
  const result = await lgService.listIncomingFacilityTransfers(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const getTransferDetail = asyncHandler(async (req, res) => {
  const result = await lgService.getIncomingFacilityTransfer({
    scope: req.scope,
    transferId: req.params.transferId
  });
  res.json({ success: true, data: result });
});

const receiveTransfer = asyncHandler(async (req, res) => {
  const result = await lgService.receiveFacilityTransfer({
    actor: req.user,
    scope: req.scope,
    transferId: req.params.transferId,
    note: req.body.note
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listIncomingTransfers,
  getTransferDetail,
  receiveTransfer,
  createRequisition,
  listRequisitions,
  getRequisition,
  updateRequisition,
  deleteRequisition,
  submitRequisition,
  approveRequisition,
  rejectRequisition,
  cancelRequisition,
  closeRequisition,
  amendRequisition,
  getShortages,
  generateSuggestions,
  listIncomingDeliveries,
  getDelivery,
  receiveDelivery,
  getDispatchDelivery,
  receiveDispatchDelivery
};

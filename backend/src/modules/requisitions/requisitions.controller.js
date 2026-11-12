const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./requisitions.service');

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

module.exports = {
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
  generateSuggestions
};

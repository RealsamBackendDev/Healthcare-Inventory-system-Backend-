const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./vendor-requests.service');

const listRequests = asyncHandler(async (req, res) => {
  const result = await service.listRequests({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const listCandidates = asyncHandler(async (req, res) => {
  const result = await service.listCandidates({ scope: req.scope });
  res.json({ success: true, data: result });
});

const getRequest = asyncHandler(async (req, res) => {
  const result = await service.getRequest({ scope: req.scope, requestId: req.params.requestId });
  res.json({ success: true, data: result });
});

const createRequest = asyncHandler(async (req, res) => {
  const result = await service.createRequest({
    scope: req.scope,
    actor: req.user,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const sendRequest = asyncHandler(async (req, res) => {
  const result = await service.sendRequest({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId
  });
  res.json({ success: true, data: result });
});

const removeRequestItem = asyncHandler(async (req, res) => {
  const result = await service.removeRequestItem({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId,
    itemId: req.params.itemId
  });
  res.json({ success: true, data: result });
});

const cancelRequest = asyncHandler(async (req, res) => {
  const result = await service.cancelRequest({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const listPortalRequests = asyncHandler(async (req, res) => {
  const result = await service.listPortalRequests({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const getPortalRequest = asyncHandler(async (req, res) => {
  const result = await service.getPortalRequest({ scope: req.scope, requestId: req.params.requestId });
  res.json({ success: true, data: result });
});

const acceptPortalRequest = asyncHandler(async (req, res) => {
  const result = await service.acceptPortalRequest({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId
  });
  res.json({ success: true, data: result });
});

const respondPortalRequest = asyncHandler(async (req, res) => {
  const result = await service.respondPortalRequest({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const declinePortalRequest = asyncHandler(async (req, res) => {
  const result = await service.declinePortalRequest({
    scope: req.scope,
    actor: req.user,
    requestId: req.params.requestId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listRequests,
  listCandidates,
  getRequest,
  createRequest,
  sendRequest,
  removeRequestItem,
  cancelRequest,
  listPortalRequests,
  getPortalRequest,
  acceptPortalRequest,
  respondPortalRequest,
  declinePortalRequest
};

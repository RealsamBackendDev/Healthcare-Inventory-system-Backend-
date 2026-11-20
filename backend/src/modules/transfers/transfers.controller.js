const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./transfers.service');

const listNeighbours = asyncHandler(async (req, res) => {
  const result = await service.getNeighbours({ scope: req.scope });
  res.json({ success: true, data: result });
});

const neighbourStock = asyncHandler(async (req, res) => {
  const result = await service.getNeighbourStock({
    scope: req.scope,
    facilityId: req.params.facilityId
  });
  res.json({ success: true, data: result });
});

const createRequest = asyncHandler(async (req, res) => {
  const result = await service.createRequest({
    actor: req.user,
    scope: req.scope,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listRequests = asyncHandler(async (req, res) => {
  const result = await service.listRequests({
    scope: req.scope,
    direction: req.query.direction || 'outgoing'
  });
  res.json({ success: true, data: result });
});

const getRequest = asyncHandler(async (req, res) => {
  const result = await service.getRequestDetail({
    scope: req.scope,
    requestId: req.params.requestId
  });
  res.json({ success: true, data: result });
});

const approveRequest = asyncHandler(async (req, res) => {
  const result = await service.approveRequest({
    actor: req.user,
    scope: req.scope,
    requestId: req.params.requestId,
    note: req.body.note
  });
  res.json({ success: true, data: result });
});

const declineRequest = asyncHandler(async (req, res) => {
  const result = await service.declineRequest({
    actor: req.user,
    scope: req.scope,
    requestId: req.params.requestId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

const receiveRequest = asyncHandler(async (req, res) => {
  const result = await service.receiveRequest({
    actor: req.user,
    scope: req.scope,
    requestId: req.params.requestId,
    note: req.body.note,
    items: req.body.items
  });
  res.json({ success: true, data: result });
});

const resolveShortage = asyncHandler(async (req, res) => {
  const result = await service.resolveShortage({
    actor: req.user,
    scope: req.scope,
    requestId: req.params.requestId,
    lineId: req.params.lineId,
    resolution: req.body.resolution,
    note: req.body.note
  });
  res.json({ success: true, data: result });
});

const cancelRequest = asyncHandler(async (req, res) => {
  const result = await service.cancelRequest({
    actor: req.user,
    scope: req.scope,
    requestId: req.params.requestId,
    reason: req.body.reason
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listNeighbours,
  neighbourStock,
  createRequest,
  listRequests,
  getRequest,
  approveRequest,
  declineRequest,
  receiveRequest,
  resolveShortage,
  cancelRequest
};

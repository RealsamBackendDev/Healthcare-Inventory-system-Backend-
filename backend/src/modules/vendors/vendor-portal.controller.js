const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./vendors.service');

const getProfile = asyncHandler(async (req, res) => {
  const result = await service.getPortalProfile({ scope: req.scope });
  res.json({ success: true, data: result });
});

const listStock = asyncHandler(async (req, res) => {
  const result = await service.listPortalStock({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const listDrugs = asyncHandler(async (req, res) => {
  const result = await service.listPortalDrugs({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const createStock = asyncHandler(async (req, res) => {
  const result = await service.createPortalStock({
    scope: req.scope,
    actor: req.user,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const updateStock = asyncHandler(async (req, res) => {
  const result = await service.updatePortalStock({
    scope: req.scope,
    actor: req.user,
    stockId: req.params.stockId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const submitForScreening = asyncHandler(async (req, res) => {
  const result = await service.submitForScreening({ scope: req.scope, actor: req.user });
  res.json({ success: true, data: result });
});

module.exports = {
  getProfile,
  listStock,
  listDrugs,
  createStock,
  updateStock,
  submitForScreening
};

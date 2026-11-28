const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./vendors.service');

const listVendors = asyncHandler(async (req, res) => {
  const result = await service.listVendors({ scope: req.scope, filters: req.query });
  res.json({ success: true, data: result });
});

const getVendor = asyncHandler(async (req, res) => {
  const result = await service.getVendor({ scope: req.scope, vendorId: req.params.vendorId });
  res.json({ success: true, data: result });
});

const createVendor = asyncHandler(async (req, res) => {
  const result = await service.createVendor({ scope: req.scope, actor: req.user, payload: req.body });
  res.status(201).json({ success: true, data: result });
});

const updateVendor = asyncHandler(async (req, res) => {
  const result = await service.updateVendor({
    scope: req.scope,
    actor: req.user,
    vendorId: req.params.vendorId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const screenVendor = asyncHandler(async (req, res) => {
  const result = await service.screenVendor({
    scope: req.scope,
    actor: req.user,
    vendorId: req.params.vendorId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const registerVendor = asyncHandler(async (req, res) => {
  const result = await service.registerVendor({
    scope: req.scope,
    actor: req.user,
    vendorId: req.params.vendorId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const changeVendorStatus = asyncHandler(async (req, res) => {
  const result = await service.changeVendorStatus({
    scope: req.scope,
    actor: req.user,
    vendorId: req.params.vendorId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  screenVendor,
  registerVendor,
  changeVendorStatus
};

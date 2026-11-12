const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./users.service');

const listUsers = asyncHandler(async (req, res) => {
  const result = await service.listUsers(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const createUser = asyncHandler(async (req, res) => {
  const result = await service.createUser({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    ...req.body
  });
  res.status(201).json({ success: true, data: result });
});

const updateUser = asyncHandler(async (req, res) => {
  const result = await service.updateUser({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    userId: req.params.userId,
    fullName: req.body.fullName,
    isActive: req.body.isActive,
    roleCode: req.body.roleCode
  });
  res.json({ success: true, data: result });
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await service.resetPassword({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    userId: req.params.userId,
    newPassword: req.body.newPassword
  });
  res.json({ success: true, data: result });
});

const getSettings = asyncHandler(async (req, res) => {
  const result = await service.getSettings(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const updateSettings = asyncHandler(async (req, res) => {
  const result = await service.updateSettings({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    updates: req.body
  });
  res.json({ success: true, data: result });
});

const listRoles = asyncHandler(async (req, res) => {
  res.json({ success: true, data: service.listRoles() });
});

module.exports = {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  getSettings,
  updateSettings,
  listRoles
};

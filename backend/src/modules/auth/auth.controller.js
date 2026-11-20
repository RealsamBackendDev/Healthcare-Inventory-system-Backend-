const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./auth.service');

const login = asyncHandler(async (req, res) => {
  const result = await service.login({
    email: req.body.email,
    password: req.body.password,
    ipAddress: req.ip
  });
  res.json({ success: true, data: result });
});

const me = asyncHandler(async (req, res) => {
  const result = await service.getProfile(req.user.id, req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const switchMembership = asyncHandler(async (req, res) => {
  const result = await service.switchMembership({
    actor: req.user,
    membershipId: req.body.membershipId
  });
  res.json({ success: true, data: result });
});

const logout = asyncHandler(async (req, res) => {
  const result = await service.logout(req.user, req.scope);
  res.json({ success: true, data: result });
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await service.changePassword({
    actor: req.user,
    scope: req.scope,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword
  });
  res.json({ success: true, data: result });
});

module.exports = {
  login,
  me,
  switchMembership,
  logout,
  changePassword
};

const { ForbiddenError } = require('../shared/errors/AppError');

const authorize = (...requiredPermissions) => (req, res, next) => {
  if (!req.scope || !req.scope.permissions) {
    return next(new ForbiddenError());
  }
  const allowed = requiredPermissions.every((permission) => req.scope.permissions.has(permission));
  if (!allowed) {
    return next(new ForbiddenError('You do not have permission to perform this action', 'PERMISSION_DENIED'));
  }
  return next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.scope || !roles.includes(req.scope.roleCode)) {
    return next(new ForbiddenError('You do not have permission to perform this action', 'ROLE_DENIED'));
  }
  return next();
};

module.exports = {
  authorize,
  requireRole
};

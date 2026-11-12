const jwt = require('jsonwebtoken');
const environment = require('../config/environment');
const { query } = require('../database/connection');
const { AuthenticationError } = require('../shared/errors/AppError');

const loadMemberships = async (userId) => {
  const { rows } = await query(
    `SELECT m.id, m.healthcare_centre_id, m.role_id, r.code AS role_code, hc.name AS centre_name
       FROM user_memberships m
       JOIN roles r ON r.id = m.role_id
       JOIN healthcare_centres hc ON hc.id = m.healthcare_centre_id
      WHERE m.user_id = $1
        AND m.is_active = TRUE
        AND hc.is_active = TRUE
      ORDER BY hc.name`,
    [userId]
  );
  return rows;
};

const loadPermissions = async (roleId) => {
  const { rows } = await query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows.map((row) => row.code);
};

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError();
    }

    let payload;
    try {
      payload = jwt.verify(token, environment.jwt.secret, { issuer: environment.jwt.issuer });
    } catch (error) {
      throw new AuthenticationError('Your session is invalid or has expired', 'INVALID_TOKEN');
    }

    const { rows } = await query(
      'SELECT id, email, full_name, is_active, token_version FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      throw new AuthenticationError('This account is not active', 'ACCOUNT_INACTIVE');
    }

    if (Number(payload.ver) !== Number(user.token_version)) {
      throw new AuthenticationError('This session has been revoked', 'SESSION_REVOKED');
    }

    const memberships = await loadMemberships(user.id);
    if (memberships.length === 0) {
      throw new AuthenticationError('No active healthcare centre membership was found', 'NO_MEMBERSHIP');
    }

    const requestedCentre = req.headers['x-healthcare-centre-id'];
    const membership = requestedCentre
      ? memberships.find((item) => item.healthcare_centre_id === requestedCentre)
      : memberships[0];

    if (!membership) {
      throw new AuthenticationError('You do not have access to the requested healthcare centre', 'CENTRE_ACCESS_DENIED');
    }

    const permissions = await loadPermissions(membership.role_id);

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name
    };
    req.memberships = memberships;
    req.scope = {
      membershipId: membership.id,
      healthcareCentreId: membership.healthcare_centre_id,
      centreName: membership.centre_name,
      roleCode: membership.role_code,
      permissions: new Set(permissions)
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authenticate;

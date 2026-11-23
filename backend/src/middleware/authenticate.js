const jwt = require('jsonwebtoken');
const environment = require('../config/environment');
const { query } = require('../database/connection');
const { AuthenticationError, ForbiddenError } = require('../shared/errors/AppError');

const LOCAL_GOVERNMENT_PATHS = [
  '/api/organisations/structure',
  '/api/lg',
  '/api/auth',
  '/api/organisations/lg',
  '/api/notifications'
];

const LOCAL_GOVERNMENT_ONLY_PATHS = ['/api/lg'];

const loadMemberships = async (userId) => {
  const { rows } = await query(
    `SELECT m.id, m.healthcare_centre_id, m.local_government_id, m.role_id,
            r.code AS role_code, r.name AS role_name,
            hc.name AS centre_name, hc.code AS centre_code,
            lg.name AS local_government_name, lg.code AS local_government_code,
            s.name AS state_name
       FROM user_memberships m
       JOIN roles r ON r.id = m.role_id
       JOIN local_governments lg ON lg.id = m.local_government_id
       JOIN states s ON s.id = lg.state_id
       LEFT JOIN healthcare_centres hc ON hc.id = m.healthcare_centre_id AND hc.is_active = TRUE
      WHERE m.user_id = $1
        AND m.is_active = TRUE
        AND (m.healthcare_centre_id IS NULL OR hc.id IS NOT NULL)
      ORDER BY hc.name NULLS LAST, lg.name`,
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

const isLocalGovernmentPath = (originalUrl) =>
  LOCAL_GOVERNMENT_PATHS.some((prefix) => (originalUrl || '').startsWith(prefix));

const authenticate = async (req, res, next) => {
  const isLocalGovernmentOnlyPath = (originalUrl) =>
    LOCAL_GOVERNMENT_ONLY_PATHS.some((prefix) => (originalUrl || '').startsWith(prefix));

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
      throw new AuthenticationError('No active membership was found for this account', 'NO_MEMBERSHIP');
    }

    const centreMemberships = memberships.filter((item) => item.healthcare_centre_id);
    const requestedCentre = req.headers['x-healthcare-centre-id'];
    let membership;

    const localGovernmentMembership = memberships.find((item) => !item.healthcare_centre_id);
    const preferLocalGovernment =
      Boolean(localGovernmentMembership) && isLocalGovernmentOnlyPath(req.originalUrl);

    if (preferLocalGovernment) {
      membership = localGovernmentMembership;
    } else if (requestedCentre) {
      membership = centreMemberships.find((item) => item.healthcare_centre_id === requestedCentre);
      if (!membership) {
        throw new AuthenticationError(
          'You do not have access to the requested healthcare centre',
          'CENTRE_ACCESS_DENIED'
        );
      }
    } else if (
      payload.centreId &&
      centreMemberships.some((item) => item.healthcare_centre_id === payload.centreId)
    ) {
      membership = centreMemberships.find((item) => item.healthcare_centre_id === payload.centreId);
    } else {
      membership = centreMemberships[0] || memberships[0];
    }

    if (!membership.healthcare_centre_id && !isLocalGovernmentPath(req.originalUrl)) {
      throw new ForbiddenError(
        'This account works at local government level and cannot open facility stock screens',
        'LOCAL_GOVERNMENT_ACCOUNT'
      );
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
      scopeType: membership.healthcare_centre_id ? 'facility' : 'local_government',
      healthcareCentreId: membership.healthcare_centre_id || null,
      centreName: membership.centre_name || null,
      localGovernmentId: membership.local_government_id,
      localGovernmentName: membership.local_government_name,
      stateName: membership.state_name,
      roleCode: membership.role_code,
      roleName: membership.role_name,
      permissions: new Set(permissions)
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authenticate;

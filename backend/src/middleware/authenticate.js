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

const VENDOR_PATHS = ['/api/vendor', '/api/auth', '/api/notifications'];

const loadMemberships = async (userId) => {
  const { rows } = await query(
    `SELECT m.id, m.healthcare_centre_id, m.local_government_id, m.role_id,
            r.code AS role_code, r.name AS role_name,
            hc.name AS centre_name, hc.code AS centre_code,
            lg.name AS local_government_name, lg.code AS local_government_code,
            s.id AS state_id, s.name AS state_name
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

const loadVendorAccount = async (userId) => {
  const { rows } = await query(
    `SELECT vu.vendor_id, v.vendor_code, v.legal_name, v.status, v.state_id,
            r.id AS role_id, r.code AS role_code, r.name AS role_name
       FROM vendor_users vu
       JOIN vendors v ON v.id = vu.vendor_id
       JOIN roles r ON r.code = 'VENDOR'
      WHERE vu.user_id = $1
        AND vu.is_active = TRUE
        AND v.status <> 'excluded'`,
    [userId]
  );
  return rows[0] || null;
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

const matchesPath = (paths, originalUrl) =>
  paths.some((prefix) => (originalUrl || '').startsWith(prefix));

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

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name
    };

    const memberships = await loadMemberships(user.id);

    if (memberships.length === 0) {
      const vendor = await loadVendorAccount(user.id);
      if (!vendor) {
        throw new AuthenticationError('No active membership was found for this account', 'NO_MEMBERSHIP');
      }
      if (!matchesPath(VENDOR_PATHS, req.originalUrl)) {
        throw new ForbiddenError(
          'This is a vendor account and can only open the vendor portal',
          'VENDOR_ACCOUNT'
        );
      }

      const permissions = await loadPermissions(vendor.role_id);
      req.memberships = [];
      req.scope = {
        membershipId: null,
        scopeType: 'vendor',
        healthcareCentreId: null,
        centreName: null,
        localGovernmentId: null,
        localGovernmentName: null,
        stateId: vendor.state_id,
        stateName: null,
        vendorId: vendor.vendor_id,
        vendorCode: vendor.vendor_code,
        vendorName: vendor.legal_name,
        vendorStatus: vendor.status,
        roleCode: vendor.role_code,
        roleName: vendor.role_name,
        permissions: new Set(permissions)
      };
      return next();
    }

    const centreMemberships = memberships.filter((item) => item.healthcare_centre_id);
    const requestedCentre = req.headers['x-healthcare-centre-id'];
    let membership;

    const localGovernmentMembership = memberships.find((item) => !item.healthcare_centre_id);
    const preferLocalGovernment =
      Boolean(localGovernmentMembership) && matchesPath(LOCAL_GOVERNMENT_ONLY_PATHS, req.originalUrl);

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

    if (!membership.healthcare_centre_id && !matchesPath(LOCAL_GOVERNMENT_PATHS, req.originalUrl)) {
      throw new ForbiddenError(
        'This account works at local government level and cannot open facility stock screens',
        'LOCAL_GOVERNMENT_ACCOUNT'
      );
    }

    const permissions = await loadPermissions(membership.role_id);

    req.memberships = memberships;
    req.scope = {
      membershipId: membership.id,
      scopeType: membership.healthcare_centre_id ? 'facility' : 'local_government',
      healthcareCentreId: membership.healthcare_centre_id || null,
      centreName: membership.centre_name || null,
      localGovernmentId: membership.local_government_id,
      localGovernmentName: membership.local_government_name,
      stateId: membership.state_id,
      stateName: membership.state_name,
      vendorId: null,
      vendorCode: null,
      vendorName: null,
      vendorStatus: null,
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

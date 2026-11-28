const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const environment = require('../../config/environment');
const { query, withTransaction } = require('../../database/connection');
const { AuthenticationError, NotFoundError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const repository = require('./auth.repository');

const signToken = (user, healthcareCentreId) =>
  jwt.sign(
    {
      sub: user.id,
      ver: user.token_version,
      centreId: healthcareCentreId || null
    },
    environment.jwt.secret,
    {
      expiresIn: environment.jwt.expiresIn,
      issuer: environment.jwt.issuer
    }
  );

const selectMembership = (memberships, healthcareCentreId) => {
  if (healthcareCentreId) {
    return memberships.find((item) => item.healthcare_centre_id === healthcareCentreId) || null;
  }
  const centreMembership = memberships.find((item) => item.healthcare_centre_id);
  return centreMembership || memberships[0] || null;
};

const buildVendorSession = async (user, vendor) => {
  const permissions = await repository.getPermissions(vendor.role_id);

  return {
    token: signToken(user, null),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      mustChangePassword: user.must_change_password
    },
    memberships: [],
    activeCentre: null,
    activeLocalGovernment: null,
    scopeType: 'vendor',
    vendor: {
      id: vendor.vendor_id,
      code: vendor.vendor_code,
      legalName: vendor.legal_name,
      status: vendor.status,
      stateId: vendor.state_id,
      stateName: vendor.state_name || null
    },
    role: {
      code: vendor.role_code,
      name: vendor.role_name
    },
    permissions
  };
};

const buildSessionForMembership = async (user, memberships, membership) => {
  const permissions = await repository.getPermissions(membership.role_id);

  return {
    token: signToken(user, membership.healthcare_centre_id),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      mustChangePassword: user.must_change_password
    },
    memberships: memberships.map((item) => ({
      id: item.id,
      healthcareCentreId: item.healthcare_centre_id,
      centreName: item.centre_name,
      centreCode: item.centre_code,
      localGovernmentId: item.local_government_id,
      localGovernmentName: item.local_government_name,
      roleCode: item.role_code,
      roleName: item.role_name
    })),
    activeCentre: membership.healthcare_centre_id
      ? {
          id: membership.healthcare_centre_id,
          name: membership.centre_name,
          code: membership.centre_code
        }
      : null,
    activeLocalGovernment: {
      id: membership.local_government_id,
      name: membership.local_government_name,
      code: membership.local_government_code,
      stateId: membership.state_id,
      stateName: membership.state_name
    },
    scopeType: membership.healthcare_centre_id ? 'facility' : 'local_government',
    vendor: null,
    role: {
      code: membership.role_code,
      name: membership.role_name
    },
    permissions
  };
};

const buildSession = async (user, memberships, healthcareCentreId) => {
  const membership = selectMembership(memberships, healthcareCentreId);

  if (!membership) {
    throw new AuthenticationError(
      'You do not have access to the requested healthcare centre',
      'CENTRE_ACCESS_DENIED'
    );
  }

  return buildSessionForMembership(user, memberships, membership);
};

const buildSessionForAccount = async (user, memberships, healthcareCentreId) => {
  if (memberships.length === 0) {
    const vendor = await repository.getVendorAccount(user.id);
    if (!vendor) {
      throw new AuthenticationError('This account has no active membership', 'NO_MEMBERSHIP');
    }
    return buildVendorSession(user, vendor);
  }

  return buildSession(user, memberships, healthcareCentreId);
};

const login = async ({ email, password, ipAddress }) => {
  const user = await repository.findByEmail(email);

  if (!user || !user.is_active) {
    throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new AuthenticationError(
      'This account is temporarily locked after repeated failed logins',
      'ACCOUNT_LOCKED'
    );
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    const attempts = Number(user.failed_login_attempts) + 1;
    const lockedUntil =
      attempts >= environment.security.maxLoginAttempts
        ? new Date(Date.now() + environment.security.lockMinutes * 60 * 1000)
        : null;
    await repository.recordFailedLogin(user.id, attempts, lockedUntil);
    throw new AuthenticationError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const memberships = await repository.getMemberships(user.id);
  const vendor = memberships.length === 0 ? await repository.getVendorAccount(user.id) : null;

  if (memberships.length === 0 && !vendor) {
    throw new AuthenticationError('This account has no active membership', 'NO_MEMBERSHIP');
  }

  await repository.recordSuccessfulLogin(user.id);

  if (vendor) {
    const session = await buildVendorSession(user, vendor);

    await recordAudit(
      { query },
      {
        vendorId: vendor.vendor_id,
        actor: { id: user.id, fullName: user.full_name },
        actorRoleCode: vendor.role_code,
        actorScopeType: 'vendor',
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        summary: 'Vendor signed in',
        newValues: { email: user.email, ipAddress: ipAddress || null }
      }
    );

    return { ...session, expiresIn: environment.jwt.expiresIn };
  }

  const session = await buildSession(user, memberships);
  const membership = selectMembership(memberships);

  await recordAudit(
    { query },
    {
      healthcareCentreId: membership.healthcare_centre_id,
      localGovernmentId: membership.local_government_id,
      actor: { id: user.id, fullName: user.full_name },
      actorRoleCode: membership.role_code,
      actorScopeType: membership.healthcare_centre_id ? 'facility' : 'local_government',
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      summary: 'User signed in',
      newValues: { email: user.email, ipAddress: ipAddress || null }
    }
  );

  return { ...session, expiresIn: environment.jwt.expiresIn };
};

const getProfile = async (userId, healthcareCentreId) => {
  const user = await repository.findById(userId);
  if (!user) {
    throw new NotFoundError('User account was not found');
  }
  const memberships = await repository.getMemberships(user.id);
  return buildSessionForAccount(user, memberships, healthcareCentreId);
};

const switchMembership = async ({ actor, membershipId }) => {
  const user = await repository.findById(actor.id);
  if (!user || !user.is_active) {
    throw new NotFoundError('User account was not found');
  }

  const memberships = await repository.getMemberships(user.id);
  const membership = memberships.find((item) => item.id === membershipId);
  if (!membership) {
    throw new AuthenticationError(
      'That membership is not available to this account',
      'MEMBERSHIP_NOT_FOUND'
    );
  }

  const session = await buildSessionForMembership(user, memberships, membership);

  await recordAudit(
    { query },
    {
      healthcareCentreId: membership.healthcare_centre_id,
      localGovernmentId: membership.local_government_id,
      actor: { id: actor.id, fullName: actor.fullName },
      actorRoleCode: membership.role_code,
      actorScopeType: membership.healthcare_centre_id ? 'facility' : 'local_government',
      action: 'auth.membership_switched',
      entityType: 'user',
      entityId: actor.id,
      summary: `Switched to ${membership.centre_name || membership.local_government_name}`,
      newValues: { membershipId: membership.id, roleCode: membership.role_code }
    }
  );

  return { ...session, expiresIn: environment.jwt.expiresIn };
};

const logout = async (actor, scope) =>
  withTransaction(async (client) => {
    await repository.revokeSessions(client, actor.id);
    await recordAudit(client, {
      healthcareCentreId: scope.healthcareCentreId,
      localGovernmentId: scope.localGovernmentId,
      vendorId: scope.vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'auth.logout',
      entityType: 'user',
      entityId: actor.id,
      summary: 'User signed out'
    });
    return { message: 'Signed out successfully' };
  });

const changePassword = async ({ actor, scope, currentPassword, newPassword }) => {
  const user = await repository.findById(actor.id);
  if (!user) {
    throw new NotFoundError('User account was not found');
  }

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    throw new AuthenticationError('The current password is not correct', 'INVALID_CURRENT_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(newPassword, environment.security.bcryptRounds);

  const updated = await withTransaction(async (client) => {
    const result = await repository.updatePassword(client, actor.id, passwordHash);
    await recordAudit(client, {
      healthcareCentreId: scope.healthcareCentreId,
      localGovernmentId: scope.localGovernmentId,
      vendorId: scope.vendorId,
      actor,
      actorRoleCode: scope.roleCode,
      actorScopeType: scope.scopeType,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: actor.id,
      summary: 'Password changed'
    });
    return result;
  });

  const memberships = await repository.getMemberships(actor.id);
  const refreshedUser = await repository.findById(actor.id);
  return buildSessionForAccount(
    { ...refreshedUser, token_version: updated.token_version },
    memberships,
    scope.healthcareCentreId
  );
};

module.exports = {
  login,
  getProfile,
  switchMembership,
  logout,
  changePassword
};

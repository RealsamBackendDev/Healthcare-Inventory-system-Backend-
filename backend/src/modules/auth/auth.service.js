const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const environment = require('../../config/environment');
const { query, withTransaction } = require('../../database/connection');
const { AuthenticationError, NotFoundError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const repository = require('./auth.repository');

const signToken = (user, centreId) =>
  jwt.sign(
    {
      sub: user.id,
      ver: user.token_version,
      centreId: centreId || null
    },
    environment.jwt.secret,
    {
      expiresIn: environment.jwt.expiresIn,
      issuer: environment.jwt.issuer
    }
  );

const buildSession = async (user, memberships, centreId) => {
  const membership = centreId
    ? memberships.find((item) => item.healthcare_centre_id === centreId)
    : memberships[0];

  if (!membership) {
    throw new AuthenticationError('You do not have access to the requested healthcare centre', 'CENTRE_ACCESS_DENIED');
  }

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
      roleCode: item.role_code,
      roleName: item.role_name
    })),
    activeCentre: {
      id: membership.healthcare_centre_id,
      name: membership.centre_name,
      code: membership.centre_code
    },
    role: {
      code: membership.role_code,
      name: membership.role_name
    },
    permissions
  };
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
  if (memberships.length === 0) {
    throw new AuthenticationError('This account is not assigned to a healthcare centre', 'NO_MEMBERSHIP');
  }

  await repository.recordSuccessfulLogin(user.id);

  const session = await buildSession(user, memberships);

  await recordAudit(
    { query },
    {
      healthcareCentreId: memberships[0].healthcare_centre_id,
      actor: { id: user.id, fullName: user.full_name },
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      summary: 'User signed in',
      newValues: { email: user.email, ipAddress: ipAddress || null }
    }
  );

  return { ...session, expiresIn: environment.jwt.expiresIn };
};

const getProfile = async (userId, centreId) => {
  const user = await repository.findById(userId);
  if (!user) {
    throw new NotFoundError('User account was not found');
  }
  const memberships = await repository.getMemberships(user.id);
  return buildSession(user, memberships, centreId);
};

const logout = async (actor, centreId) =>
  withTransaction(async (client) => {
    await repository.revokeSessions(client, actor.id);
    await recordAudit(client, {
      healthcareCentreId: centreId,
      actor,
      action: 'auth.logout',
      entityType: 'user',
      entityId: actor.id,
      summary: 'User signed out'
    });
    return { message: 'Signed out successfully' };
  });

const changePassword = async ({ actor, centreId, currentPassword, newPassword }) => {
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
      healthcareCentreId: centreId,
      actor,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: actor.id,
      summary: 'Password changed'
    });
    return result;
  });

  const memberships = await repository.getMemberships(actor.id);
  const refreshedUser = await repository.findById(actor.id);
  return buildSession({ ...refreshedUser, token_version: updated.token_version }, memberships, centreId);
};

module.exports = {
  login,
  getProfile,
  logout,
  changePassword
};

const bcrypt = require('bcryptjs');
const environment = require('../../config/environment');
const { withTransaction } = require('../../database/connection');
const { ConflictError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { ROLES, SETTING_KEYS } = require('../../shared/constants');
const repository = require('./users.repository');

const mapUser = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  isActive: row.is_active,
  mustChangePassword: row.must_change_password,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  membershipId: row.membership_id,
  roleCode: row.role_code,
  roleName: row.role_name
});

const listUsers = async (healthcareCentreId, filters) => {
  const { page, pageSize, offset, limit } = getPagination(filters);
  let isActive;
  if (filters.status === 'active') {
    isActive = true;
  } else if (filters.status === 'inactive') {
    isActive = false;
  }
  const { rows, total } = await repository.list({
    healthcareCentreId,
    search: filters.search || null,
    isActive,
    limit,
    offset
  });
  return {
    items: rows.map(mapUser),
    pagination: buildPaginationMeta({ page, pageSize, total })
  };
};

const resolveRole = async (roleCode) => {
  const role = await repository.findRoleByCode(roleCode);
  if (!role) {
    throw new ValidationError('Unknown role', [{ field: 'roleCode', message: 'This role does not exist' }]);
  }
  return role;
};

const createUser = async ({ actor, healthcareCentreId, fullName, email, password, roleCode }) => {
  const existing = await repository.findByEmail(email);
  if (existing) {
    throw new ConflictError('A user with this email address already exists', 'EMAIL_IN_USE');
  }

  const role = await resolveRole(roleCode);
  const passwordHash = await bcrypt.hash(password, environment.security.bcryptRounds);

  return withTransaction(async (client) => {
    const user = await repository.createUser(client, { email, fullName, passwordHash });
    await repository.createMembership(client, {
      userId: user.id,
      healthcareCentreId,
      roleId: role.id
    });
    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      summary: `Created user ${user.full_name} with role ${role.name}`,
      newValues: { email: user.email, fullName: user.full_name, roleCode: role.code }
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      isActive: user.is_active,
      mustChangePassword: user.must_change_password,
      roleCode: role.code,
      roleName: role.name
    };
  });
};

const updateUser = async ({ actor, healthcareCentreId, userId, fullName, isActive, roleCode }) => {
  const membership = await repository.findMembership(healthcareCentreId, userId);
  if (!membership) {
    throw new NotFoundError('This user does not belong to your healthcare centre');
  }

  if (userId === actor.id && isActive === false) {
    throw new ConflictError('You cannot deactivate your own account', 'SELF_DEACTIVATION');
  }

  const role = roleCode ? await resolveRole(roleCode) : null;

  return withTransaction(async (client) => {
    const previous = {
      fullName: membership.full_name,
      isActive: membership.user_active
    };

    const user = await repository.updateUser(client, userId, { fullName, isActive });

    if (role && role.id !== membership.role_id) {
      await repository.updateMembershipRole(client, membership.id, role.id);
      await client.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
    }

    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'user.updated',
      entityType: 'user',
      entityId: userId,
      summary: `Updated user ${user.full_name}`,
      previousValues: previous,
      newValues: {
        fullName: user.full_name,
        isActive: user.is_active,
        roleCode: role ? role.code : undefined
      }
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      isActive: user.is_active,
      roleCode: role ? role.code : null
    };
  });
};

const resetPassword = async ({ actor, healthcareCentreId, userId, newPassword }) => {
  const membership = await repository.findMembership(healthcareCentreId, userId);
  if (!membership) {
    throw new NotFoundError('This user does not belong to your healthcare centre');
  }

  const passwordHash = await bcrypt.hash(newPassword, environment.security.bcryptRounds);

  return withTransaction(async (client) => {
    await repository.setPassword(client, userId, passwordHash);
    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
      summary: `Reset password for ${membership.full_name}; user must change it at next login`
    });
    return { message: 'Password has been reset and all existing sessions were revoked' };
  });
};

const mapSettings = (rows) => {
  const settings = {};
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return {
    staffAdjustmentQuantityThreshold: Number.parseFloat(
      settings[SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD] || '0'
    ),
    staffAdjustmentValueThreshold: Number.parseFloat(
      settings[SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD] || '0'
    ),
    nearExpiryDays: Number.parseInt(settings[SETTING_KEYS.NEAR_EXPIRY_DAYS] || '90', 10),
    currency: 'NGN',
    currencySymbol: '₦',
    raw: rows
  };
};

const getSettings = async (healthcareCentreId) => {
  const rows = await repository.getSettings(healthcareCentreId);
  return mapSettings(rows);
};

const updateSettings = async ({ actor, healthcareCentreId, updates }) => {
  const entries = [];
  if (updates.staffAdjustmentQuantityThreshold !== undefined) {
    entries.push({
      key: SETTING_KEYS.ADJUSTMENT_QUANTITY_THRESHOLD,
      value: updates.staffAdjustmentQuantityThreshold,
      description: 'Maximum quantity a staff member may adjust without approval'
    });
  }
  if (updates.staffAdjustmentValueThreshold !== undefined) {
    entries.push({
      key: SETTING_KEYS.ADJUSTMENT_VALUE_THRESHOLD,
      value: updates.staffAdjustmentValueThreshold,
      description: 'Maximum monetary value a staff member may adjust without approval'
    });
  }
  if (updates.nearExpiryDays !== undefined) {
    entries.push({
      key: SETTING_KEYS.NEAR_EXPIRY_DAYS,
      value: updates.nearExpiryDays,
      description: 'Days before expiry that count as near expiry'
    });
  }

  if (entries.length === 0) {
    throw new ValidationError('No settings were supplied', [
      { field: 'settings', message: 'Provide at least one setting to update' }
    ]);
  }

  await withTransaction(async (client) => {
    for (const entry of entries) {
      await repository.upsertSetting(client, {
        healthcareCentreId,
        key: entry.key,
        value: entry.value,
        description: entry.description,
        actorId: actor.id
      });
    }
    await recordAudit(client, {
      healthcareCentreId,
      actor,
      action: 'settings.updated',
      entityType: 'system_settings',
      summary: 'System settings updated',
      newValues: Object.fromEntries(entries.map((entry) => [entry.key, String(entry.value)]))
    });
  });

  return getSettings(healthcareCentreId);
};

const listRoles = () => [
  { code: ROLES.ADMINISTRATOR, name: 'Administrator' },
  { code: ROLES.STAFF, name: 'Staff' }
];

module.exports = {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  getSettings,
  updateSettings,
  listRoles
};

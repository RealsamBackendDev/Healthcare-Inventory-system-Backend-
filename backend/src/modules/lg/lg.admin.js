const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../shared/utils/asyncHandler');
const environment = require('../../config/environment');
const { query, withTransaction } = require('../../database/connection');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { PERMISSIONS } = require('../../shared/constants');

const router = express.Router();

const LG_ROLE_CODES = ['LG_ADMIN', 'LG_INVENTORY_OFFICER'];
const FACILITY_ROLE_CODES = ['ADMINISTRATOR', 'STAFF'];
const ALL_ROLE_CODES = [...LG_ROLE_CODES, ...FACILITY_ROLE_CODES];

const requireScope = (scope) => {
  if (!scope || scope.scopeType !== 'local_government' || !scope.localGovernmentId) {
    throw new ForbiddenError('This screen is only available to local government accounts', 'LOCAL_GOVERNMENT_ONLY');
  }
  return scope.localGovernmentId;
};

const auditContext = (scope) => ({
  localGovernmentId: scope.localGovernmentId,
  actorRoleCode: scope.roleCode,
  actorScopeType: scope.scopeType
});

const createCentreSchema = z.object({
  name: z.string().trim().min(3, 'Centre name is required').max(120),
  code: z
    .string()
    .trim()
    .min(2, 'Centre code is required')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  address: z.string().trim().max(200).nullable().optional()
});

const updateCentreSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    address: z.string().trim().max(200).nullable().optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one change' });

const createUserSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('A valid email address is required').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  roleCode: z.enum(ALL_ROLE_CODES),
  centreId: z.string().uuid('Choose a valid centre').nullable().optional()
});

const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    isActive: z.boolean().optional(),
    roleCode: z.enum(ALL_ROLE_CODES).optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one change' });

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

const centreIdParamSchema = z.object({ centreId: z.string().uuid('A valid centre id is required') });
const userIdParamSchema = z.object({ userId: z.string().uuid('A valid user id is required') });

const listAuditQuerySchema = z.object({
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const mapCentre = (row) => ({
  id: row.id,
  name: row.name,
  code: row.code,
  address: row.address,
  isActive: row.is_active,
  userCount: Number(row.user_count || 0),
  openRequests: Number(row.open_requests || 0),
  createdAt: row.created_at
});

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
  roleName: row.role_name,
  centreId: row.healthcare_centre_id,
  centreName: row.centre_name,
  scopeType: row.healthcare_centre_id ? 'facility' : 'local_government'
});

const findRole = async (client, roleCode) => {
  const { rows } = await client.query('SELECT id, code, name FROM roles WHERE code = $1', [roleCode]);
  if (!rows[0]) {
    throw new ValidationError('Unknown role', [{ field: 'roleCode', message: 'This role does not exist' }]);
  }
  return rows[0];
};

const findCentre = async (client, localGovernmentId, centreId) => {
  const { rows } = await client.query(
    'SELECT id, name, code, address, is_active FROM healthcare_centres WHERE id = $1 AND local_government_id = $2',
    [centreId, localGovernmentId]
  );
  if (!rows[0]) {
    throw new NotFoundError('This centre does not belong to your local government');
  }
  return rows[0];
};

router.get(
  '/admin/centres',
  authenticate,
  authorize(PERMISSIONS.ORGANISATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { rows } = await query(
      `SELECT hc.id, hc.name, hc.code, hc.address, hc.is_active, hc.created_at,
              (SELECT count(*)::int FROM user_memberships m
                WHERE m.healthcare_centre_id = hc.id AND m.is_active = TRUE) AS user_count,
              (SELECT count(*)::int FROM requisitions r
                WHERE r.healthcare_centre_id = hc.id
                  AND r.status IN ('pending_approval', 'approved')) AS open_requests
         FROM healthcare_centres hc
        WHERE hc.local_government_id = $1
        ORDER BY hc.is_active DESC, hc.name`,
      [localGovernmentId]
    );
    res.json({ success: true, data: { centres: rows.map(mapCentre) } });
  })
);

router.post(
  '/admin/centres',
  authenticate,
  authorize(PERMISSIONS.ORGANISATIONS_MANAGE),
  validate({ body: createCentreSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const code = req.body.code.toUpperCase();

    const centre = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        'SELECT id FROM healthcare_centres WHERE lower(code) = lower($1)',
        [code]
      );
      if (existing[0]) {
        throw new ConflictError('A centre with this code already exists', 'CENTRE_CODE_IN_USE');
      }

      const { rows } = await client.query(
        `INSERT INTO healthcare_centres (local_government_id, name, code, address)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, code, address, is_active, created_at`,
        [localGovernmentId, req.body.name, code, req.body.address || null]
      );
      const created = rows[0];

      await client.query(
        `INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
         VALUES ($1, $2, 'facility', $3, $4)`,
        [localGovernmentId, created.id, `${created.name} Main Store`, `${code}-MAIN`]
      );

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'centre.created',
        entityType: 'healthcare_centre',
        entityId: created.id,
        summary: `Created centre ${created.name} (${created.code})`,
        newValues: { name: created.name, code: created.code, address: created.address }
      });

      return created;
    });

    res.status(201).json({ success: true, data: mapCentre(centre) });
  })
);

router.patch(
  '/admin/centres/:centreId',
  authenticate,
  authorize(PERMISSIONS.ORGANISATIONS_MANAGE),
  validate({ params: centreIdParamSchema, body: updateCentreSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const changes = req.body;

    const updated = await withTransaction(async (client) => {
      const centre = await findCentre(client, localGovernmentId, req.params.centreId);
      const { rows } = await client.query(
        `UPDATE healthcare_centres
            SET name = COALESCE($2, name),
                address = COALESCE($3, address),
                is_active = COALESCE($4, is_active)
          WHERE id = $1
          RETURNING id, name, code, address, is_active, created_at`,
        [
          centre.id,
          changes.name === undefined ? null : changes.name,
          changes.address === undefined ? null : changes.address,
          changes.isActive === undefined ? null : changes.isActive
        ]
      );

      if (changes.isActive === false) {
        await client.query(
          `UPDATE user_memberships SET is_active = FALSE
            WHERE healthcare_centre_id = $1 AND is_active = TRUE`,
          [centre.id]
        );
      }

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'centre.updated',
        entityType: 'healthcare_centre',
        entityId: centre.id,
        summary: `Updated centre ${rows[0].name}`,
        previousValues: { name: centre.name, address: centre.address, isActive: centre.is_active },
        newValues: changes
      });

      return rows[0];
    });

    res.json({ success: true, data: mapCentre(updated) });
  })
);

router.get(
  '/admin/users',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
              m.id AS membership_id, m.healthcare_centre_id,
              r.code AS role_code, r.name AS role_name, hc.name AS centre_name
         FROM users u
         JOIN user_memberships m ON m.user_id = u.id AND m.is_active = TRUE
         JOIN roles r ON r.id = m.role_id
         LEFT JOIN healthcare_centres hc ON hc.id = m.healthcare_centre_id
        WHERE m.local_government_id = $1
        ORDER BY m.healthcare_centre_id NULLS FIRST, u.full_name`,
      [localGovernmentId]
    );
    res.json({ success: true, data: { users: rows.map(mapUser) } });
  })
);

router.post(
  '/admin/users',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { fullName, email, password, roleCode, centreId } = req.body;
    const isFacilityRole = FACILITY_ROLE_CODES.includes(roleCode);

    if (isFacilityRole && !centreId) {
      throw new ValidationError('Choose the centre this facility user works in', [
        { field: 'centreId', message: 'A centre is required for this role' }
      ]);
    }
    if (!isFacilityRole && centreId) {
      throw new ValidationError('Local government roles are not attached to a centre', [
        { field: 'centreId', message: 'Leave the centre empty for a local government role' }
      ]);
    }

    const passwordHash = await bcrypt.hash(password, environment.security.bcryptRounds);

    const created = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [
        email
      ]);
      if (existing[0]) {
        throw new ConflictError('A user with this email address already exists', 'EMAIL_IN_USE');
      }

      let centre = null;
      if (centreId) {
        centre = await findCentre(client, localGovernmentId, centreId);
      }

      const role = await findRole(client, roleCode);

      const { rows: userRows } = await client.query(
        `INSERT INTO users (email, full_name, password_hash, must_change_password)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id, email, full_name, is_active, must_change_password, created_at`,
        [email, fullName, passwordHash]
      );
      const user = userRows[0];

      await client.query(
        `INSERT INTO user_memberships (user_id, healthcare_centre_id, local_government_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [user.id, centre ? centre.id : null, localGovernmentId, role.id]
      );

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        summary: `Created ${role.name} account for ${user.full_name}${centre ? ` at ${centre.name}` : ''}`,
        newValues: { email: user.email, fullName: user.full_name, roleCode: role.code, centre: centre?.name || null }
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isActive: user.is_active,
        mustChangePassword: user.must_change_password,
        createdAt: user.created_at,
        roleCode: role.code,
        roleName: role.name,
        centreId: centre ? centre.id : null,
        centreName: centre ? centre.name : null,
        scopeType: centre ? 'facility' : 'local_government'
      };
    });

    res.status(201).json({ success: true, data: created });
  })
);

router.patch(
  '/admin/users/:userId',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { userId } = req.params;
    const changes = req.body;

    if (userId === req.user.id && changes.isActive === false) {
      throw new ConflictError('You cannot deactivate your own account', 'SELF_DEACTIVATION');
    }

    const updated = await withTransaction(async (client) => {
      const { rows: memberships } = await client.query(
        `SELECT m.id, m.healthcare_centre_id, m.role_id, u.full_name, u.is_active
           FROM user_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.user_id = $1 AND m.local_government_id = $2 AND m.is_active = TRUE`,
        [userId, localGovernmentId]
      );
      const membership = memberships[0];
      if (!membership) {
        throw new NotFoundError('This user does not belong to your local government');
      }

      if (changes.roleCode) {
        const allowed = membership.healthcare_centre_id ? FACILITY_ROLE_CODES : LG_ROLE_CODES;
        if (!allowed.includes(changes.roleCode)) {
          throw new ValidationError('That role does not fit this account', [
            { field: 'roleCode', message: 'Pick a role for the same level as this account' }
          ]);
        }
        const role = await findRole(client, changes.roleCode);
        await client.query('UPDATE user_memberships SET role_id = $2 WHERE id = $1', [membership.id, role.id]);
        await client.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
      }

      const { rows } = await client.query(
        `UPDATE users
            SET full_name = COALESCE($2, full_name),
                is_active = COALESCE($3, is_active),
                token_version = CASE WHEN $3 IS DISTINCT FROM NULL AND $3 <> is_active
                                     THEN token_version + 1 ELSE token_version END,
                updated_at = now()
          WHERE id = $1
          RETURNING id, email, full_name, is_active, must_change_password, created_at`,
        [userId, changes.fullName === undefined ? null : changes.fullName, changes.isActive === undefined ? null : changes.isActive]
      );

      const { rows: fresh } = await client.query(
        `SELECT m.id AS membership_id, m.healthcare_centre_id, r.code AS role_code, r.name AS role_name,
                hc.name AS centre_name
           FROM user_memberships m
           JOIN roles r ON r.id = m.role_id
           LEFT JOIN healthcare_centres hc ON hc.id = m.healthcare_centre_id
          WHERE m.id = $1`,
        [membership.id]
      );

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'user.updated',
        entityType: 'user',
        entityId: userId,
        summary: `Updated account ${rows[0].full_name}`,
        previousValues: { fullName: membership.full_name, isActive: membership.is_active },
        newValues: changes
      });

      return { ...rows[0], ...fresh[0] };
    });

    res.json({ success: true, data: mapUser(updated) });
  })
);

router.post(
  '/admin/users/:userId/reset-password',
  authenticate,
  authorize(PERMISSIONS.USERS_MANAGE),
  validate({ params: userIdParamSchema, body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { userId } = req.params;
    const passwordHash = await bcrypt.hash(req.body.newPassword, environment.security.bcryptRounds);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT u.id, u.full_name
           FROM users u
           JOIN user_memberships m ON m.user_id = u.id AND m.local_government_id = $2 AND m.is_active = TRUE
          WHERE u.id = $1`,
        [userId, localGovernmentId]
      );
      if (!rows[0]) {
        throw new NotFoundError('This user does not belong to your local government');
      }

      await client.query(
        `UPDATE users
            SET password_hash = $2, must_change_password = TRUE, password_changed_at = now(),
                failed_login_attempts = 0, locked_until = NULL,
                token_version = token_version + 1, updated_at = now()
          WHERE id = $1`,
        [userId, passwordHash]
      );

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: userId,
        summary: `Reset password for ${rows[0].full_name}; the user must change it at next sign in`
      });
    });

    res.json({ success: true, data: { message: 'Password reset. The user must change it at next sign in' } });
  })
);

router.get(
  '/admin/audit',
  authenticate,
  authorize(PERMISSIONS.AUDIT_VIEW),
  validate({ query: listAuditQuerySchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const limit = req.query.limit || 300;
    const params = [
      localGovernmentId,
      req.query.from || null,
      req.query.to || null,
      req.query.search || null
    ];

    const { rows } = await query(
      `SELECT ae.id, ae.created_at, ae.actor_full_name, ae.actor_role_code, ae.action,
              ae.entity_type, ae.entity_id, ae.summary, ae.reason, hc.name AS centre_name
         FROM audit_events ae
         LEFT JOIN healthcare_centres hc ON hc.id = ae.healthcare_centre_id
        WHERE ae.local_government_id = $1
          AND ($2::date IS NULL OR ae.created_at::date >= $2)
          AND ($3::date IS NULL OR ae.created_at::date <= $3)
          AND ($4::text IS NULL OR ae.action ILIKE '%' || $4 || '%'
               OR ae.summary ILIKE '%' || $4 || '%'
               OR ae.actor_full_name ILIKE '%' || $4 || '%'
               OR ae.entity_type ILIKE '%' || $4 || '%')
        ORDER BY ae.created_at DESC
        LIMIT $5`,
      [...params, limit]
    );

    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total
         FROM audit_events ae
        WHERE ae.local_government_id = $1
          AND ($2::date IS NULL OR ae.created_at::date >= $2)
          AND ($3::date IS NULL OR ae.created_at::date <= $3)
          AND ($4::text IS NULL OR ae.action ILIKE '%' || $4 || '%'
               OR ae.summary ILIKE '%' || $4 || '%'
               OR ae.actor_full_name ILIKE '%' || $4 || '%'
               OR ae.entity_type ILIKE '%' || $4 || '%')`,
      params
    );

    res.json({
      success: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          actorFullName: row.actor_full_name,
          actorRoleCode: row.actor_role_code,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          summary: row.summary,
          reason: row.reason,
          centreName: row.centre_name
        })),
        totalRows: countRows[0].total
      }
    });
  })
);

module.exports = router;

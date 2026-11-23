const express = require('express');
const { z } = require('zod');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../shared/utils/asyncHandler');
const { query, withTransaction } = require('../../database/connection');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../shared/errors/AppError');
const { recordAudit } = require('../../shared/utils/audit');
const { getPagination, buildPaginationMeta } = require('../../shared/utils/pagination');
const { PERMISSIONS } = require('../../shared/constants');

const router = express.Router();

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

const drugBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Drug code is required')
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'Drug code may only contain letters, numbers, dots, dashes and underscores'),
  name: z.string().trim().min(1, 'Drug name is required').max(120),
  genericName: z.string().trim().max(120).nullable().optional(),
  brandName: z.string().trim().max(120).nullable().optional(),
  strength: z.string().trim().max(60).nullable().optional(),
  dosageForm: z.string().trim().min(1, 'Dosage form is required').max(60),
  unitOfMeasure: z.string().trim().min(1, 'Unit of measure is required').max(30)
});

const updateDrugSchema = drugBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

const setActiveSchema = z.object({ isActive: z.boolean() });

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const drugIdParamSchema = z.object({ drugId: z.string().uuid('A valid drug id is required') });

const baseSelect = `
  SELECT d.id, d.code, d.name, d.generic_name, d.brand_name, d.strength, d.dosage_form,
         d.unit_of_measure, d.is_active, d.created_at, d.updated_at,
         (SELECT count(*)::int
            FROM facility_drug_settings fds
            JOIN healthcare_centres hc ON hc.id = fds.healthcare_centre_id
           WHERE fds.drug_id = d.id AND fds.is_active = TRUE AND hc.is_active = TRUE) AS centre_count
    FROM drugs d
   WHERE d.local_government_id = $1
`;

const mapDrug = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  genericName: row.generic_name,
  brandName: row.brand_name,
  strength: row.strength,
  dosageForm: row.dosage_form,
  unitOfMeasure: row.unit_of_measure,
  isActive: row.is_active,
  centreCount: row.centre_count === undefined ? undefined : Number(row.centre_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const findDrug = async (localGovernmentId, drugId) => {
  const { rows } = await query(`${baseSelect} AND d.id = $2`, [localGovernmentId, drugId]);
  return rows[0] || null;
};

const assertCodeAvailable = async (localGovernmentId, code, excludeDrugId) => {
  const { rows } = await query(
    `SELECT id, is_active FROM drugs
      WHERE local_government_id = $1 AND lower(code) = lower($2)`,
    [localGovernmentId, code]
  );
  const existing = rows[0];
  if (existing && existing.id !== excludeDrugId && existing.is_active) {
    throw new ConflictError('Another active drug already uses this code', 'DUPLICATE_DRUG_CODE');
  }
};

router.get(
  '/drugs',
  authenticate,
  authorize(PERMISSIONS.DRUGS_VIEW),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const { page, pageSize, offset, limit } = getPagination(req.query);

    let isActive = null;
    if (req.query.status === 'active') {
      isActive = true;
    } else if (req.query.status === 'inactive') {
      isActive = false;
    }

    const params = [localGovernmentId, req.query.search || null, isActive];
    const filter = `
      AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR d.code ILIKE '%' || $2 || '%'
           OR COALESCE(d.brand_name, '') ILIKE '%' || $2 || '%'
           OR COALESCE(d.generic_name, '') ILIKE '%' || $2 || '%')
      AND ($3::boolean IS NULL OR d.is_active = $3)
    `;

    const { rows } = await query(`${baseSelect} ${filter} ORDER BY d.name LIMIT $4 OFFSET $5`, [
      ...params,
      limit,
      offset
    ]);

    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total FROM drugs d WHERE d.local_government_id = $1 ${filter}`,
      params
    );

    res.json({
      success: true,
      data: {
        items: rows.map(mapDrug),
        pagination: buildPaginationMeta({ page, pageSize, total: countRows[0].total })
      }
    });
  })
);

router.get(
  '/drugs/:drugId',
  authenticate,
  authorize(PERMISSIONS.DRUGS_VIEW),
  validate({ params: drugIdParamSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const drug = await findDrug(localGovernmentId, req.params.drugId);
    if (!drug) {
      throw new NotFoundError('Drug was not found for this local government');
    }
    res.json({ success: true, data: mapDrug(drug) });
  })
);

router.post(
  '/drugs',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ body: drugBodySchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    await assertCodeAvailable(localGovernmentId, req.body.code);

    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO drugs
           (local_government_id, code, name, generic_name, brand_name, strength,
            dosage_form, unit_of_measure, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          localGovernmentId,
          req.body.code,
          req.body.name,
          req.body.genericName || null,
          req.body.brandName || null,
          req.body.strength || null,
          req.body.dosageForm,
          req.body.unitOfMeasure,
          req.user.id
        ]
      );
      const drugId = rows[0].id;

      await client.query(
        `INSERT INTO facility_drug_settings (healthcare_centre_id, drug_id, minimum_stock_level)
         SELECT hc.id, $2, 0
           FROM healthcare_centres hc
          WHERE hc.local_government_id = $1 AND hc.is_active = TRUE
         ON CONFLICT (healthcare_centre_id, drug_id) DO NOTHING`,
        [localGovernmentId, drugId]
      );

      const { rows: saved } = await client.query(`${baseSelect} AND d.id = $2`, [localGovernmentId, drugId]);

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'drug.created',
        entityType: 'drug',
        entityId: drugId,
        summary: `Created drug ${saved[0].name} (${saved[0].code})`,
        newValues: mapDrug(saved[0])
      });

      return saved[0];
    });

    res.status(201).json({ success: true, data: mapDrug(created) });
  })
);

router.patch(
  '/drugs/:drugId',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ params: drugIdParamSchema, body: updateDrugSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const existing = await findDrug(localGovernmentId, req.params.drugId);
    if (!existing) {
      throw new NotFoundError('Drug was not found for this local government');
    }
    if (req.body.code) {
      await assertCodeAvailable(localGovernmentId, req.body.code, existing.id);
    }

    const updated = await withTransaction(async (client) => {
      await client.query(
        `UPDATE drugs
            SET code = COALESCE($3, code),
                name = COALESCE($4, name),
                generic_name = COALESCE($5, generic_name),
                brand_name = COALESCE($6, brand_name),
                strength = COALESCE($7, strength),
                dosage_form = COALESCE($8, dosage_form),
                unit_of_measure = COALESCE($9, unit_of_measure),
                updated_at = now()
          WHERE id = $1 AND local_government_id = $2`,
        [
          existing.id,
          localGovernmentId,
          req.body.code || null,
          req.body.name || null,
          req.body.genericName === undefined ? null : req.body.genericName,
          req.body.brandName === undefined ? null : req.body.brandName,
          req.body.strength === undefined ? null : req.body.strength,
          req.body.dosageForm || null,
          req.body.unitOfMeasure || null
        ]
      );

      const { rows: saved } = await client.query(`${baseSelect} AND d.id = $2`, [localGovernmentId, existing.id]);

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: 'drug.updated',
        entityType: 'drug',
        entityId: existing.id,
        summary: `Updated drug ${saved[0].name} (${saved[0].code})`,
        previousValues: mapDrug(existing),
        newValues: mapDrug(saved[0])
      });

      return saved[0];
    });

    res.json({ success: true, data: mapDrug(updated) });
  })
);

router.post(
  '/drugs/:drugId/status',
  authenticate,
  authorize(PERMISSIONS.DRUGS_MANAGE),
  validate({ params: drugIdParamSchema, body: setActiveSchema }),
  asyncHandler(async (req, res) => {
    const localGovernmentId = requireScope(req.scope);
    const isActive = req.body.isActive;
    const existing = await findDrug(localGovernmentId, req.params.drugId);
    if (!existing) {
      throw new NotFoundError('Drug was not found for this local government');
    }
    if (isActive) {
      await assertCodeAvailable(localGovernmentId, existing.code, existing.id);
    }

    const updated = await withTransaction(async (client) => {
      await client.query(
        `UPDATE drugs SET is_active = $3, updated_at = now()
          WHERE id = $1 AND local_government_id = $2`,
        [existing.id, localGovernmentId, isActive]
      );

      await client.query(
        `UPDATE facility_drug_settings fds
            SET is_active = $3, updated_at = now()
           FROM healthcare_centres hc
          WHERE hc.id = fds.healthcare_centre_id
            AND hc.local_government_id = $1
            AND fds.drug_id = $2`,
        [localGovernmentId, existing.id, isActive]
      );

      const { rows: saved } = await client.query(`${baseSelect} AND d.id = $2`, [localGovernmentId, existing.id]);

      await recordAudit(client, {
        ...auditContext(req.scope),
        actor: req.user,
        action: isActive ? 'drug.reactivated' : 'drug.deactivated',
        entityType: 'drug',
        entityId: existing.id,
        summary: `${isActive ? 'Reactivated' : 'Deactivated'} drug ${saved[0].name} (${saved[0].code})`,
        previousValues: { isActive: existing.is_active },
        newValues: { isActive }
      });

      return saved[0];
    });

    res.json({ success: true, data: mapDrug(updated) });
  })
);

module.exports = router;

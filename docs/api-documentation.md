# API Documentation

Base URL: `http://127.0.0.1:4000/api`

All responses are JSON unless a report export format is requested.

## Authentication

Send `Authorization: Bearer <token>` on every request except login and health.

Optionally send `X-Healthcare-Centre-Id: <uuid>` to select another centre the user belongs to.

Tokens expire after 8 hours by default (`JWT_EXPIRES_IN`). Logging out, changing a password, an administrator resetting a password or deactivating an account revokes all existing tokens.

## Response shapes

Success:

```json
{ "success": true, "data": { } }
```

Failure:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "The submitted data is not valid", "details": [] } }
```

Common status codes: 400 malformed JSON, 401 authentication problem, 403 permission or scope denied, 404 not found, 409 conflict with current state, 413 upload too large, 422 validation failure, 429 rate limited, 500 unexpected error.

## Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Service and database status, returns 503 when the database is unreachable |

## Authentication

| Method | Path | Body |
| --- | --- | --- |
| POST | `/auth/login` | `{ "email", "password" }` returns token, user, memberships, active centre, role and permissions |
| GET | `/auth/me` | Current session profile |
| POST | `/auth/logout` | Revokes the current token version |
| POST | `/auth/change-password` | `{ "currentPassword", "newPassword" }`, returns a fresh session |

Login is limited to 10 failed attempts per IP per 15 minutes; accounts lock for 15 minutes after 5 consecutive failures.

## Users and settings

Requires `users.manage` except settings reads.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users?search=&status=active|inactive&page=&pageSize=` | Centre users with role |
| GET | `/users/roles` | Selectable roles |
| POST | `/users` | `{ fullName, email, password, roleCode }` roleCode is `ADMINISTRATOR` or `STAFF` |
| PATCH | `/users/:userId` | `{ fullName?, isActive?, roleCode? }` |
| POST | `/users/:userId/reset-password` | `{ newPassword }`, forces change at next login |
| GET | `/settings` | Thresholds, expiry window and currency |
| PUT | `/settings` | `{ staffAdjustmentQuantityThreshold?, staffAdjustmentValueThreshold?, nearExpiryDays? }` requires `settings.manage` |

## Organisations

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/organisations/me` | Active centre with state and local government |
| GET | `/organisations/structure` | Administrator only, states with local governments and centres |

## Drugs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/drugs?search=&status=active|inactive|all&page=&pageSize=` | Requires `drugs.view` |
| GET | `/drugs/:drugId` | Single drug with batch count and total quantity |
| POST | `/drugs` | Requires `drugs.manage`: code, name, genericName, brandName, strength, dosageForm, unitOfMeasure, minimumStockLevel |
| PATCH | `/drugs/:drugId` | Partial update |
| POST | `/drugs/:drugId/status` | `{ "isActive": true | false }` |

Drugs are never hard-deleted. Duplicate active codes return 409 `DUPLICATE_RECORD` or `DUPLICATE_DRUG_CODE`.

## Inventory

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/inventory?search=&status=in_stock|low_stock|out_of_stock&page=&pageSize=` | Usable, blocked, expired and total quantities with stock status |
| GET | `/inventory/batches?drugId=&status=&expiryStatus=usable|near_expiry|expired|no_expiry&search=&nearExpiryDays=&page=&pageSize=` | Batch list |
| GET | `/inventory/drugs/:drugId?nearExpiryDays=` | Drug summary with its batches |

## Receiving and import

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/receiving/receipts` | Requires `stock.receive`. `{ receiptReference?, supplier?, receivedDate?, note?, items: [{ drugId, batchNumber, quantity, expiryDate?, unitCost?, receivedDate?, supplierReference? }] }` |
| GET | `/receiving/receipts?search=&from=&to=&page=&pageSize=` | Receipt history |
| GET | `/receiving/receipts/:receiptId` | Receipt with items |
| POST | `/receiving/import/preview` | Requires `stock.import`. Multipart field `file` with CSV or XLSX. Returns validated rows and a summary |
| POST | `/receiving/import/commit` | `{ mode: "all_or_nothing" | "valid_only", rows: [...] }` creates a receipt and movements |

## Dispensing

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/dispensing` | Requires `stock.dispense`. `{ reference?, note?, items: [{ drugId, quantity }] }` returns allocations per batch |
| GET | `/dispensing?search=&from=&to=&page=&pageSize=` | Dispensing history |
| GET | `/dispensing/:dispensingId` | Record with per-batch allocations |

Insufficient usable stock returns 409 `INSUFFICIENT_STOCK`.

## Stock adjustments

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/adjustments?status=pending|approved|rejected&drugId=&from=&to=&page=&pageSize=` | Adjustment list |
| POST | `/adjustments` | `{ drugId, batchId, adjustmentType, quantity, reason, reference? }` types: `physical_count`, `damage`, `loss`, `correction`, `expiry_writeoff`, `other` |
| GET | `/adjustments/:adjustmentId` | Single adjustment |
| POST | `/adjustments/:adjustmentId/approve` | Requires `adjustments.approve`, `{ comment? }` |
| POST | `/adjustments/:adjustmentId/reject` | Requires `adjustments.approve`, `{ comment }` |
| POST | `/adjustments/stock-count` | `{ reason?, reference?, lines: [{ batchId, countedQuantity, reason? }] }` creates pending proposals |

Creating an adjustment returns `requiresApproval` and the applied `batchQuantity`.

## Returns

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/returns?status=pending|approved|rejected&from=&to=&page=&pageSize=` | Return requests |
| POST | `/returns` | `{ reason, reference?, items: [{ batchId, quantity, disposition }] }` |
| GET | `/returns/:returnId` | Request with items |
| POST | `/returns/:returnId/approve` | Requires `returns.approve`, `{ comment? }` |
| POST | `/returns/:returnId/reject` | Requires `returns.approve`, `{ comment }` |

## Requisitions

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/requisitions?status=&search=&from=&to=&page=&pageSize=` | Requisition list |
| GET | `/requisitions/shortages` | Shortage preview with suggested quantities |
| POST | `/requisitions/suggestions` | Creates an automatic draft from shortages |
| POST | `/requisitions` | `{ notes?, items: [{ drugId, requestedQuantity }] }` |
| GET | `/requisitions/:requisitionId` | Items and event timeline |
| PATCH | `/requisitions/:requisitionId` | Draft only, `{ notes?, items? }` |
| DELETE | `/requisitions/:requisitionId` | Draft only |
| POST | `/requisitions/:requisitionId/submit` | Draft to pending approval |
| POST | `/requisitions/:requisitionId/approve` | Requires `requisitions.approve`, `{ comment? }` |
| POST | `/requisitions/:requisitionId/reject` | Requires `requisitions.approve`, `{ reason }` |
| POST | `/requisitions/:requisitionId/cancel` | `{ reason? }` |
| POST | `/requisitions/:requisitionId/close` | Approved requisitions only |
| POST | `/requisitions/:requisitionId/amend` | Creates a linked amendment draft |

## Expiry

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/expiry/near-expiry?days=90&page=&pageSize=` | Batches expiring inside the window |
| GET | `/expiry/expired?page=&pageSize=` | Expired batches with remaining quantity |
| GET | `/expiry/summary` | Window counts and expired totals |
| POST | `/expiry/refresh` | Administrator only, marks expired batches and creates notifications |

## Notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications?isRead=read|unread&page=&pageSize=` | Current user's notifications |
| GET | `/notifications/unread-count` | `{ unread }` |
| PATCH | `/notifications/:notificationId/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark all as read |

## Dashboard and reports

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/reports/dashboard?days=90` | Overview, expiry totals, pending work, recent movements and requisitions, low stock and upcoming expiries |
| GET | `/reports/options` | Users, drugs, movement types and statuses for filters |
| GET | `/reports/inventory` | Inventory report |
| GET | `/reports/stock-movements?from=&to=&drugId=&movementType=&userId=` | Movement ledger report |
| GET | `/reports/dispensing?from=&to=&drugId=&userId=` | Dispensing report |
| GET | `/reports/expiry?status=near_expiry|expired|all&days=` | Expiry report |
| GET | `/reports/requisitions?from=&to=&status=` | Requisition report |
| GET | `/reports/adjustments?from=&to=&status=&drugId=` | Adjustment report |
| GET | `/reports/returns?from=&to=&status=` | Return report |
| GET | `/reports/audit?from=&to=&action=&userId=` | Audit history, requires `audit.view` |

All report endpoints accept `format=json` (default), `format=csv`, `format=xlsx` or `format=pdf`. File responses set `Content-Disposition` with a download filename.

Example:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:4000/api/reports/stock-movements?from=2026-11-01&to=2026-11-30&format=xlsx" \
  --output movements.xlsx
```

## Permissions reference

`users.manage`, `drugs.view`, `drugs.manage`, `inventory.view`, `stock.receive`, `stock.dispense`, `stock.import`, `adjustments.create`, `adjustments.approve`, `returns.request`, `returns.approve`, `requisitions.create`, `requisitions.approve`, `expiry.view`, `reports.view`, `audit.view`, `settings.manage`, `notifications.view`.

Administrators hold all permissions. Staff hold all except `users.manage`, `drugs.manage`, `stock.import`, `adjustments.approve`, `returns.approve`, `requisitions.approve`, `audit.view` and `settings.manage`.

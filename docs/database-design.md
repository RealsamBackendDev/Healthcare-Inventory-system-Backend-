# Database Design

PostgreSQL 14 or newer. All identifiers are UUIDs generated with `gen_random_uuid()`. Quantities and monetary values use `DOUBLE PRECISION` as required by the specification.

The schema is defined in `backend/src/database/migrations/001_init.sql` and applied with `npm run migrate`.

## Tables

| Table | Purpose |
| --- | --- |
| `states` | Top level geography |
| `local_governments` | Belongs to a state |
| `healthcare_centres` | Belongs to a local government, the organisation scope for all operational data |
| `users` | Login identities, password hashes, lockout state, token version |
| `roles` | Administrator and Staff |
| `permissions` | Granular capability codes |
| `role_permissions` | Many-to-many role permissions |
| `user_memberships` | Links a user to one healthcare centre with one role |
| `drugs` | Catalogue scoped to a healthcare centre |
| `batches` | Physical stock per drug and batch number with expiry, quantity, cost and status |
| `stock_movements` | Append-only ledger of every quantity change |
| `receipts` | Receipt header for manual receiving and imports |
| `receipt_items` | Batches received on a receipt |
| `dispensing_records` | Dispensing event header |
| `dispensing_items` | Per-batch FEFO allocation of a dispensing event |
| `stock_adjustments` | Manual adjustments and physical count variances with approval state |
| `return_requests` | Return request header |
| `return_request_items` | Batch, quantity and disposition requested for return |
| `requisitions` | Requisition header with lifecycle status |
| `requisition_items` | Requested drugs and quantities, with an automatic-generation flag |
| `requisition_events` | Timeline of every requisition action with actor |
| `notifications` | Per-user in-app notifications |
| `audit_events` | Append-only audit trail with before and after values |
| `system_settings` | Per-centre configuration such as adjustment thresholds |

## Relationships

```
states 1─* local_governments 1─* healthcare_centres
healthcare_centres 1─* user_memberships *─1 users
healthcare_centres 1─* drugs 1─* batches
batches 1─* stock_movements
receipts 1─* receipt_items *─1 batches
dispensing_records 1─* dispensing_items *─1 batches
stock_adjustments *─1 batches
return_requests 1─* return_request_items *─1 batches
requisitions 1─* requisition_items *─1 drugs
requisitions 1─* requisition_events
requisitions 1─1 requisitions (parent/superseded amendment links)
```

Every operational table carries `healthcare_centre_id`, and every query filters on it. There is no global role column on `users`; authorization always comes from the active membership.

## Quantity and money rules

- Quantities: `DOUBLE PRECISION`, `CHECK (quantity >= 0)` on batches, non-zero checks on movements and adjustments.
- Unit cost: `DOUBLE PRECISION`, nullable, `CHECK (unit_cost >= 0)`.
- Comparisons use a `1e-9` tolerance to avoid floating point residue blocking valid operations.
- Display rounds quantities to six decimal places and money to two.
- Stock balances can never go negative: the check constraint is the last line of defence, services reject the operation first.

## Status values

Batch status: `usable`, `expired`, `quarantined`, `blocked`, `recalled`, `returned_pending_inspection`, `destroyed`.

Movement type: `receipt`, `import`, `opening_stock`, `dispensing`, `adjustment`, `return`, `return_restock`, `reconciliation`.

Adjustment status: `pending`, `approved`, `rejected`.

Return status: `pending`, `approved`, `rejected`. Disposition: `return_to_supplier`, `quarantined`, `blocked`, `destroyed`, `restock_usable`.

Requisition status: `draft`, `pending_approval`, `approved`, `rejected`, `cancelled`, `closed`.

## Uniqueness and integrity

- `drugs_centre_code_active_unique` prevents duplicate active drug codes within a centre while allowing replacement of retired drugs.
- `batches_identity_unique` prevents duplicate batch numbers for the same drug and centre, case-insensitively.
- `users_email_unique` on `lower(email)` prevents duplicate accounts.
- `user_memberships_unique` gives one role per user per centre.
- Foreign keys use `ON DELETE RESTRICT` for operational records so history cannot be silently removed.
- Requisition and receipt numbers are unique.
- Append-only tables (`stock_movements`, `audit_events`, `requisition_events`) are never updated by the application.

## Indexes

Indexes cover the common access paths: centre and status on batches, drugs by centre and active state, movements by centre and creation time, notifications by user and read state, adjustments and returns by centre and status, requisitions by centre and status, audit by centre and time.

## Expiry semantics

A batch is usable while `status = 'usable'` and `expiry_date IS NULL OR expiry_date >= CURRENT_DATE`. On the day after the printed expiry date it is excluded from usable stock and cannot be dispensed. A daily refresh also flips its status to `expired` and creates notifications.

## Reporting reconciliation

- Inventory report totals derive from `batches`.
- Stock movement report totals derive from `stock_movements`.
- Every batch quantity equals opening stock plus all signed movements for that batch, because each service writes both inside one transaction.
- Dispensing totals derive from `dispensing_items`, which sum to the negative dispensing movements.

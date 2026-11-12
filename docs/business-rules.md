# Business Rules

## Roles and authorization

Two roles exist. Administrators hold every permission. Staff hold inventory viewing, receiving, dispensing, adjustment creation within thresholds, return requests, requisition creation and permitted reports.

Authorization is enforced only on the server through permission checks and the active membership's healthcare centre. Frontend controls are conveniences, never authorization.

A staff member can edit, delete, submit or cancel only their own draft requisitions. Administrators can act on any requisition in their centre. Nobody can approve a requisition they created.

## Organisation scope

Every drug, batch, movement, receipt, dispensing record, adjustment, return, requisition, notification, report and audit event belongs to one healthcare centre. Requests may select a centre through the `X-Healthcare-Centre-Id` header only when the user has an active membership for it.

## Quantity handling

Quantities are decimal and stored as double precision. Comparisons use a tolerance of `1e-9`. Quantities must be positive for receipts, dispensing, requisitions and returns; adjustments may be positive or negative but not zero. Stock never becomes negative.

## Receiving

A receipt creates or updates a batch and writes a positive movement in one transaction. If any row fails, nothing is committed.

Rules:

- The batch number is unique per drug per centre, compared case-insensitively.
- Receiving into an existing batch is allowed only when the batch is usable, not expired, and the supplied expiry date matches the stored one.
- Receiving into a quarantined, blocked, recalled, destroyed or expired batch is rejected. Create a new batch number instead.
- Decimal quantities such as 1.25 are accepted.
- A duplicate drug and batch number inside a single receipt is rejected.

## Stock import

Administrators upload CSV or Excel files. The preview endpoint validates structure and content before anything is written.

Accepted columns: drug code or drug name, batch number, expiry date, quantity, unit cost, received date, supplier reference. Drug codes are preferred; names must match exactly one active drug.

Rules:

- Default mode is all-or-nothing: any invalid row aborts the import.
- Valid-rows-only mode imports the good rows and reports skipped rows.
- At most 1000 rows per file and 5 MB per upload.
- Duplicate drug and batch pairs inside the file are rejected.
- Imported rows create a single receipt with source `import` and movements of type `import`.

## Dispensing and FEFO

1. Begin a transaction.
2. Lock all eligible batches for the drug with `SELECT ... FOR UPDATE`, ordered by expiry date, then received date.
3. Eligible means usable status, non-expired, and quantity greater than zero.
4. Sum the eligible quantity and reject the request if it is too small.
5. Allocate across batches in that order, decreasing each batch and writing negative movements and dispensing items.
6. Commit only when every line succeeds.

Concurrent dispensing cannot oversell because rows are locked. Expired, quarantined, blocked, recalled and returned-pending-inspection batches are never allocated. No patient data is collected; the optional reference and note must not identify a patient.

## Stock adjustments and stock count

An adjustment requires a drug, batch, type, quantity and reason.

Staff adjustments apply immediately only when both the absolute quantity and the monetary impact (`quantity × unit cost`) are within the configured thresholds. Otherwise the adjustment is created as `pending` and cannot change stock until an administrator approves it.

Administrators can apply adjustments directly. Every approval and rejection records the actor, timestamp and comment.

Physical stock count accepts counted quantities, compares them with system quantities, and creates one pending adjustment per variance for review. It never applies changes by itself.

Settings default: 10 units and ₦5,000. Both are administrator-configurable.

## Returns

Creating a return request never changes stock. Items record a batch, quantity and disposition.

Approval applies the disposition:

- `return_to_supplier`: quantity leaves the batch, negative `return` movement.
- `destroyed`: quantity leaves the batch, negative `return` movement; the batch becomes `destroyed` when its quantity reaches zero.
- `quarantined`: batch status becomes `quarantined`, quantity unchanged.
- `blocked`: batch status becomes `blocked`, quantity unchanged.
- `restock_usable`: batch status becomes `usable`, quantity unchanged, for inspected stock being released.

Rejection leaves stock untouched. Every decision is audited.

## Requisitions

Lifecycle: `draft` → `pending_approval` → `approved` / `rejected` → `closed`, with `cancelled` available from draft or pending.

- Drafts can be edited, have items replaced, and be deleted.
- Submission requires at least one item.
- Submitted, approved, rejected, cancelled and closed requisitions can never be hard-deleted.
- Amendments create a new draft copy, link it to the original, and mark the original as superseded.
- Only the creator or an administrator may edit, delete, submit or cancel a draft.
- Requisitions never change inventory.

## Automatic requisition drafts

Formula:

```
suggested_quantity = max(0, minimum_stock_level − usable_stock − quantity_covered_by_open_requisitions)
```

Open requisitions are those in draft, pending approval or approved. Drugs with a positive suggestion are placed in a new draft marked `source = automatic`, with each item flagged `is_auto_generated`. Nothing is submitted automatically. Because open coverage is subtracted, running the generator twice does not duplicate requests.

## Expiry monitoring

Alert windows are 90, 30 and 7 days before expiry, plus an expired alert. A batch remains usable through its printed expiry date; from the next day it is excluded from usable stock and blocked from dispensing.

The refresh operation marks newly expired batches and creates one notification per user per batch per window, so repeats do not spam. Notifications are in-app only.

## Audit trail

The following are audited with actor id, actor full name, server timestamp, action, entity, entity id and before/after values where relevant: logins, logouts, password changes, user creation and updates, drug changes, receipts, imports, dispensing, adjustments and approvals, returns and approvals, requisition events, settings changes and expiry refreshes.

Audit records are never edited or deleted.

## Reports

Reports cover inventory, stock movements, dispensing, expiry, requisitions, adjustments, returns and audit history. Every report supports in-app viewing with `format=json` and downloads with `format=csv`, `format=xlsx` or `format=pdf`.

Totals reconcile because they are computed from the underlying tables at request time. Monetary values are shown in Naira with two decimals.

## Errors and safe messages

Clients receive `{ success: false, error: { code, message, details } }`. Validation failures return field-level details. Database internals, stack traces and secrets are never returned in production.

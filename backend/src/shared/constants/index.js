const ROLES = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  LG_ADMIN: 'LG_ADMIN',
  LG_INVENTORY_OFFICER: 'LG_INVENTORY_OFFICER',
  ADMINISTRATOR: 'ADMINISTRATOR',
  STAFF: 'STAFF'
};

const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
  DRUGS_VIEW: 'drugs.view',
  DRUGS_MANAGE: 'drugs.manage',
  INVENTORY_VIEW: 'inventory.view',
  STOCK_RECEIVE: 'stock.receive',
  STOCK_DISPENSE: 'stock.dispense',
  STOCK_IMPORT: 'stock.import',
  ADJUSTMENTS_CREATE: 'adjustments.create',
  ADJUSTMENTS_APPROVE: 'adjustments.approve',
  RETURNS_REQUEST: 'returns.request',
  RETURNS_APPROVE: 'returns.approve',
  REQUISITIONS_CREATE: 'requisitions.create',
  REQUISITIONS_APPROVE: 'requisitions.approve',
  EXPIRY_VIEW: 'expiry.view',
  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  SETTINGS_MANAGE: 'settings.manage',
  NOTIFICATIONS_VIEW: 'notifications.view',
  ORGANISATIONS_MANAGE: 'organisations.manage',
  MEMBERSHIPS_MANAGE: 'memberships.manage',
  REQUISITIONS_SUBMIT: 'requisitions.submit',
  REQUISITIONS_LG_REVIEW: 'requisitions.lg_review',
  CONSOLIDATIONS_CREATE: 'consolidations.create',
  CONSOLIDATIONS_APPROVE: 'consolidations.approve',
  WAREHOUSE_RECEIVE: 'warehouse.receive',
  WAREHOUSE_ADJUST: 'warehouse.adjust',
  DISTRIBUTIONS_MANAGE: 'distributions.manage',
  DISPATCHES_POST: 'dispatches.post',
  DELIVERIES_RECEIVE: 'deliveries.receive',
  DISCREPANCIES_CLOSE: 'discrepancies.close',
  THRESHOLDS_APPROVE: 'thresholds.approve',
  LG_REPORTS_VIEW: 'lg_reports.view'
};

const PERMISSION_DEFINITIONS = [
  { code: PERMISSIONS.USERS_MANAGE, name: 'Manage users', description: 'Create, deactivate, reactivate and reset users' },
  { code: PERMISSIONS.DRUGS_VIEW, name: 'View drugs', description: 'View the drug catalogue' },
  { code: PERMISSIONS.DRUGS_MANAGE, name: 'Manage drugs', description: 'Create, update, deactivate and reactivate drugs' },
  { code: PERMISSIONS.INVENTORY_VIEW, name: 'View inventory', description: 'View stock levels and batches' },
  { code: PERMISSIONS.STOCK_RECEIVE, name: 'Receive stock', description: 'Record stock receipts' },
  { code: PERMISSIONS.STOCK_DISPENSE, name: 'Dispense stock', description: 'Record dispensing events' },
  { code: PERMISSIONS.STOCK_IMPORT, name: 'Import stock', description: 'Import opening or received stock from files' },
  { code: PERMISSIONS.ADJUSTMENTS_CREATE, name: 'Create stock adjustments', description: 'Request or apply stock adjustments' },
  { code: PERMISSIONS.ADJUSTMENTS_APPROVE, name: 'Approve stock adjustments', description: 'Approve or reject stock adjustments' },
  { code: PERMISSIONS.RETURNS_REQUEST, name: 'Request returns', description: 'Create stock return requests' },
  { code: PERMISSIONS.RETURNS_APPROVE, name: 'Approve returns', description: 'Approve or reject stock returns' },
  { code: PERMISSIONS.REQUISITIONS_CREATE, name: 'Manage requisitions', description: 'Create, edit, submit, cancel and amend requisitions' },
  { code: PERMISSIONS.REQUISITIONS_APPROVE, name: 'Approve requisitions', description: 'Approve or reject requisitions' },
  { code: PERMISSIONS.EXPIRY_VIEW, name: 'View expiry monitoring', description: 'View near-expiry and expired batches' },
  { code: PERMISSIONS.REPORTS_VIEW, name: 'View reports', description: 'View and export operational reports and dashboards' },
  { code: PERMISSIONS.AUDIT_VIEW, name: 'View audit history', description: 'View the system audit trail' },
  { code: PERMISSIONS.SETTINGS_MANAGE, name: 'Manage settings', description: 'Manage system settings and thresholds' },
  { code: PERMISSIONS.NOTIFICATIONS_VIEW, name: 'View notifications', description: 'View in-app notifications' },
  { code: PERMISSIONS.ORGANISATIONS_MANAGE, name: 'Manage organisation', description: 'Maintain healthcare centres and warehouse details for the local government' },
  { code: PERMISSIONS.MEMBERSHIPS_MANAGE, name: 'Manage memberships', description: 'Add, change and deactivate LG and facility memberships' },
  { code: PERMISSIONS.REQUISITIONS_SUBMIT, name: 'Transmit requisitions', description: 'Send internally approved requisitions to the local government' },
  { code: PERMISSIONS.REQUISITIONS_LG_REVIEW, name: 'Review LG requisitions', description: 'Review, approve, partially approve or reject requisitions sent to the local government' },
  { code: PERMISSIONS.CONSOLIDATIONS_CREATE, name: 'Create consolidations', description: 'Build consolidated demand from approved facility requisitions' },
  { code: PERMISSIONS.CONSOLIDATIONS_APPROVE, name: 'Approve consolidations', description: 'Formally approve or reject consolidated demand' },
  { code: PERMISSIONS.WAREHOUSE_RECEIVE, name: 'Receive warehouse stock', description: 'Record supplier receipts into the LG warehouse' },
  { code: PERMISSIONS.WAREHOUSE_ADJUST, name: 'Adjust warehouse stock', description: 'Request or apply corrections to LG warehouse stock' },
  { code: PERMISSIONS.DISTRIBUTIONS_MANAGE, name: 'Manage distributions', description: 'Prepare distribution orders from approved demand' },
  { code: PERMISSIONS.DISPATCHES_POST, name: 'Post dispatches', description: 'Dispatch warehouse stock against distribution orders' },
  { code: PERMISSIONS.DELIVERIES_RECEIVE, name: 'Confirm deliveries', description: 'Confirm delivery receipts and record shortages, damage or rejection' },
  { code: PERMISSIONS.DISCREPANCIES_CLOSE, name: 'Close discrepancies', description: 'Finalize shortages and resolve damaged or rejected stock' },
  { code: PERMISSIONS.THRESHOLDS_APPROVE, name: 'Approve threshold actions', description: 'Approve threshold-gated warehouse receipts, corrections and dispatches' },
  { code: PERMISSIONS.LG_REPORTS_VIEW, name: 'View LG reports', description: 'View and export local government demand, warehouse and distribution reports' }
];

const ROLE_DEFINITIONS = [
  {
    code: ROLES.ADMINISTRATOR,
    name: 'Administrator',
    description: 'Full operational and administrative access to the healthcare centre',
    permissions: Object.values(PERMISSIONS)
  },
  {
    code: ROLES.STAFF,
    name: 'Staff',
    description: 'Day-to-day inventory, dispensing and requisition access within thresholds',
    permissions: [
      PERMISSIONS.DRUGS_VIEW,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.STOCK_RECEIVE,
      PERMISSIONS.STOCK_DISPENSE,
      PERMISSIONS.ADJUSTMENTS_CREATE,
      PERMISSIONS.RETURNS_REQUEST,
      PERMISSIONS.REQUISITIONS_CREATE,
      PERMISSIONS.EXPIRY_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.NOTIFICATIONS_VIEW
    ]
  },
  {
    code: ROLES.SYSTEM_ADMIN,
    name: 'System Administrator',
    description: 'Manages the state, local government and centre hierarchy, bootstrap and support access',
    permissions: Object.values(PERMISSIONS)
  },
  {
    code: ROLES.LG_ADMIN,
    name: 'LG Administrator',
    description: 'Manages local government facilities, memberships and configuration without operational approval rights',
    permissions: [
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.MEMBERSHIPS_MANAGE,
      PERMISSIONS.ORGANISATIONS_MANAGE,
      PERMISSIONS.DRUGS_VIEW,
      PERMISSIONS.DRUGS_MANAGE,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.EXPIRY_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.LG_REPORTS_VIEW,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.NOTIFICATIONS_VIEW
    ]
  },
  {
    code: ROLES.LG_INVENTORY_OFFICER,
    name: 'Logistician',
    description: 'Reviews and approves LG requisitions and consolidations and runs warehouse and distribution operations',
    permissions: [
      PERMISSIONS.DRUGS_VIEW,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.EXPIRY_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.LG_REPORTS_VIEW,
      PERMISSIONS.REQUISITIONS_LG_REVIEW,
      PERMISSIONS.CONSOLIDATIONS_CREATE,
      PERMISSIONS.CONSOLIDATIONS_APPROVE,
      PERMISSIONS.WAREHOUSE_RECEIVE,
      PERMISSIONS.WAREHOUSE_ADJUST,
      PERMISSIONS.DISTRIBUTIONS_MANAGE,
      PERMISSIONS.DISPATCHES_POST,
      PERMISSIONS.DELIVERIES_RECEIVE,
      PERMISSIONS.DISCREPANCIES_CLOSE,
      PERMISSIONS.THRESHOLDS_APPROVE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.NOTIFICATIONS_VIEW
    ]
  }
];

const BATCH_STATUS = {
  USABLE: 'usable',
  EXPIRED: 'expired',
  QUARANTINED: 'quarantined',
  BLOCKED: 'blocked',
  RECALLED: 'recalled',
  RETURNED_PENDING_INSPECTION: 'returned_pending_inspection',
  DESTROYED: 'destroyed'
};

const USABLE_BATCH_STATUS = BATCH_STATUS.USABLE;

const MOVEMENT_TYPES = {
  RECEIPT: 'receipt',
  IMPORT: 'import',
  OPENING_STOCK: 'opening_stock',
  DISPENSING: 'dispensing',
  ADJUSTMENT: 'adjustment',
  RETURN: 'return',
  RETURN_RESTOCK: 'return_restock',
  RECONCILIATION: 'reconciliation'
};

const REQUIREMENT_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  CLOSED: 'closed'
};

const REQUISITION_STATUS = REQUIREMENT_STATUS;

const OPEN_REQUISITION_STATUSES = [
  REQUISITION_STATUS.DRAFT,
  REQUISITION_STATUS.PENDING_APPROVAL,
  REQUISITION_STATUS.APPROVED
];

const ADJUSTMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const ADJUSTMENT_TYPES = ['physical_count', 'damage', 'loss', 'correction', 'expiry_writeoff', 'other'];

const RETURN_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const RETURN_DISPOSITIONS = ['return_to_supplier', 'quarantined', 'blocked', 'destroyed', 'restock_usable'];

const SETTING_KEYS = {
  ADJUSTMENT_QUANTITY_THRESHOLD: 'staff_adjustment_quantity_threshold',
  ADJUSTMENT_VALUE_THRESHOLD: 'staff_adjustment_value_threshold',
  NEAR_EXPIRY_DAYS: 'near_expiry_days',
  LG_RECEIPT_QUANTITY_THRESHOLD: 'lg_receipt_quantity_threshold',
  LG_RECEIPT_VALUE_THRESHOLD: 'lg_receipt_value_threshold',
  LG_DISPATCH_QUANTITY_THRESHOLD: 'lg_dispatch_quantity_threshold',
  LG_CORRECTION_QUANTITY_THRESHOLD: 'lg_correction_quantity_threshold',
  LG_CORRECTION_VALUE_THRESHOLD: 'lg_correction_value_threshold',
  LG_APPROVAL_WINDOW_HOURS: 'lg_approval_window_hours'
};

const EXPIRY_WINDOWS = [90, 30, 7];

const NOTIFICATION_TYPES = {
  NEAR_EXPIRY: 'near_expiry',
  EXPIRED_STOCK: 'expired_stock',
  LOW_STOCK: 'low_stock',
  REQUISITION_PENDING: 'requisition_pending',
  REQUISITION_REVIEWED: 'requisition_reviewed',
  DISPATCH_POSTED: 'dispatch_posted',
  DELIVERY_RECEIVED: 'delivery_received',
  DISCREPANCY_OPENED: 'discrepancy_opened',
  ADJUSTMENT_PENDING: 'adjustment_pending',
  RETURN_PENDING: 'return_pending'
};

const STOCK_STATUS = {
  IN_STOCK: 'in_stock',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock'
};

const QUANTITY_EPSILON = 1e-9;

const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100
};

module.exports = {
  ROLES,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLE_DEFINITIONS,
  BATCH_STATUS,
  USABLE_BATCH_STATUS,
  MOVEMENT_TYPES,
  REQUEST_STATUS: REQUIREMENT_STATUS,
  REQUISITION_STATUS,
  OPEN_REQUISITION_STATUSES,
  ADJUSTMENT_STATUS,
  ADJUSTMENT_TYPES,
  RETURN_STATUS,
  RETURN_DISPOSITIONS,
  SETTING_KEYS,
  EXPIRY_WINDOWS,
  NOTIFICATION_TYPES,
  STOCK_STATUS,
  QUANTITY_EPSILON,
  PAGINATION
};

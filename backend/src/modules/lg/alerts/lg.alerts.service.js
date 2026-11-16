const { ForbiddenError } = require('../../../shared/errors/AppError');
const repository = require('./lg.alerts.repository');

const requireLocalGovernmentScope = (scope) => {
  if (!scope || scope.scopeType !== 'local_government' || !scope.localGovernmentId) {
    throw new ForbiddenError('This screen is only available to local government accounts', 'LOCAL_GOVERNMENT_ONLY');
  }
  return scope.localGovernmentId;
};

const ALERT_LIMITS = {
  lowStock: 8,
  expiring: 8,
  requisitions: 5,
  approvals: 5,
  orders: 5,
  consolidations: 5
};

const NEAR_EXPIRY_WINDOW_DAYS = 90;

const formatAlertAmount = (value) =>
  Number(value || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 });

const formatAlertDate = (value) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
};

const getAlerts = async ({ scope }) => {
  const localGovernmentId = requireLocalGovernmentScope(scope);

  const [counts, lowStock, expiring, requisitions, approvals, orders, consolidations] =
    await Promise.all([
      repository.alertCounts(localGovernmentId, NEAR_EXPIRY_WINDOW_DAYS),
      repository.alertLowStock(localGovernmentId, ALERT_LIMITS.lowStock),
      repository.alertNearExpiry(localGovernmentId, NEAR_EXPIRY_WINDOW_DAYS, ALERT_LIMITS.expiring),
      repository.alertPendingRequisitions(localGovernmentId, ALERT_LIMITS.requisitions),
      repository.alertPendingApprovals(localGovernmentId, ALERT_LIMITS.approvals),
      repository.alertOpenOrders(localGovernmentId, ALERT_LIMITS.orders),
      repository.alertDraftConsolidations(localGovernmentId, ALERT_LIMITS.consolidations)
    ]);

  const alerts = [];

  expiring.forEach((row) => {
    const days = Number(row.days_remaining);
    const expired = days < 0;
    alerts.push({
      id: `expiry:${row.centre_id}:${row.batch_number}:${row.drug_code}`,
      type: expired ? 'expired_stock' : 'near_expiry',
      severity: expired ? 'danger' : days <= 30 ? 'danger' : 'warning',
      title: expired
        ? `${row.drug_name} batch ${row.batch_number} has expired`
        : `${row.drug_name} batch ${row.batch_number} expires in ${days} day${days === 1 ? '' : 's'}`,
      detail: `${row.centre_name} · ${formatAlertAmount(row.quantity)} ${row.unit_of_measure || 'units'} · expiry ${formatAlertDate(row.expiry_date)}`,
      link: '/lg/warehouse'
    });
  });

  lowStock.forEach((row) => {
    const shortfall = Number(row.minimum_stock_level) - Number(row.quantity);
    alerts.push({
      id: `low:${row.centre_id}:${row.drug_id}`,
      type: 'low_stock',
      severity: 'warning',
      title: `${row.drug_name} is below minimum at ${row.centre_name}`,
      detail: `${formatAlertAmount(row.quantity)} of ${formatAlertAmount(row.minimum_stock_level)} ${row.unit_of_measure || 'units'} · short by ${formatAlertAmount(shortfall)}`,
      link: '/lg/requests'
    });
  });

  approvals.forEach((row) => {
    alerts.push({
      id: `approval:${row.id}`,
      type: 'pending_approval',
      severity: 'warning',
      title: `Approval needed for a warehouse ${row.approval_type}`,
      detail: `${row.summary || 'Threshold action'} · raised by ${row.requested_by_name} · ${formatAlertDate(row.requested_at)}`,
      link: '/lg/approvals'
    });
  });

  requisitions.forEach((row) => {
    alerts.push({
      id: `requisition:${row.id}`,
      type: 'pending_requisition',
      severity: 'info',
      title: `Requisition ${row.requisition_number} awaiting review`,
      detail: `${row.centre_name} · ${formatAlertAmount(row.total_quantity)} units requested · ${formatAlertDate(row.created_at)}`,
      link: '/lg/requests'
    });
  });

  orders.forEach((row) => {
    alerts.push({
      id: `order:${row.id}`,
      type: 'open_order',
      severity: 'info',
      title: `Order ${row.order_number} is still ${row.status}`,
      detail: `${formatAlertAmount(row.total_quantity)} units · raised ${formatAlertDate(row.created_at)}`,
      link: '/lg/orders'
    });
  });

  consolidations.forEach((row) => {
    alerts.push({
      id: `consolidation:${row.id}`,
      type: 'draft_consolidation',
      severity: 'info',
      title: `Consolidation ${row.reference} is not finalised`,
      detail: `${formatAlertAmount(row.total_quantity)} units · created ${formatAlertDate(row.created_at)}`,
      link: '/lg/consolidations'
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    nearExpiryWindowDays: NEAR_EXPIRY_WINDOW_DAYS,
    counts: {
      lowStock: counts.low_stock,
      expiring: counts.expiring,
      requisitions: counts.requisitions,
      approvals: counts.approvals,
      orders: counts.orders,
      consolidations: counts.consolidations,
      shown: alerts.length
    },
    alerts
  };
};

module.exports = {
  getAlerts
};

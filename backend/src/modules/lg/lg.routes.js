const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize, requireLocalGovernmentScope } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./lg.controller');
const schemas = require('./lg.validation');

const router = express.Router();

router.use(authenticate, requireLocalGovernmentScope);

router.get(
  '/warehouse',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouse
);

router.get(
  '/warehouse/batches',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouseBatches
);

router.get(
  '/warehouse/movements',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ query: schemas.warehouseMovementsQuerySchema }),
  controller.listWarehouseMovements
);

router.get(
  '/ledger/reconciliation',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.getLedgerReconciliation
);

router.get(
  '/warehouse/receipts',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listReceipts
);

router.post(
  '/warehouse/receipts',
  authorize(PERMISSIONS.WAREHOUSE_RECEIVE),
  validate({ body: schemas.createReceiptSchema }),
  controller.createReceipt
);

router.get(
  '/requisitions',
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listRequisitionsQuerySchema }),
  controller.listRequisitions
);

router.get(
  '/requisitions/:requisitionId',
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.getRequisition
);

router.post(
  '/requisitions/:requisitionId/approve',
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.approveRequisitionSchema }),
  controller.approveRequisition
);

router.post(
  '/requisitions/:requisitionId/reject',
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.rejectRequisitionSchema }),
  controller.rejectRequisition
);

router.post(
  '/requisitions/:requisitionId/dispatch',
  authorize(PERMISSIONS.DISPATCHES_POST),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.dispatchSchema }),
  controller.dispatchRequisition
);

router.post(
  '/discrepancies/:itemId/resolve',
  authorize(PERMISSIONS.DISCREPANCIES_CLOSE),
  validate({ params: schemas.discrepancyIdParamSchema, body: schemas.resolveDiscrepancySchema }),
  controller.resolveDiscrepancy
);

router.post(
  '/requisitions/:requisitionId/close-short',
  authorize(PERMISSIONS.DISCREPANCIES_CLOSE),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.closeShortSchema }),
  controller.closeShort
);

router.get(
  '/dispatches',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listDispatches
);

router.get(
  '/transfers',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  validate({ query: schemas.listFacilityTransfersQuerySchema }),
  controller.listTransfers
);

router.get(
  '/transfers/facilities',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  controller.listTransferFacilities
);

router.get(
  '/transfers/facilities/stock',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  validate({ query: schemas.facilityStockQuerySchema }),
  controller.getFacilityStock
);

router.post(
  '/transfers',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  validate({ body: schemas.createFacilityTransferSchema }),
  controller.createTransfer
);

router.get(
  '/transfers/:transferId',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  validate({ params: schemas.transferIdParamSchema }),
  controller.getTransfer
);

router.post(
  '/transfers/:transferId/cancel',
  authorize(PERMISSIONS.LG_TRANSFERS_MANAGE),
  validate({ params: schemas.transferIdParamSchema, body: schemas.cancelTransferSchema }),
  controller.cancelTransfer
);

router.get(
  '/orders',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ query: schemas.listOrdersQuerySchema }),
  controller.listOrders
);

router.get(
  '/orders/candidates',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  controller.listOrderCandidates
);

router.post(
  '/orders',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ body: schemas.createOrderSchema }),
  controller.createOrder
);

router.get(
  '/orders/:orderId',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ params: schemas.orderIdParamSchema }),
  controller.getOrder
);

router.post(
  '/orders/:orderId/submit',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ params: schemas.orderIdParamSchema }),
  controller.submitOrder
);

router.post(
  '/orders/:orderId/fulfill',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ params: schemas.orderIdParamSchema, body: schemas.fulfillOrderSchema }),
  controller.fulfillOrder
);

router.post(
  '/orders/:orderId/receipts',
  authorize(PERMISSIONS.WAREHOUSE_RECEIVE),
  validate({ params: schemas.orderIdParamSchema, body: schemas.orderReceiptSchema }),
  controller.receiveOrder
);

router.post(
  '/orders/:orderId/cancel',
  authorize(PERMISSIONS.LG_ORDERS_MANAGE),
  validate({ params: schemas.orderIdParamSchema, body: schemas.cancelOrderSchema }),
  controller.cancelOrder
);

router.get(
  '/consolidations',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ query: schemas.listConsolidationsQuerySchema }),
  controller.listConsolidations
);

router.get(
  '/consolidations/candidates',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  controller.getConsolidationCandidates
);

router.post(
  '/consolidations/preview',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ body: schemas.previewConsolidationSchema }),
  controller.previewConsolidation
);

router.post(
  '/consolidations',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ body: schemas.createConsolidationSchema }),
  controller.createConsolidation
);

router.get(
  '/consolidations/:consolidationId',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.getConsolidation
);

router.post(
  '/consolidations/:consolidationId/finalize',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.finalizeConsolidation
);

router.post(
  '/consolidations/:consolidationId/cancel',
  authorize(PERMISSIONS.LG_CONSOLIDATIONS_MANAGE),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.cancelConsolidation
);

router.get(
  '/approvals',
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ query: schemas.listApprovalsQuerySchema }),
  controller.listApprovals
);

router.post(
  '/approvals/:approvalId/approve',
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ params: schemas.approvalIdParamSchema, body: schemas.approveThresholdSchema }),
  controller.approveApproval
);

router.post(
  '/approvals/:approvalId/reject',
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ params: schemas.approvalIdParamSchema, body: schemas.rejectThresholdSchema }),
  controller.rejectApproval
);

router.get(
  '/reports/summary',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  controller.getReportsSummary
);

router.get(
  '/reports/demand',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.demandReport
);

router.get(
  '/reports/warehouse',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.warehouseReport
);

router.get(
  '/reports/dispatches',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.dispatchReport
);

router.get(
  '/reports/receipts',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.receiptReport
);

router.get(
  '/reports/damage',
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.damageReport
);

router.get(
  '/dispatches/:dispatchId',
  authorize(PERMISSIONS.LG_WAREHOUSE_VIEW),
  validate({ params: schemas.dispatchIdParamSchema }),
  controller.getDispatch
);

module.exports = router;

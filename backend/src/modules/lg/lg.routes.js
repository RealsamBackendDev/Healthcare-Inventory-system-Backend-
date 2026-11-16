const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./lg.controller');
const schemas = require('./lg.validation');

const router = express.Router();

router.get(
  '/warehouse',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouse
);

router.get(
  '/warehouse/batches',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.warehouseQuerySchema }),
  controller.getWarehouseBatches
);

router.get(
  '/warehouse/receipts',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listReceipts
);

router.post(
  '/warehouse/receipts',
  authenticate,
  authorize(PERMISSIONS.WAREHOUSE_RECEIVE),
  validate({ body: schemas.createReceiptSchema }),
  controller.createReceipt
);

router.get(
  '/requisitions',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listRequisitionsQuerySchema }),
  controller.listRequisitions
);

router.get(
  '/requisitions/:requisitionId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema }),
  controller.getRequisition
);

router.post(
  '/requisitions/:requisitionId/approve',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.approveRequisitionSchema }),
  controller.approveRequisition
);

router.post(
  '/requisitions/:requisitionId/reject',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.rejectRequisitionSchema }),
  controller.rejectRequisition
);

router.post(
  '/requisitions/:requisitionId/dispatch',
  authenticate,
  authorize(PERMISSIONS.DISPATCHES_POST),
  validate({ params: schemas.requisitionIdParamSchema, body: schemas.dispatchSchema }),
  controller.dispatchRequisition
);

router.get(
  '/dispatches',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listLimitQuerySchema }),
  controller.listDispatches
);

router.get(
  '/transfers',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listFacilityTransfersQuerySchema }),
  controller.listTransfers
);

router.get(
  '/transfers/facilities',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  controller.listTransferFacilities
);

router.get(
  '/transfers/facilities/stock',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.facilityStockQuerySchema }),
  controller.getFacilityStock
);

router.post(
  '/transfers',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ body: schemas.createFacilityTransferSchema }),
  controller.createTransfer
);

router.get(
  '/transfers/:transferId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.transferIdParamSchema }),
  controller.getTransfer
);

router.post(
  '/transfers/:transferId/cancel',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.transferIdParamSchema, body: schemas.cancelTransferSchema }),
  controller.cancelTransfer
);

router.get(
  '/orders',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listOrdersQuerySchema }),
  controller.listOrders
);

router.get(
  '/orders/candidates',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  controller.listOrderCandidates
);

router.post(
  '/orders',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ body: schemas.createOrderSchema }),
  controller.createOrder
);

router.get(
  '/orders/:orderId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.orderIdParamSchema }),
  controller.getOrder
);

router.post(
  '/orders/:orderId/submit',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.orderIdParamSchema }),
  controller.submitOrder
);

router.post(
  '/orders/:orderId/fulfill',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.orderIdParamSchema, body: schemas.fulfillOrderSchema }),
  controller.fulfillOrder
);

router.post(
  '/orders/:orderId/cancel',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.orderIdParamSchema, body: schemas.cancelOrderSchema }),
  controller.cancelOrder
);

router.get(
  '/consolidations',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ query: schemas.listConsolidationsQuerySchema }),
  controller.listConsolidations
);

router.get(
  '/consolidations/candidates',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  controller.getConsolidationCandidates
);

router.post(
  '/consolidations/preview',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ body: schemas.previewConsolidationSchema }),
  controller.previewConsolidation
);

router.post(
  '/consolidations',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ body: schemas.createConsolidationSchema }),
  controller.createConsolidation
);

router.get(
  '/consolidations/:consolidationId',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.getConsolidation
);

router.post(
  '/consolidations/:consolidationId/finalize',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.finalizeConsolidation
);

router.post(
  '/consolidations/:consolidationId/cancel',
  authenticate,
  authorize(PERMISSIONS.REQUISITIONS_LG_REVIEW),
  validate({ params: schemas.consolidationIdParamSchema }),
  controller.cancelConsolidation
);

router.get(
  '/approvals',
  authenticate,
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ query: schemas.listApprovalsQuerySchema }),
  controller.listApprovals
);

router.post(
  '/approvals/:approvalId/approve',
  authenticate,
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ params: schemas.approvalIdParamSchema, body: schemas.approveThresholdSchema }),
  controller.approveApproval
);

router.post(
  '/approvals/:approvalId/reject',
  authenticate,
  authorize(PERMISSIONS.THRESHOLDS_APPROVE),
  validate({ params: schemas.approvalIdParamSchema, body: schemas.rejectThresholdSchema }),
  controller.rejectApproval
);

router.get(
  '/reports/summary',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  controller.getReportsSummary
);

router.get(
  '/reports/demand',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.demandReport
);

router.get(
  '/reports/warehouse',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.warehouseReport
);

router.get(
  '/reports/dispatches',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.dispatchReport
);

router.get(
  '/reports/receipts',
  authenticate,
  authorize(PERMISSIONS.LG_REPORTS_VIEW),
  validate({ query: schemas.reportQuerySchema }),
  controller.receiptReport
);

router.get(
  '/dispatches/:dispatchId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.dispatchIdParamSchema }),
  controller.getDispatch
);

module.exports = router;

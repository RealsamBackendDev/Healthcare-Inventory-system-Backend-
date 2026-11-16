const fs = require('fs');
const path = require('path');

const routes = [
  ['get', '/warehouse', 'INVENTORY_VIEW', ['query: schemas.warehouseQuerySchema'], 'getWarehouse'],
  ['get', '/warehouse/batches', 'INVENTORY_VIEW', ['query: schemas.warehouseQuerySchema'], 'getWarehouseBatches'],
  ['get', '/warehouse/receipts', 'INVENTORY_VIEW', ['query: schemas.listLimitQuerySchema'], 'listReceipts'],
  ['post', '/warehouse/receipts', 'WAREHOUSE_RECEIVE', ['body: schemas.createReceiptSchema'], 'createReceipt'],
  ['get', '/requisitions', 'REQUISITIONS_LG_REVIEW', ['query: schemas.listRequisitionsQuerySchema'], 'listRequisitions'],
  ['get', '/requisitions/:requisitionId', 'REQUISITIONS_LG_REVIEW', ['params: schemas.requisitionIdParamSchema'], 'getRequisition'],
  ['post', '/requisitions/:requisitionId/approve', 'REQUISITIONS_LG_REVIEW', ['params: schemas.requisitionIdParamSchema', 'body: schemas.approveRequisitionSchema'], 'approveRequisition'],
  ['post', '/requisitions/:requisitionId/reject', 'REQUISITIONS_LG_REVIEW', ['params: schemas.requisitionIdParamSchema', 'body: schemas.rejectRequisitionSchema'], 'rejectRequisition'],
  ['post', '/requisitions/:requisitionId/dispatch', 'DISPATCHES_POST', ['params: schemas.requisitionIdParamSchema', 'body: schemas.dispatchSchema'], 'dispatchRequisition'],
  ['get', '/dispatches', 'INVENTORY_VIEW', ['query: schemas.listLimitQuerySchema'], 'listDispatches'],
  ['get', '/transfers', 'REQUISITIONS_LG_REVIEW', ['query: schemas.listFacilityTransfersQuerySchema'], 'listTransfers'],
  ['get', '/transfers/facilities', 'REQUISITIONS_LG_REVIEW', [], 'listTransferFacilities'],
  ['get', '/transfers/facilities/stock', 'REQUISITIONS_LG_REVIEW', ['query: schemas.facilityStockQuerySchema'], 'getFacilityStock'],
  ['post', '/transfers', 'REQUISITIONS_LG_REVIEW', ['body: schemas.createFacilityTransferSchema'], 'createTransfer'],
  ['get', '/transfers/:transferId', 'REQUISITIONS_LG_REVIEW', ['params: schemas.transferIdParamSchema'], 'getTransfer'],
  ['post', '/transfers/:transferId/cancel', 'REQUISITIONS_LG_REVIEW', ['params: schemas.transferIdParamSchema', 'body: schemas.cancelTransferSchema'], 'cancelTransfer'],
  ['get', '/orders', 'REQUISITIONS_LG_REVIEW', ['query: schemas.listOrdersQuerySchema'], 'listOrders'],
  ['get', '/orders/candidates', 'REQUISITIONS_LG_REVIEW', [], 'listOrderCandidates'],
  ['post', '/orders', 'REQUISITIONS_LG_REVIEW', ['body: schemas.createOrderSchema'], 'createOrder'],
  ['get', '/orders/:orderId', 'REQUISITIONS_LG_REVIEW', ['params: schemas.orderIdParamSchema'], 'getOrder'],
  ['post', '/orders/:orderId/submit', 'REQUISITIONS_LG_REVIEW', ['params: schemas.orderIdParamSchema'], 'submitOrder'],
  ['post', '/orders/:orderId/fulfill', 'REQUISITIONS_LG_REVIEW', ['params: schemas.orderIdParamSchema', 'body: schemas.fulfillOrderSchema'], 'fulfillOrder'],
  ['post', '/orders/:orderId/cancel', 'REQUISITIONS_LG_REVIEW', ['params: schemas.orderIdParamSchema', 'body: schemas.cancelOrderSchema'], 'cancelOrder'],
  ['get', '/consolidations', 'REQUISITIONS_LG_REVIEW', ['query: schemas.listConsolidationsQuerySchema'], 'listConsolidations'],
  ['get', '/consolidations/candidates', 'REQUISITIONS_LG_REVIEW', [], 'getConsolidationCandidates'],
  ['post', '/consolidations/preview', 'REQUISITIONS_LG_REVIEW', ['body: schemas.previewConsolidationSchema'], 'previewConsolidation'],
  ['post', '/consolidations', 'REQUISITIONS_LG_REVIEW', ['body: schemas.createConsolidationSchema'], 'createConsolidation'],
  ['get', '/consolidations/:consolidationId', 'REQUISITIONS_LG_REVIEW', ['params: schemas.consolidationIdParamSchema'], 'getConsolidation'],
  ['post', '/consolidations/:consolidationId/finalize', 'REQUISITIONS_LG_REVIEW', ['params: schemas.consolidationIdParamSchema'], 'finalizeConsolidation'],
  ['post', '/consolidations/:consolidationId/cancel', 'REQUISITIONS_LG_REVIEW', ['params: schemas.consolidationIdParamSchema'], 'cancelConsolidation'],
  ['get', '/approvals', 'THRESHOLDS_APPROVE', ['query: schemas.listApprovalsQuerySchema'], 'listApprovals'],
  ['post', '/approvals/:approvalId/approve', 'THRESHOLDS_APPROVE', ['params: schemas.approvalIdParamSchema', 'body: schemas.approveThresholdSchema'], 'approveApproval'],
  ['post', '/approvals/:approvalId/reject', 'THRESHOLDS_APPROVE', ['params: schemas.approvalIdParamSchema', 'body: schemas.rejectThresholdSchema'], 'rejectApproval'],
  ['get', '/reports/summary', 'LG_REPORTS_VIEW', [], 'getReportsSummary'],
  ['get', '/reports/demand', 'LG_REPORTS_VIEW', ['query: schemas.reportQuerySchema'], 'demandReport'],
  ['get', '/reports/warehouse', 'LG_REPORTS_VIEW', ['query: schemas.reportQuerySchema'], 'warehouseReport'],
  ['get', '/reports/dispatches', 'LG_REPORTS_VIEW', ['query: schemas.reportQuerySchema'], 'dispatchReport'],
  ['get', '/reports/receipts', 'LG_REPORTS_VIEW', ['query: schemas.reportQuerySchema'], 'receiptReport'],
  ['get', '/dispatches/:dispatchId', 'INVENTORY_VIEW', ['params: schemas.dispatchIdParamSchema'], 'getDispatch']
];

const header = `const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./lg.controller');
const schemas = require('./lg.validation');

const router = express.Router();
`;

const blocks = routes.map(([method, routePath, permission, validators, handler]) => {
  const lines = [
    `router.${method}(`,
    `  '${routePath}',`,
    '  authenticate,',
    `  authorize(PERMISSIONS.${permission}),`
  ];
  if (validators.length > 0) {
    lines.push(`  validate({ ${validators.join(', ')} }),`);
  }
  lines.push(`  controller.${handler}`, ');');
  return lines.join('\n');
});

const output = `${header}\n${blocks.join('\n\n')}\n\nmodule.exports = router;\n`;
const target = process.argv[2] || path.join(__dirname, 'lg.routes.js');
fs.writeFileSync(target, output);
console.log(`wrote ${target}`);
console.log(`route blocks: ${routes.length}`);

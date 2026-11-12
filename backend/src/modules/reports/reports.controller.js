const asyncHandler = require('../../shared/utils/asyncHandler');
const { sendReport } = require('../../shared/utils/exporter');
const service = require('./reports.service');

const getDashboard = asyncHandler(async (req, res) => {
  const result = await service.getDashboard(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getOptions = asyncHandler(async (req, res) => {
  const result = await service.getReportOptions(req.scope.healthcareCentreId);
  res.json({ success: true, data: result });
});

const send = (builder) =>
  asyncHandler(async (req, res) => {
    const report = await builder(req.scope.healthcareCentreId, req.query);
    await sendReport(res, {
      format: req.query.format || 'json',
      ...report
    });
  });

module.exports = {
  getDashboard,
  getOptions,
  inventory: send(service.buildInventoryReport),
  stockMovements: send(service.buildMovementReport),
  dispensing: send(service.buildDispensingReport),
  expiry: send(service.buildExpiryReport),
  requisitions: send(service.buildRequisitionReport),
  adjustments: send(service.buildAdjustmentReport),
  returns: send(service.buildReturnReport),
  audit: send(service.buildAuditReport)
};

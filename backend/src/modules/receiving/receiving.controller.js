const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./receiving.service');
const importService = require('./receiving.import');

const createReceipt = asyncHandler(async (req, res) => {
  const result = await service.createReceipt({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const listReceipts = asyncHandler(async (req, res) => {
  const result = await service.listReceipts(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getReceipt = asyncHandler(async (req, res) => {
  const result = await service.getReceipt(req.scope.healthcareCentreId, req.params.receiptId);
  res.json({ success: true, data: result });
});

const previewImport = asyncHandler(async (req, res) => {
  const result = await importService.previewImport(req.scope.healthcareCentreId, req.file);
  res.json({ success: true, data: result });
});

const commitImport = asyncHandler(async (req, res) => {
  const result = await importService.commitImport({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    mode: req.body.mode,
    rows: req.body.rows,
    supplier: req.body.supplier,
    note: req.body.note
  });
  res.status(201).json({ success: true, data: result });
});

module.exports = {
  createReceipt,
  listReceipts,
  getReceipt,
  previewImport,
  commitImport
};

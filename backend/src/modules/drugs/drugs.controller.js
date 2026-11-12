const asyncHandler = require('../../shared/utils/asyncHandler');
const service = require('./drugs.service');

const listDrugs = asyncHandler(async (req, res) => {
  const result = await service.listDrugs(req.scope.healthcareCentreId, req.query);
  res.json({ success: true, data: result });
});

const getDrug = asyncHandler(async (req, res) => {
  const result = await service.getDrug(req.scope.healthcareCentreId, req.params.drugId);
  res.json({ success: true, data: result });
});

const createDrug = asyncHandler(async (req, res) => {
  const result = await service.createDrug({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    payload: req.body
  });
  res.status(201).json({ success: true, data: result });
});

const updateDrug = asyncHandler(async (req, res) => {
  const result = await service.updateDrug({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    drugId: req.params.drugId,
    payload: req.body
  });
  res.json({ success: true, data: result });
});

const setDrugActiveState = asyncHandler(async (req, res) => {
  const result = await service.setDrugActiveState({
    actor: req.user,
    healthcareCentreId: req.scope.healthcareCentreId,
    drugId: req.params.drugId,
    isActive: req.body.isActive
  });
  res.json({ success: true, data: result });
});

module.exports = {
  listDrugs,
  getDrug,
  createDrug,
  updateDrug,
  setDrugActiveState
};

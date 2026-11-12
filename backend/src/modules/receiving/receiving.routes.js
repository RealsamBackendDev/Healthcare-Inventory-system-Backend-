const express = require('express');
const multer = require('multer');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const { PERMISSIONS } = require('../../shared/constants');
const controller = require('./receiving.controller');
const schemas = require('./receiving.validation');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.post(
  '/receiving/receipts',
  authenticate,
  authorize(PERMISSIONS.STOCK_RECEIVE),
  validate({ body: schemas.createReceiptSchema }),
  controller.createReceipt
);

router.get(
  '/receiving/receipts',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: schemas.listReceiptsQuerySchema }),
  controller.listReceipts
);

router.get(
  '/receiving/receipts/:receiptId',
  authenticate,
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: schemas.receiptIdParamSchema }),
  controller.getReceipt
);

router.post(
  '/receiving/import/preview',
  authenticate,
  authorize(PERMISSIONS.STOCK_IMPORT),
  upload.single('file'),
  controller.previewImport
);

router.post(
  '/receiving/import/commit',
  authenticate,
  authorize(PERMISSIONS.STOCK_IMPORT),
  validate({ body: schemas.commitImportSchema }),
  controller.commitImport
);

module.exports = router;

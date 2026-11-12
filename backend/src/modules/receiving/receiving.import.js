const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const { ValidationError } = require('../../shared/errors/AppError');
const { parseDateInput } = require('../../shared/utils/date');
const { MOVEMENT_TYPES } = require('../../shared/constants');
const repository = require('./receiving.repository');
const service = require('./receiving.service');

const HEADER_ALIASES = {
  drugcode: 'drugCode',
  code: 'drugCode',
  drugid: 'drugCode',
  drugname: 'drugName',
  name: 'drugName',
  batchnumber: 'batchNumber',
  batch: 'batchNumber',
  expirydate: 'expiryDate',
  expiry: 'expiryDate',
  quantity: 'quantity',
  qty: 'quantity',
  unitcost: 'unitCost',
  cost: 'unitCost',
  receiveddate: 'receivedDate',
  daterreceived: 'receivedDate',
  supplierreference: 'supplierReference',
  supplier: 'supplierReference',
  reference: 'supplierReference'
};

const normaliseHeader = (header) => String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const mapHeader = (header) => HEADER_ALIASES[normaliseHeader(header)] || null;

const cellToValue = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return value;
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if (value.result !== undefined) {
      return value.result;
    }
    if (value.text !== undefined) {
      return value.text;
    }
    return '';
  }
  return value;
};

const parseCsv = (buffer) => {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  });

  return records
    .map((record, index) => {
      const mapped = { _rowNumber: index + 2 };
      Object.entries(record).forEach(([key, value]) => {
        const target = mapHeader(key);
        if (target && mapped[target] === undefined) {
          mapped[target] = value;
        }
      });
      return mapped;
    })
    .filter((row) =>
      Object.keys(row).some((key) => key !== '_rowNumber' && String(row[key] ?? '').trim() !== '')
    );
};

const parseExcel = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }

  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = mapHeader(cellToValue(cell.value));
  });

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const mapped = { _rowNumber: rowNumber };
    headers.forEach((target, column) => {
      if (target) {
        mapped[target] = cellToValue(row.getCell(column).value);
      }
    });
    if (Object.keys(mapped).some((key) => key !== '_rowNumber' && String(mapped[key] ?? '').trim() !== '')) {
      rows.push(mapped);
    }
  });
  return rows;
};

const parseFile = async (file) => {
  if (!file || !file.buffer) {
    throw new ValidationError('Upload a CSV or Excel file', [
      { field: 'file', message: 'A file named file is required' }
    ]);
  }

  const filename = String(file.originalname || '').toLowerCase();
  const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls');

  const rows = isExcel ? await parseExcel(file.buffer) : parseCsv(file.buffer);
  if (rows.length === 0) {
    throw new ValidationError('The uploaded file contains no data rows', [
      { field: 'file', message: 'No rows were detected' }
    ]);
  }
  if (rows.length > 1000) {
    throw new ValidationError('The uploaded file has too many rows', [
      { field: 'file', message: 'Import at most 1000 rows per file' }
    ]);
  }
  return rows;
};

const resolveDrug = (raw, drugsByCode, drugsByName) => {
  const code = String(raw.drugCode ?? '').trim();
  const name = String(raw.drugName ?? '').trim();

  if (code) {
    const drug = drugsByCode.get(code.toLowerCase());
    if (!drug) {
      return { drug: null, error: `Drug code ${code} was not found in the catalogue` };
    }
    return { drug, error: null };
  }

  if (name) {
    const matches = drugsByName.get(name.toLowerCase()) || [];
    if (matches.length === 0) {
      return { drug: null, error: `Drug ${name} was not found in the catalogue` };
    }
    if (matches.length > 1) {
      return { drug: null, error: `Drug name ${name} matches more than one drug, use the code` };
    }
    return { drug: matches[0], error: null };
  }

  return { drug: null, error: 'Provide a drug code or drug name' };
};

const validateRows = async (healthcareCentreId, rawRows) => {
  const catalogue = await repository.listActiveDrugCatalogue(healthcareCentreId);
  const drugsByCode = new Map(catalogue.map((drug) => [drug.code.toLowerCase(), drug]));
  const drugsByName = new Map();
  catalogue.forEach((drug) => {
    const key = drug.name.toLowerCase();
    const existing = drugsByName.get(key) || [];
    existing.push(drug);
    drugsByName.set(key, existing);
  });

  const seenBatches = new Set();

  return rawRows.map((raw, index) => {
    const errors = [];
    const rowNumber = Number(raw._rowNumber || raw.rowNumber || index + 2);
    const batchNumber = String(raw.batchNumber ?? '').trim();
    const quantity = Number(raw.quantity);
    const unitCostRaw = raw.unitCost;
    const hasUnitCost = unitCostRaw !== '' && unitCostRaw !== null && unitCostRaw !== undefined;
    const unitCost = hasUnitCost ? Number(unitCostRaw) : null;
    const expiryDate = parseDateInput(raw.expiryDate);
    const receivedDate = parseDateInput(raw.receivedDate);
    const supplierReference = String(raw.supplierReference ?? '').trim();

    if (!batchNumber) {
      errors.push('Batch number is required');
    } else if (batchNumber.length > 80) {
      errors.push('Batch number is too long');
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push('Quantity must be a number greater than zero');
    }

    if (hasUnitCost && (!Number.isFinite(unitCost) || unitCost < 0)) {
      errors.push('Unit cost must be zero or more');
    }

    if (raw.expiryDate && !expiryDate) {
      errors.push('Expiry date is not a valid date');
    }

    if (raw.receivedDate && !receivedDate) {
      errors.push('Received date is not a valid date');
    }

    const { drug, error: drugError } = resolveDrug(raw, drugsByCode, drugsByName);
    if (drugError) {
      errors.push(drugError);
    }

    if (drug && batchNumber) {
      const key = `${drug.id}::${batchNumber.toLowerCase()}`;
      if (seenBatches.has(key)) {
        errors.push('The same drug and batch number appears more than once in this file');
      }
      seenBatches.add(key);
    }

    return {
      rowNumber,
      drugId: drug ? drug.id : null,
      drugCode: drug ? drug.code : String(raw.drugCode ?? '').trim(),
      drugName: drug ? drug.name : String(raw.drugName ?? '').trim(),
      unitOfMeasure: drug ? drug.unit_of_measure : null,
      batchNumber,
      expiryDate,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unitCost: Number.isFinite(unitCost) && hasUnitCost ? unitCost : null,
      receivedDate,
      supplierReference: supplierReference || null,
      errors,
      valid: errors.length === 0
    };
  });
};

const previewImport = async (healthcareCentreId, file) => {
  const rows = await parseFile(file);
  const validated = await validateRows(healthcareCentreId, rows);
  const validCount = validated.filter((row) => row.valid).length;
  return {
    rows: validated,
    summary: {
      totalRows: validated.length,
      validRows: validCount,
      invalidRows: validated.length - validCount
    }
  };
};

const commitImport = async ({ actor, healthcareCentreId, mode, rows, supplier, note }) => {
  const validated = await validateRows(healthcareCentreId, rows);
  const invalidRows = validated.filter((row) => !row.valid);
  const validRows = validated.filter((row) => row.valid);

  if (mode !== 'valid_only' && invalidRows.length > 0) {
    throw new ValidationError('The import contains invalid rows and nothing was imported', {
      invalidRows: invalidRows.map((row) => ({ rowNumber: row.rowNumber, errors: row.errors }))
    });
  }

  if (validRows.length === 0) {
    throw new ValidationError('There are no valid rows to import', {
      invalidRows: invalidRows.map((row) => ({ rowNumber: row.rowNumber, errors: row.errors }))
    });
  }

  const result = await service.createReceipt({
    actor,
    healthcareCentreId,
    payload: {
      items: validRows.map((row) => ({
        drugId: row.drugId,
        batchNumber: row.batchNumber,
        quantity: row.quantity,
        expiryDate: row.expiryDate,
        unitCost: row.unitCost,
        receivedDate: row.receivedDate,
        supplierReference: row.supplierReference
      }))
    },
    source: 'import',
    movementType: MOVEMENT_TYPES.IMPORT,
    supplier,
    note: note || 'Stock import'
  });

  const resultRows = validated.map((row) => ({
    rowNumber: row.rowNumber,
    drugCode: row.drugCode,
    drugName: row.drugName,
    batchNumber: row.batchNumber,
    quantity: row.quantity,
    status: row.valid ? 'imported' : 'skipped',
    errors: row.errors
  }));

  return {
    receipt: result.receipt,
    summary: {
      totalRows: validated.length,
      importedRows: validRows.length,
      failedRows: invalidRows.length,
      skippedRows: invalidRows.length
    },
    rows: resultRows
  };
};

module.exports = {
  parseFile,
  validateRows,
  previewImport,
  commitImport
};

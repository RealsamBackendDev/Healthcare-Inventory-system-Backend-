const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const normaliseValue = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
};

const csvCell = (value) => {
  const text = String(normaliseValue(value));
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const safeFilename = (filename) => String(filename || 'report').replace(/[^a-zA-Z0-9-_]/g, '-');

const sendCsv = (res, { columns, rows, filename }) => {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
};

const sendExcel = async (res, { title, columns, rows, filename }) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(String(title || 'Report').slice(0, 31));
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 20
  }));
  rows.forEach((row) => {
    const values = {};
    columns.forEach((column) => {
      values[column.key] = normaliseValue(row[column.key]);
    });
    worksheet.addRow(values);
  });
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
};

const sendPdf = (res, { title, subtitle, columns, rows, filename }) => {
  const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.pdf"`);
  document.pipe(res);

  document.fontSize(15).font('Helvetica-Bold').fillColor('#111827').text(String(title || 'Report'));
  document.moveDown(0.2);
  document.fontSize(9).font('Helvetica').fillColor('#4b5563');
  document.text(subtitle || `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  document.moveDown(0.7);

  const left = 30;
  const usableWidth = document.page.width - 60;
  const columnWidth = usableWidth / Math.max(columns.length, 1);
  let cursorY = document.y;

  const drawHeader = () => {
    document.fontSize(8).font('Helvetica-Bold').fillColor('#111827');
    columns.forEach((column, index) => {
      document.text(String(column.header), left + index * columnWidth, cursorY, {
        width: columnWidth - 5,
        ellipsis: true
      });
    });
    cursorY += 14;
    document
      .moveTo(left, cursorY - 3)
      .lineTo(left + usableWidth, cursorY - 3)
      .strokeColor('#d1d5db')
      .stroke();
    document.font('Helvetica').fillColor('#374151');
  };

  drawHeader();

  rows.forEach((row) => {
    if (cursorY > document.page.height - 45) {
      document.addPage();
      cursorY = 35;
      drawHeader();
    }
    columns.forEach((column, index) => {
      document.fontSize(8).text(String(normaliseValue(row[column.key])), left + index * columnWidth, cursorY, {
        width: columnWidth - 5,
        ellipsis: true
      });
    });
    cursorY += 14;
  });

  document.moveDown(1);
  document.fontSize(8).fillColor('#6b7280').text(`Rows: ${rows.length}`, left, cursorY + 6);
  document.end();
};

const sendReport = async (res, { format = 'json', title, subtitle, columns, rows, filename }) => {
  if (format === 'csv') {
    return sendCsv(res, { columns, rows, filename });
  }
  if (format === 'xlsx' || format === 'excel') {
    return sendExcel(res, { title, columns, rows, filename });
  }
  if (format === 'pdf') {
    return sendPdf(res, { title, subtitle, columns, rows, filename });
  }
  return res.json({
    success: true,
    data: {
      title,
      columns,
      rows,
      totalRows: rows.length
    }
  });
};

module.exports = {
  sendReport
};

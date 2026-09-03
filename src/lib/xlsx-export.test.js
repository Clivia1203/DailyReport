const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const buildXlsxBuffer = require('./xlsx-export.js');

test('生成含表头与数据行的 xlsx，可回读校验', async () => {
  const buf = await buildXlsxBuffer([
    { date: '2026-09-01', week: '星期二', time: '09:12', text: '完成A功能' },
    { date: '2026-09-01', week: '星期二', time: '15:40', text: '修复B问题' },
  ]);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('日报');
  assert.ok(ws, '工作表名为"日报"');
  assert.equal(ws.rowCount, 3, '表头 + 2 行数据');

  assert.equal(ws.getRow(1).getCell(1).value, '日期');
  assert.equal(ws.getRow(1).getCell(4).value, '工作内容');
  assert.equal(ws.getRow(2).getCell(1).value, '2026-09-01');
  assert.equal(ws.getRow(2).getCell(2).value, '星期二');
  assert.equal(ws.getRow(2).getCell(3).value, '09:12');
  assert.equal(ws.getRow(2).getCell(4).value, '完成A功能');
  assert.equal(ws.getRow(3).getCell(3).value, '15:40');
});

test('空数据仅含表头', async () => {
  const buf = await buildXlsxBuffer([]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('日报');
  assert.equal(ws.rowCount, 1);
});

/* Excel 导出：记录行 → xlsx 缓冲区。
   纯函数模块（rows 进、Buffer 出），与主进程解耦以便测试。 */
const ExcelJS = require('exceljs');

module.exports = async function buildXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('日报');
  ws.columns = [
    { header: '日期', key: 'date', width: 14 },
    { header: '星期', key: 'week', width: 10 },
    { header: '时间', key: 'time', width: 10 },
    { header: '工作内容', key: 'text', width: 62 },
  ];
  for (const r of rows) ws.addRow(r);

  // 表头样式 + 冻结首行，便于在 Excel 里筛选浏览
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2FA' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
};

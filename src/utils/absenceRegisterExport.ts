import ExcelJS from 'exceljs';
import type { ClassAbsenceRegister } from '@/utils/absenceRegister';
import { downloadBlob } from '@/utils/download';
import { isNativeApp } from '@/utils/platform';
import { sanitizeSheetName } from '@/utils/studentListsExport';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FONT_FAMILY = 'Arial';

const FILL_NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const FILL_NAVY_HOLIDAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
const FILL_SUBHEADER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B4C7E' } };
const FILL_META: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const FILL_NON_SCHOOL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
const FILL_ABSENT: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
const FILL_TOTAL_COL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
const FILL_GRAND_TOTAL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

const THIN_BORDER: ExcelJS.Border = { style: 'thin', color: { argb: 'FF64748B' } };
const HEADER_BORDER: ExcelJS.Border = { style: 'thin', color: { argb: 'FF94A3B8' } };
const MEDIUM_BORDER: ExcelJS.Border = { style: 'medium', color: { argb: 'FF1E293B' } };

export interface AbsenceRegisterExportLabels {
  bannerTitle: string;
  institutionLabel: string;
  monthLabel: string;
  classLabel: string;
  schoolYearLabel: string;
  legendText: string;
  colIndex: string;
  colFullName: string;
  colDaysHeader: string;
  colMonthlyTotal: string;
  shortMorning: string;
  shortEvening: string;
  colTotal: string;
  footerTotal: string;
  filePrefix: string;
}

export interface AbsenceRegisterExportMeta {
  institutionName: string;
  monthDisplay: string;
  schoolYear: string;
  lang: string;
  dir: 'rtl' | 'ltr';
}

function sanitizeFileSegment(text: string): string {
  return text
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

function safeSpreadsheetText(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function makeFont(size: number, options: { bold?: boolean; color?: string } = {}): Partial<ExcelJS.Font> {
  return {
    name: FONT_FAMILY,
    size,
    bold: options.bold ?? false,
    color: { argb: options.color ?? 'FF0F172A' },
  };
}

function setMerged(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  value: string | number,
  style: {
    font: Partial<ExcelJS.Font>;
    alignment: Partial<ExcelJS.Alignment>;
    fill?: ExcelJS.Fill;
    border?: Partial<ExcelJS.Borders>;
  },
): void {
  if (r2 > r1 || c2 > c1) {
    ws.mergeCells(r1, c1, r2, c2);
  }
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = style.font;
      cell.alignment = style.alignment;
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
    }
  }
  ws.getCell(r1, c1).value = value;
}

function appendRegisterWorksheet(
  workbook: ExcelJS.Workbook,
  register: ClassAbsenceRegister,
  meta: AbsenceRegisterExportMeta,
  labels: AbsenceRegisterExportLabels,
  sheetName: string,
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName);
  const isRtl = meta.dir === 'rtl';
  const dayCount = register.days.length;
  const firstDayCol = 3;
  const lastDayCol = 2 + dayCount * 2;
  const sumMorningCol = lastDayCol + 1;
  const sumEveningCol = lastDayCol + 2;
  const sumAllCol = lastDayCol + 3;
  const totalCols = sumAllCol;

  ws.views = [
    {
      rightToLeft: isRtl,
      showGridLines: true,
      state: 'frozen',
      xSplit: 2,
      ySplit: 6,
    },
  ];

  ws.columns = [
    { width: 5.5 },
    { width: 20 },
    ...Array.from({ length: dayCount * 2 }, () => ({ width: 3.6 })),
    { width: 7.5 },
    { width: 7.5 },
    { width: 8.5 },
  ];

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    verticalCentered: false,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.3,
      bottom: 0.3,
      header: 0.15,
      footer: 0.15,
    },
  };

  const alignCenter: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const alignStart: Partial<ExcelJS.Alignment> = { horizontal: isRtl ? 'right' : 'left', vertical: 'middle', wrapText: true };

  // Row 1: Dark Navy Title Banner (matching attached screenshot)
  setMerged(ws, 1, 1, 1, totalCols, `${labels.bannerTitle} — ${safeSpreadsheetText(register.className)}`, {
    font: makeFont(13, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignStart,
    fill: FILL_NAVY,
  });
  ws.getRow(1).height = 28;

  // Row 2: Metadata Bar (Institution, Month, Class, School Year)
  const instEnd = Math.min(totalCols, 6);
  const monthStart = instEnd + 1;
  const monthEnd = Math.min(totalCols, monthStart + 9);
  const classStart = monthEnd + 1;
  const classEnd = Math.min(totalCols, classStart + 9);
  const yearStart = classEnd + 1;

  setMerged(ws, 2, 1, 2, instEnd, `${labels.institutionLabel}: ${safeSpreadsheetText(meta.institutionName)}`, {
    font: makeFont(10, { bold: true }),
    alignment: alignStart,
    fill: FILL_META,
    border: { bottom: { style: 'dotted', color: { argb: 'FF64748B' } } },
  });
  if (monthStart <= totalCols) {
    setMerged(ws, 2, monthStart, 2, monthEnd, `${labels.monthLabel}: ${safeSpreadsheetText(meta.monthDisplay)}`, {
      font: makeFont(10, { bold: true }),
      alignment: alignStart,
      fill: FILL_META,
      border: { bottom: { style: 'dotted', color: { argb: 'FF64748B' } } },
    });
  }
  if (classStart <= totalCols) {
    setMerged(ws, 2, classStart, 2, classEnd, `${labels.classLabel}: ${safeSpreadsheetText(register.className)}`, {
      font: makeFont(10, { bold: true }),
      alignment: alignStart,
      fill: FILL_META,
      border: { bottom: { style: 'dotted', color: { argb: 'FF64748B' } } },
    });
  }
  if (yearStart <= totalCols) {
    setMerged(ws, 2, yearStart, 2, totalCols, `${labels.schoolYearLabel}: ${safeSpreadsheetText(meta.schoolYear)}`, {
      font: makeFont(10, { bold: true }),
      alignment: alignStart,
      fill: FILL_META,
      border: { bottom: { style: 'dotted', color: { argb: 'FF64748B' } } },
    });
  }
  ws.getRow(2).height = 22;

  // Row 3: Legend row ("الفترات: ( ص ) صباحي | ( م ) مسائي")
  setMerged(ws, 3, 1, 3, totalCols, labels.legendText, {
    font: makeFont(9.5, { bold: true, color: 'FF1E293B' }),
    alignment: alignStart,
    fill: FILL_META,
    border: { bottom: MEDIUM_BORDER },
  });
  ws.getRow(3).height = 20;

  // Rows 4-6: Multi-row Navy Table Header
  setMerged(ws, 4, 1, 6, 1, labels.colIndex, {
    font: makeFont(10, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_NAVY,
    border: { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
  });
  setMerged(ws, 4, 2, 6, 2, labels.colFullName, {
    font: makeFont(10, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_NAVY,
    border: { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: MEDIUM_BORDER },
  });

  if (dayCount > 0) {
    setMerged(ws, 4, firstDayCol, 4, lastDayCol, labels.colDaysHeader, {
      font: makeFont(10, { bold: true, color: 'FFFFFFFF' }),
      alignment: alignCenter,
      fill: FILL_NAVY,
      border: { top: MEDIUM_BORDER, bottom: HEADER_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
    });

    register.days.forEach((dayInfo, idx) => {
      const mCol = firstDayCol + idx * 2;
      const eCol = mCol + 1;
      const headerFill = dayInfo.isSchoolDay ? FILL_NAVY : FILL_NAVY_HOLIDAY;
      const subFill = dayInfo.isSchoolDay ? FILL_SUBHEADER : FILL_NAVY_HOLIDAY;

      setMerged(ws, 5, mCol, 5, eCol, dayInfo.day, {
        font: makeFont(10, { bold: true, color: 'FFFFFFFF' }),
        alignment: alignCenter,
        fill: headerFill,
        border: { top: HEADER_BORDER, bottom: HEADER_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
      });

      setMerged(ws, 6, mCol, 6, mCol, labels.shortMorning, {
        font: makeFont(9, { bold: true, color: 'FFFFFFFF' }),
        alignment: alignCenter,
        fill: subFill,
        border: { top: HEADER_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
      });

      setMerged(ws, 6, eCol, 6, eCol, labels.shortEvening, {
        font: makeFont(9, { bold: true, color: 'FFFFFFFF' }),
        alignment: alignCenter,
        fill: subFill,
        border: { top: HEADER_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
      });
    });
  }

  setMerged(ws, 4, sumMorningCol, 5, sumAllCol, labels.colMonthlyTotal, {
    font: makeFont(10, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_NAVY,
    border: { top: MEDIUM_BORDER, bottom: HEADER_BORDER, left: MEDIUM_BORDER, right: MEDIUM_BORDER },
  });
  setMerged(ws, 6, sumMorningCol, 6, sumMorningCol, labels.shortMorning, {
    font: makeFont(9.5, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_SUBHEADER,
    border: { top: HEADER_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: MEDIUM_BORDER },
  });
  setMerged(ws, 6, sumEveningCol, 6, sumEveningCol, labels.shortEvening, {
    font: makeFont(9.5, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_SUBHEADER,
    border: { top: HEADER_BORDER, bottom: MEDIUM_BORDER, left: HEADER_BORDER, right: HEADER_BORDER },
  });
  setMerged(ws, 6, sumAllCol, 6, sumAllCol, labels.colTotal, {
    font: makeFont(9.5, { bold: true, color: 'FFFFFFFF' }),
    alignment: alignCenter,
    fill: FILL_SUBHEADER,
    border: { top: HEADER_BORDER, bottom: MEDIUM_BORDER, left: MEDIUM_BORDER, right: HEADER_BORDER },
  });

  ws.getRow(4).height = 20;
  ws.getRow(5).height = 20;
  ws.getRow(6).height = 19;

  // Student Rows
  let r = 7;
  for (const row of register.rows) {
    const idxCell = ws.getCell(r, 1);
    idxCell.value = row.index;
    idxCell.font = makeFont(9.5, { bold: true });
    idxCell.alignment = alignCenter;
    idxCell.fill = FILL_META;
    idxCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

    const nameCell = ws.getCell(r, 2);
    nameCell.value = safeSpreadsheetText(row.fullName);
    nameCell.font = makeFont(10, { bold: false });
    nameCell.alignment = alignStart;
    nameCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: MEDIUM_BORDER };

    row.days.forEach((cellData, dayIdx) => {
      const mCol = firstDayCol + dayIdx * 2;
      const eCol = mCol + 1;
      const isSchool = register.days[dayIdx]?.isSchoolDay ?? true;

      const mCell = ws.getCell(r, mCol);
      mCell.value = cellData.morningHours > 0 ? cellData.morningHours : '';
      mCell.font = makeFont(9.5, {
        bold: cellData.morningHours > 0,
        color: cellData.morningHours > 0 ? 'FF991B1B' : 'FF0F172A',
      });
      mCell.alignment = alignCenter;
      if (cellData.morningHours > 0) mCell.fill = FILL_ABSENT;
      else if (!isSchool) mCell.fill = FILL_NON_SCHOOL;
      mCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

      const eCell = ws.getCell(r, eCol);
      eCell.value = cellData.eveningHours > 0 ? cellData.eveningHours : '';
      eCell.font = makeFont(9.5, {
        bold: cellData.eveningHours > 0,
        color: cellData.eveningHours > 0 ? 'FF991B1B' : 'FF0F172A',
      });
      eCell.alignment = alignCenter;
      if (cellData.eveningHours > 0) eCell.fill = FILL_ABSENT;
      else if (!isSchool) eCell.fill = FILL_NON_SCHOOL;
      eCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
    });

    const mSumCell = ws.getCell(r, sumMorningCol);
    mSumCell.value = row.morningTotal;
    mSumCell.font = makeFont(9.5, { bold: row.morningTotal > 0 });
    mSumCell.alignment = alignCenter;
    mSumCell.fill = FILL_TOTAL_COL;
    mSumCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: MEDIUM_BORDER };

    const eSumCell = ws.getCell(r, sumEveningCol);
    eSumCell.value = row.eveningTotal;
    eSumCell.font = makeFont(9.5, { bold: row.eveningTotal > 0 });
    eSumCell.alignment = alignCenter;
    eSumCell.fill = FILL_TOTAL_COL;
    eSumCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

    const allSumCell = ws.getCell(r, sumAllCol);
    allSumCell.value = row.totalHours;
    allSumCell.font = makeFont(10, { bold: true, color: row.totalHours > 0 ? 'FF991B1B' : 'FF0F172A' });
    allSumCell.alignment = alignCenter;
    allSumCell.fill = FILL_GRAND_TOTAL;
    allSumCell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: MEDIUM_BORDER, right: THIN_BORDER };

    ws.getRow(r).height = 20;
    r += 1;
  }

  // Footer Totals Row
  setMerged(ws, r, 1, r, 2, labels.footerTotal, {
    font: makeFont(10, { bold: true }),
    alignment: alignCenter,
    fill: FILL_GRAND_TOTAL,
    border: { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: MEDIUM_BORDER, right: MEDIUM_BORDER },
  });

  register.dailyTotals.forEach((dayTotal, dayIdx) => {
    const mCol = firstDayCol + dayIdx * 2;
    const eCol = mCol + 1;

    const mFoot = ws.getCell(r, mCol);
    mFoot.value = dayTotal.morningHours > 0 ? dayTotal.morningHours : '';
    mFoot.font = makeFont(9, { bold: true });
    mFoot.alignment = alignCenter;
    mFoot.fill = FILL_GRAND_TOTAL;
    mFoot.border = { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: THIN_BORDER, right: THIN_BORDER };

    const eFoot = ws.getCell(r, eCol);
    eFoot.value = dayTotal.eveningHours > 0 ? dayTotal.eveningHours : '';
    eFoot.font = makeFont(9, { bold: true });
    eFoot.alignment = alignCenter;
    eFoot.fill = FILL_GRAND_TOTAL;
    eFoot.border = { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: THIN_BORDER, right: THIN_BORDER };
  });

  const footerMorning = ws.getCell(r, sumMorningCol);
  footerMorning.value = register.totals.morningHours;
  footerMorning.font = makeFont(10, { bold: true });
  footerMorning.alignment = alignCenter;
  footerMorning.fill = FILL_GRAND_TOTAL;
  footerMorning.border = { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: THIN_BORDER, right: MEDIUM_BORDER };

  const footerEvening = ws.getCell(r, sumEveningCol);
  footerEvening.value = register.totals.eveningHours;
  footerEvening.font = makeFont(10, { bold: true });
  footerEvening.alignment = alignCenter;
  footerEvening.fill = FILL_GRAND_TOTAL;
  footerEvening.border = { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: THIN_BORDER, right: THIN_BORDER };

  const footerAll = ws.getCell(r, sumAllCol);
  footerAll.value = register.totals.totalHours;
  footerAll.font = makeFont(10.5, { bold: true });
  footerAll.alignment = alignCenter;
  footerAll.fill = FILL_GRAND_TOTAL;
  footerAll.border = { top: MEDIUM_BORDER, bottom: MEDIUM_BORDER, left: MEDIUM_BORDER, right: THIN_BORDER };

  ws.getRow(r).height = 22;

  return ws;
}

export function buildAbsenceRegisterWorkbook(
  registers: ClassAbsenceRegister[],
  meta: AbsenceRegisterExportMeta,
  labels: AbsenceRegisterExportLabels,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.institutionName || 'EduTrack';
  workbook.created = new Date();
  const usedNames = new Set<string>();

  for (const register of registers) {
    const sheetName = sanitizeSheetName(register.className, usedNames);
    appendRegisterWorksheet(workbook, register, meta, labels, sheetName);
  }

  return workbook;
}

export async function exportAbsenceRegisterExcel(
  registers: ClassAbsenceRegister[],
  meta: AbsenceRegisterExportMeta,
  labels: AbsenceRegisterExportLabels,
): Promise<void> {
  if (registers.length === 0) return;
  const workbook = buildAbsenceRegisterWorkbook(registers, meta, labels);
  const buffer = await workbook.xlsx.writeBuffer();
  const singleClassSuffix = registers.length === 1 ? `_${sanitizeFileSegment(registers[0].className)}` : '';
  const filename = `${labels.filePrefix}${singleClassSuffix}_${registers[0].month}.xlsx`;
  await downloadBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Cairo, Arial, system-ui, sans-serif; color: #0f172a; margin: 12px; }
  .banner { background: #1f3864; color: #ffffff; padding: 8px 12px; font-size: 15px; font-weight: 700; }
  .meta { display: flex; flex-wrap: wrap; gap: 16px; background: #f8fafc; border: 1px solid #cbd5e1; border-top: 0; padding: 6px 12px; font-size: 11px; font-weight: 600; }
  .legend { background: #ffffff; border: 1px solid #cbd5e1; border-top: 0; padding: 4px 12px; font-size: 11px; font-weight: 600; color: #334155; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; table-layout: fixed; }
  th, td { border: 1px solid #64748b; padding: 3px 2px; text-align: center; vertical-align: middle; }
  thead th { background: #1f3864; color: #ffffff; font-weight: 700; }
  thead th.sub { background: #2b4c7e; font-size: 8.5px; }
  thead th.holiday { background: #334155; }
  td.idx { width: 22px; background: #f8fafc; font-weight: 700; }
  td.name { width: 96px; text-align: start; padding: 3px 5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  th.idx-col { width: 22px; }
  th.name-col { width: 96px; }
  th.sum-col, td.sum-col { width: 24px; background: #f1f5f9; font-weight: 700; color: #0f172a; }
  thead th.sum-col { background: #2b4c7e; color: #ffffff; }
  td.non-school { background: #f1f5f9; }
  td.absent { background: #fee2e2; color: #991b1b; font-weight: 700; }
  tfoot td { background: #e2e8f0; font-weight: 700; }
  tr { break-inside: avoid; }
  @page { size: A4 landscape; margin: 8mm; }
`;

function buildPrintableTable(
  doc: Document,
  register: ClassAbsenceRegister,
  labels: AbsenceRegisterExportLabels,
): HTMLTableElement {
  const table = doc.createElement('table');
  const thead = table.createTHead();

  // Header row 1
  const r1 = thead.insertRow();
  const thIdx = doc.createElement('th');
  thIdx.rowSpan = 3;
  thIdx.className = 'idx-col';
  thIdx.textContent = labels.colIndex;
  r1.appendChild(thIdx);

  const thName = doc.createElement('th');
  thName.rowSpan = 3;
  thName.className = 'name-col';
  thName.textContent = labels.colFullName;
  r1.appendChild(thName);

  const thDays = doc.createElement('th');
  thDays.colSpan = register.days.length * 2;
  thDays.textContent = labels.colDaysHeader;
  r1.appendChild(thDays);

  const thTotals = doc.createElement('th');
  thTotals.colSpan = 3;
  thTotals.rowSpan = 2;
  thTotals.textContent = labels.colMonthlyTotal;
  r1.appendChild(thTotals);

  // Header row 2 (day numbers)
  const r2 = thead.insertRow();
  for (const dayInfo of register.days) {
    const th = doc.createElement('th');
    th.colSpan = 2;
    th.textContent = String(dayInfo.day);
    if (!dayInfo.isSchoolDay) th.className = 'holiday';
    r2.appendChild(th);
  }

  // Header row 3 (ص / م)
  const r3 = thead.insertRow();
  for (const dayInfo of register.days) {
    const thM = doc.createElement('th');
    thM.className = dayInfo.isSchoolDay ? 'sub' : 'holiday';
    thM.textContent = labels.shortMorning;
    r3.appendChild(thM);

    const thE = doc.createElement('th');
    thE.className = dayInfo.isSchoolDay ? 'sub' : 'holiday';
    thE.textContent = labels.shortEvening;
    r3.appendChild(thE);
  }
  for (const label of [labels.shortMorning, labels.shortEvening, labels.colTotal]) {
    const th = doc.createElement('th');
    th.className = 'sum-col';
    th.textContent = label;
    r3.appendChild(th);
  }

  // Body
  const tbody = table.createTBody();
  for (const row of register.rows) {
    const tr = tbody.insertRow();
    const tdIdx = tr.insertCell();
    tdIdx.className = 'idx';
    tdIdx.textContent = String(row.index);

    const tdName = tr.insertCell();
    tdName.className = 'name';
    tdName.textContent = row.fullName;

    row.days.forEach((cellData, dayIdx) => {
      const isSchool = register.days[dayIdx]?.isSchoolDay ?? true;

      const tdM = tr.insertCell();
      if (cellData.morningHours > 0) {
        tdM.className = 'absent';
        tdM.textContent = String(cellData.morningHours);
      } else if (!isSchool) {
        tdM.className = 'non-school';
      }

      const tdE = tr.insertCell();
      if (cellData.eveningHours > 0) {
        tdE.className = 'absent';
        tdE.textContent = String(cellData.eveningHours);
      } else if (!isSchool) {
        tdE.className = 'non-school';
      }
    });

    const tdSumM = tr.insertCell();
    tdSumM.className = 'sum-col';
    tdSumM.textContent = String(row.morningTotal);

    const tdSumE = tr.insertCell();
    tdSumE.className = 'sum-col';
    tdSumE.textContent = String(row.eveningTotal);

    const tdSumAll = tr.insertCell();
    tdSumAll.className = 'sum-col';
    tdSumAll.textContent = String(row.totalHours);
  }

  // Footer
  const tfoot = table.createTFoot();
  const footRow = tfoot.insertRow();
  const tdFootLabel = footRow.insertCell();
  tdFootLabel.colSpan = 2;
  tdFootLabel.textContent = labels.footerTotal;

  for (const dayTotal of register.dailyTotals) {
    const tdM = footRow.insertCell();
    tdM.textContent = dayTotal.morningHours > 0 ? String(dayTotal.morningHours) : '';
    const tdE = footRow.insertCell();
    tdE.textContent = dayTotal.eveningHours > 0 ? String(dayTotal.eveningHours) : '';
  }

  for (const val of [register.totals.morningHours, register.totals.eveningHours, register.totals.totalHours]) {
    const td = footRow.insertCell();
    td.textContent = String(val);
  }

  return table;
}

export function printAbsenceRegister(
  register: ClassAbsenceRegister,
  meta: AbsenceRegisterExportMeta,
  labels: AbsenceRegisterExportLabels,
): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }

  doc.documentElement.lang = meta.lang;
  doc.documentElement.dir = meta.dir;
  doc.title = `${labels.bannerTitle} - ${register.className} - ${register.month}`;

  const style = doc.createElement('style');
  style.textContent = PRINT_STYLES;
  doc.head.appendChild(style);

  const banner = doc.createElement('div');
  banner.className = 'banner';
  banner.textContent = `${labels.bannerTitle} — ${register.className}`;

  const metaBar = doc.createElement('div');
  metaBar.className = 'meta';
  const items = [
    `${labels.institutionLabel}: ${meta.institutionName}`,
    `${labels.monthLabel}: ${meta.monthDisplay}`,
    `${labels.classLabel}: ${register.className}`,
    `${labels.schoolYearLabel}: ${meta.schoolYear}`,
  ];
  for (const item of items) {
    const span = doc.createElement('span');
    span.textContent = item;
    metaBar.appendChild(span);
  }

  const legend = doc.createElement('div');
  legend.className = 'legend';
  legend.textContent = labels.legendText;

  doc.body.append(banner, metaBar, legend, buildPrintableTable(doc, register, labels));

  const cleanup = () => frame.remove();
  if (isNativeApp) {
    cleanup();
    const html = `<!doctype html>\n${doc.documentElement.outerHTML}`;
    const filename = `${labels.filePrefix}_${sanitizeFileSegment(register.className)}_${register.month}.html`;
    void downloadBlob(new Blob([html], { type: 'text/html' }), filename);
    return;
  }

  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60_000);
  }, 100);
}

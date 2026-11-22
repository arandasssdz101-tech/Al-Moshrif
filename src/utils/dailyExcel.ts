import ExcelJS from 'exceljs';
import type { ParentCorrespondenceRow } from '@/db/types';
import type { StudentDayAbsence } from '@/utils/dailyPage1';
import {
  BOARDING_LABELS,
  footerText,
  formatDate,
  levelColumnCount,
  PARENT_MIN_ROWS,
  REASON_LABELS,
  resolveCanteenSupervisors,
  SUPERVISOR_LABELS,
  SUPERVISOR_MIN_ROWS,
  TEACHER_MIN_ROWS,
  TEACHER_PERIOD_COLUMNS,
  WHOLE_BLOCK_SIZE,
  WHOLE_TABLE_ROWS,
  type DailyReportRender,
} from '@/utils/dailyReportHtml';
import { absenceRate, formatRate } from '@/utils/dailyReportStats';
import { downloadBlob } from '@/utils/download';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FONT_FAMILY = 'Arial';

const FILL_HEADER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
const FILL_SUBTLE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const FILL_TITLE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

const THIN: ExcelJS.Border = { style: 'thin', color: { argb: 'FF1F2937' } };
const MEDIUM: ExcelJS.Border = { style: 'medium', color: { argb: 'FF000000' } };

const ALIGN_CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
const ALIGN_RIGHT: Partial<ExcelJS.Alignment> = { horizontal: 'right', vertical: 'middle', wrapText: true };
const ALIGN_LEFT: Partial<ExcelJS.Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };
const ALIGN_NOTE_BODY: Partial<ExcelJS.Alignment> = { horizontal: 'right', vertical: 'top', wrapText: true };

const font = (size: number, bold = false): Partial<ExcelJS.Font> => ({
  name: FONT_FAMILY,
  size,
  bold,
  color: { argb: 'FF000000' },
});

function estimateHeight(text: string, charsPerLine: number, minPt: number, linePt = 16): number {
  if (!text.trim()) return minPt;
  const lines = text
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(1, charsPerLine))), 0);
  return Math.max(minPt, lines * linePt + 10);
}

interface CellStyleOptions {
  size?: number;
  bold?: boolean;
  align?: Partial<ExcelJS.Alignment>;
  fill?: ExcelJS.Fill;
}

function setMergedCell(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  value: string | number,
  options: CellStyleOptions = {},
): void {
  if (r2 > r1 || c2 > c1) {
    ws.mergeCells(r1, c1, r2, c2);
  }
  const cellFont = font(options.size ?? 9.5, options.bold ?? false);
  const alignment = options.align ?? ALIGN_CENTER;
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = cellFont;
      cell.alignment = alignment;
      if (options.fill) cell.fill = options.fill;
    }
  }
  ws.getCell(r1, c1).value = value;
}

function applyGridBorders(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  outer: ExcelJS.Border = MEDIUM,
  inner: ExcelJS.Border = THIN,
): void {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: r === r1 ? outer : inner,
        bottom: r === r2 ? outer : inner,
        left: c === c1 ? outer : inner,
        right: c === c2 ? outer : inner,
      };
    }
  }
}

function applyOuterBorder(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  edge: ExcelJS.Border = MEDIUM,
): void {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      const prev = cell.border ?? {};
      cell.border = {
        top: r === r1 ? edge : prev.top,
        bottom: r === r2 ? edge : prev.bottom,
        left: c === c1 ? edge : prev.left,
        right: c === c2 ? edge : prev.right,
      };
    }
  }
}

function applyVerticalDivider(
  ws: ExcelJS.Worksheet,
  r1: number,
  r2: number,
  colLeftOfDivider: number,
  edge: ExcelJS.Border = MEDIUM,
): void {
  for (let r = r1; r <= r2; r += 1) {
    const cell = ws.getCell(r, colLeftOfDivider);
    cell.border = { ...(cell.border ?? {}), right: edge };
    const next = ws.getCell(r, colLeftOfDivider + 1);
    next.border = { ...(next.border ?? {}), left: edge };
  }
}

function configureWorksheet(ws: ExcelJS.Worksheet, widths: number[], fitToHeight = 1): void {
  ws.views = [{ rightToLeft: true, showGridLines: true }];
  ws.columns = widths.map((width) => ({ width }));
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight,
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
}

function buildPage1Worksheet(workbook: ExcelJS.Workbook, render: DailyReportRender): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet('الصفحة 1 - التقرير اليومي');
  const classCols = levelColumnCount(render);
  const totalCols = classCols + 5; // default 16 cols when classCols = 11

  const widths = [
    5.5,
    12.5,
    ...Array<number>(classCols).fill(6.6),
    8.2,
    8.5,
    10.5,
  ];
  configureWorksheet(ws, widths, 1);

  const { header } = render;
  let r = 1;

  // 1. Official Header
  const rightEnd = Math.min(totalCols - 6, 10);
  setMergedCell(ws, r, 1, r, rightEnd, `مديرية التربية لولاية : ${header.wilaya}`, {
    size: 10.5,
    bold: true,
    align: ALIGN_RIGHT,
  });
  setMergedCell(ws, r, rightEnd + 1, r, totalCols, `السنة الدراسية : ${header.schoolYear}`, {
    size: 10.5,
    bold: true,
    align: ALIGN_LEFT,
  });
  ws.getRow(r).height = 19;
  r += 1;

  setMergedCell(ws, r, 1, r, rightEnd, `المؤسسة : ${header.institution}`, {
    size: 10.5,
    bold: true,
    align: ALIGN_RIGHT,
  });
  ws.getRow(r).height = 19;
  r += 1;

  setMergedCell(ws, r, 1, r, rightEnd, `الرقم : ${header.reportNumber}`, {
    size: 10.5,
    bold: true,
    align: ALIGN_RIGHT,
  });
  ws.getRow(r).height = 18;
  r += 1;

  // Framed Title Box
  const titleStart = Math.max(4, Math.floor((totalCols - 6) / 2) + 1);
  const titleEnd = titleStart + 5;
  setMergedCell(ws, r, titleStart, r, titleEnd, 'التقرير اليومي للناظر', {
    size: 13,
    bold: true,
    align: ALIGN_CENTER,
    fill: FILL_TITLE,
  });
  ws.getRow(r).height = 24;
  setMergedCell(ws, r + 1, titleStart, r + 1, titleEnd, `ليوم : ${formatDate(header.reportDate)}`, {
    size: 10.5,
    bold: true,
    align: ALIGN_CENTER,
    fill: FILL_TITLE,
  });
  ws.getRow(r + 1).height = 20;
  applyOuterBorder(ws, r, titleStart, r + 1, titleEnd, MEDIUM);
  r += 2;

  // 2. Section 1: Teachers Attendance
  setMergedCell(ws, r, 1, r, totalCols, '1- مواضبة الأساتذة:', { size: 10, bold: true, align: ALIGN_RIGHT });
  ws.getRow(r).height = 18;
  r += 1;
  setMergedCell(ws, r, 1, r, totalCols, '1-1- دروس لم تقدم:', { size: 9.5, bold: true, align: ALIGN_RIGHT });
  ws.getRow(r).height = 16;
  r += 1;

  const periods = Array.from({ length: TEACHER_PERIOD_COLUMNS }, (_, index) => index + 1);
  const tStart = r;
  const periodStartCol = 7;
  const noteStartCol = periodStartCol + TEACHER_PERIOD_COLUMNS; // col 15

  setMergedCell(ws, r, 1, r, 1, 'الرقم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 2, r, 4, 'اللقب و الاسم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 5, r, 6, 'المادة', { size: 9, bold: true, fill: FILL_HEADER });
  periods.forEach((period, index) => {
    setMergedCell(ws, r, periodStartCol + index, r, periodStartCol + index, period, {
      size: 9,
      bold: true,
      fill: FILL_HEADER,
    });
  });
  setMergedCell(ws, r, noteStartCol, r, totalCols, 'ملاحظات', { size: 9, bold: true, fill: FILL_HEADER });
  ws.getRow(r).height = 20;
  r += 1;

  const teacherRowCount = Math.max(TEACHER_MIN_ROWS, render.computed.teacherLines.length);
  for (let index = 0; index < teacherRowCount; index += 1) {
    const line = render.computed.teacherLines[index];
    const note = line
      ? [line.reason ? REASON_LABELS[line.reason] : '', line.reasonNote, line.note].filter(Boolean).join(' - ')
      : '';
    setMergedCell(ws, r, 1, r, 1, String(index + 1).padStart(2, '0'), { size: 9, bold: true });
    setMergedCell(ws, r, 2, r, 4, line?.name ?? '', { size: 9, align: ALIGN_RIGHT });
    setMergedCell(ws, r, 5, r, 6, line?.subjects ?? '', { size: 9, align: ALIGN_RIGHT });
    periods.forEach((period, pIdx) => {
      setMergedCell(ws, r, periodStartCol + pIdx, r, periodStartCol + pIdx, line?.classByPeriod[period] ?? '', {
        size: 9,
      });
    });
    setMergedCell(ws, r, noteStartCol, r, totalCols, note, { size: 8.5, align: ALIGN_RIGHT });
    ws.getRow(r).height = Math.max(17, estimateHeight(note, 20, 17, 13));
    r += 1;
  }
  applyGridBorders(ws, tStart, 1, r - 1, totalCols, MEDIUM, THIN);

  // 3. Observations & Actions
  setMergedCell(ws, r, 1, r, totalCols, '2-1- ملاحظات و إجراءات:', { size: 9.5, bold: true, align: ALIGN_CENTER });
  ws.getRow(r).height = 17;
  r += 1;

  setMergedCell(ws, r, 1, r, totalCols, render.observations || '', {
    size: 9.5,
    align: ALIGN_NOTE_BODY,
  });
  ws.getRow(r).height = estimateHeight(render.observations, 95, 36);
  applyOuterBorder(ws, r, 1, r, totalCols, MEDIUM);
  r += 1;

  // 4. Section 2: Canteen Monitoring
  setMergedCell(ws, r, 1, r, totalCols, '2- مراقبة المطعم:', { size: 10, bold: true, align: ALIGN_RIGHT });
  ws.getRow(r).height = 19;
  r += 1;

  const { canteen } = render.computed;
  const sups = resolveCanteenSupervisors(render);
  const cStart = r;
  const mealColsTotal = totalCols - 3; // cols 4..totalCols
  const plannedWidth = Math.floor(mealColsTotal / 3);
  const servedWidth = Math.floor(mealColsTotal / 3);
  const plannedStart = 4;
  const plannedEnd = plannedStart + plannedWidth - 1;
  const servedStart = plannedEnd + 1;
  const servedEnd = servedStart + servedWidth - 1;
  const noteStart = servedEnd + 1;

  setMergedCell(ws, r, 1, r, 2, 'تعداد التلاميذ', { size: 9, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, r, 3, r, 3, canteen.halfBoarders, { size: 9.5, bold: true });
  setMergedCell(ws, r, plannedStart, r, plannedEnd, 'الوجبة الغذائية المقررة', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, servedStart, r, servedEnd, 'الوجبة الغذائية المقدمة', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, noteStart, r, totalCols, 'ملاحظات', { size: 9, bold: true, fill: FILL_HEADER });
  ws.getRow(r).height = 20;
  r += 1;

  const canteenBodyStart = r;
  const canteenLeft: [string, string | number, boolean][] = [
    ['التلاميذ الغائبون', canteen.absent, true],
    ['التلاميذ الحاضرون', canteen.present, true],
    ['المراقبون المكلفون', '', true],
    [sups[0] ?? '', '', false],
    [sups[1] ?? '', '', false],
    [sups[2] ?? '', '', false],
  ];

  canteenLeft.forEach(([label, val, isLabel]) => {
    setMergedCell(ws, r, 1, r, 2, label, {
      size: 9,
      bold: isLabel,
      align: isLabel ? ALIGN_CENTER : ALIGN_RIGHT,
      fill: isLabel ? FILL_SUBTLE : undefined,
    });
    setMergedCell(ws, r, 3, r, 3, val, { size: 9.5, bold: val !== '' });
    ws.getRow(r).height = 17.5;
    r += 1;
  });

  const canteenBodyEnd = r - 1;
  setMergedCell(ws, canteenBodyStart, plannedStart, canteenBodyEnd, plannedEnd, render.plannedMeal || '', {
    size: 9.5,
    align: ALIGN_CENTER,
  });
  setMergedCell(ws, canteenBodyStart, servedStart, canteenBodyEnd, servedEnd, render.mealServed || '', {
    size: 9.5,
    align: ALIGN_CENTER,
  });
  setMergedCell(ws, canteenBodyStart, noteStart, canteenBodyEnd, totalCols, render.canteenNote || '', {
    size: 9.5,
    align: ALIGN_CENTER,
  });
  applyGridBorders(ws, cStart, 1, canteenBodyEnd, totalCols, MEDIUM, THIN);

  // 5. Section 3: Student Absences by Level
  const studentSecHeader = render.entrySummary
    ? `3- مراقبة التلاميذ  —  عدد الداخلين اليوم: ${render.entrySummary.entered} من ${render.entrySummary.enrolled}`
    : '3- مراقبة التلاميذ';
  setMergedCell(ws, r, 1, r, totalCols, studentSecHeader, { size: 10, bold: true, align: ALIGN_RIGHT });
  ws.getRow(r).height = 19;
  r += 1;
  setMergedCell(ws, r, 1, r, classCols + 2, '1-3- الغيابات:', { size: 9.5, bold: true, align: ALIGN_RIGHT });
  const sumCol1 = classCols + 3; // تلاميذ (col 14)
  const sumCol2 = classCols + 4; // الغائبون (col 15)
  const rateCol = classCols + 5; // نسبة الغياب (col 16)
  setMergedCell(ws, r, sumCol1, r, sumCol2, 'المجموع', { size: 9.5, bold: true, fill: FILL_HEADER });
  applyOuterBorder(ws, r, sumCol1, r, sumCol2, MEDIUM);
  ws.getRow(r).height = 19;
  r += 1;

  const levelsStart = r;
  setMergedCell(ws, r, 1, r, 2, 'المستوى', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 3, r, classCols + 2, 'الأفواج', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, sumCol1, r, sumCol1, 'تلاميذ', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, sumCol2, r, sumCol2, 'الغائبون', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, rateCol, r, rateCol, 'نسبة الغياب', { size: 9, bold: true, fill: FILL_HEADER });
  ws.getRow(r).height = 20;
  r += 1;

  const colSums = Array.from({ length: classCols }, (_, colIndex) =>
    render.computed.levels.reduce((sum, level) => sum + (level.classes[colIndex]?.absent ?? 0), 0),
  );

  for (const level of render.computed.levels) {
    setMergedCell(ws, r, 1, r, 2, `الأقسام السنة ${level.level}`, { size: 9, bold: true, align: ALIGN_RIGHT, fill: FILL_SUBTLE });
    setMergedCell(ws, r + 1, 1, r + 1, 2, 'عدد الغائبين', { size: 8.5, align: ALIGN_RIGHT });
    for (let idx = 0; idx < classCols; idx += 1) {
      const cls = level.classes[idx];
      const col = 3 + idx;
      setMergedCell(ws, r, col, r, col, cls ? cls.className : '/', { size: 9, bold: Boolean(cls), fill: FILL_SUBTLE });
      setMergedCell(ws, r + 1, col, r + 1, col, cls ? cls.absent : '', { size: 9 });
    }
    setMergedCell(ws, r, sumCol1, r + 1, sumCol1, level.enrolled, { size: 9.5, bold: true });
    setMergedCell(ws, r, sumCol2, r + 1, sumCol2, level.absent, { size: 9.5, bold: true });
    setMergedCell(ws, r, rateCol, r + 1, rateCol, formatRate(level.rate), { size: 9, bold: true });
    ws.getRow(r).height = 17;
    ws.getRow(r + 1).height = 17;
    r += 2;
  }

  const totalEnrolled = render.computed.levels.reduce((sum, level) => sum + level.enrolled, 0);
  const totalAbsent = render.computed.levels.reduce((sum, level) => sum + level.absent, 0);
  setMergedCell(ws, r, 1, r, 2, 'مجموع', { size: 9.5, bold: true, fill: FILL_HEADER });
  colSums.forEach((val, idx) => {
    setMergedCell(ws, r, 3 + idx, r, 3 + idx, val, { size: 9, bold: true, fill: FILL_HEADER });
  });
  setMergedCell(ws, r, sumCol1, r, sumCol1, totalEnrolled, { size: 9.5, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, sumCol2, r, sumCol2, totalAbsent, { size: 9.5, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, rateCol, r, rateCol, formatRate(absenceRate(totalAbsent, totalEnrolled)), {
    size: 9,
    bold: true,
    fill: FILL_HEADER,
  });
  ws.getRow(r).height = 19;
  const levelsEnd = r;
  applyGridBorders(ws, levelsStart, 1, levelsEnd, totalCols, MEDIUM, THIN);
  // Highlight the "المجموع" column block (تلاميذ + الغائبون) with thick outer edges
  applyOuterBorder(ws, levelsStart, sumCol1, levelsEnd, sumCol2, MEDIUM);
  r += 1;

  // Small spacer row
  ws.getRow(r).height = 6;
  r += 1;

  // 6. Side-by-Side Split: Supervisors Absences (right) + Summary (left)
  const summaryStart = totalCols - 6; // 7 columns: label(2) + male + female + all + teachers + supervisors
  const gapCol = summaryStart - 1;
  const supEnd = gapCol - 1; // default cols 1..8

  setMergedCell(ws, r, 1, r, supEnd, '2-3- غيابات وتأخرات المساعدين التربويين:', {
    size: 9.5,
    bold: true,
    align: ALIGN_RIGHT,
  });
  setMergedCell(ws, r, summaryStart, r, totalCols, 'الخلاصة', {
    size: 10,
    bold: true,
    align: ALIGN_CENTER,
  });
  ws.getRow(r).height = 18;
  r += 1;

  const splitStart = r;
  const supRowsTotal = Math.max(SUPERVISOR_MIN_ROWS, render.supervisorRows.length);
  const splitRows = Math.max(supRowsTotal + 1, 5); // header + at least 4 rows (Summary has 2 header + 3 data = 5 rows)

  // Right table: Supervisors
  setMergedCell(ws, splitStart, 1, splitStart, 3, 'اللقب و الاسم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, splitStart, 4, splitStart, 4, 'صباحا', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, splitStart, 5, splitStart, 5, 'مساءا', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, splitStart, 6, splitStart, supEnd, 'الملاحظات', { size: 9, bold: true, fill: FILL_HEADER });
  for (let idx = 0; idx < splitRows - 1; idx += 1) {
    const rowNum = splitStart + 1 + idx;
    const sup = render.supervisorRows[idx];
    setMergedCell(ws, rowNum, 1, rowNum, 3, sup?.name ?? '', { size: 9, align: ALIGN_RIGHT });
    setMergedCell(ws, rowNum, 4, rowNum, 4, sup ? SUPERVISOR_LABELS[sup.morning] : '', { size: 9 });
    setMergedCell(ws, rowNum, 5, rowNum, 5, sup ? SUPERVISOR_LABELS[sup.evening] : '', { size: 9 });
    setMergedCell(ws, rowNum, 6, rowNum, supEnd, sup?.notes ?? '', { size: 8.5, align: ALIGN_RIGHT });
    ws.getRow(rowNum).height = 18;
  }
  ws.getRow(splitStart).height = 19;
  applyGridBorders(ws, splitStart, 1, splitStart + splitRows - 1, supEnd, MEDIUM, THIN);

  // Left table: Summary (الخلاصة)
  const { students, teachers, supervisors } = render.computed.summary;
  const lblEnd = summaryStart + 1;
  const colMale = summaryStart + 2;
  const colFemale = summaryStart + 3;
  const colAll = summaryStart + 4;
  const colTch = summaryStart + 5;
  const colSup = summaryStart + 6;

  setMergedCell(ws, splitStart, summaryStart, splitStart + 1, lblEnd, '', { size: 9, fill: FILL_SUBTLE });
  setMergedCell(ws, splitStart, colMale, splitStart, colAll, 'التلاميذ', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, splitStart, colTch, splitStart + 1, colTch, 'الأساتذة', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, splitStart, colSup, splitStart + 1, colSup, 'المساعدون', { size: 9, bold: true, fill: FILL_HEADER });

  setMergedCell(ws, splitStart + 1, colMale, splitStart + 1, colMale, 'ذكور', { size: 8.5, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, splitStart + 1, colFemale, splitStart + 1, colFemale, 'إناث', { size: 8.5, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, splitStart + 1, colAll, splitStart + 1, colAll, 'مجموع', { size: 8.5, bold: true, fill: FILL_SUBTLE });

  const summaryRows: [string, number, number, number, number, number][] = [
    ['المجموع', students.male.total, students.female.total, students.all.total, teachers.total, supervisors.total],
    ['الغائبون', students.male.absent, students.female.absent, students.all.absent, teachers.absent, supervisors.absent],
    ['الحاضرون', students.male.present, students.female.present, students.all.present, teachers.present, supervisors.present],
  ];
  summaryRows.forEach(([label, male, female, all, tch, supCount], idx) => {
    const rowNum = splitStart + 2 + idx;
    setMergedCell(ws, rowNum, summaryStart, rowNum, lblEnd, label, { size: 9, bold: true, fill: FILL_SUBTLE });
    setMergedCell(ws, rowNum, colMale, rowNum, colMale, male, { size: 9 });
    setMergedCell(ws, rowNum, colFemale, rowNum, colFemale, female, { size: 9 });
    setMergedCell(ws, rowNum, colAll, rowNum, colAll, all, { size: 9, bold: true });
    setMergedCell(ws, rowNum, colTch, rowNum, colTch, tch, { size: 9 });
    setMergedCell(ws, rowNum, colSup, rowNum, colSup, supCount, { size: 9 });
  });
  applyGridBorders(ws, splitStart, summaryStart, splitStart + 4, totalCols, MEDIUM, THIN);

  r = splitStart + splitRows;
  ws.getRow(r).height = 6;
  r += 1;

  // 7. Bottom Notes & Signatures
  const notesStart = r;
  const labelEnd = 3;
  const signStart = totalCols - 2;
  const bodyStart = labelEnd + 1;
  const bodyEnd = signStart - 1;

  setMergedCell(
    ws,
    r,
    1,
    r,
    labelEnd,
    'ملاحظات حول النظافة\nالصيانة والإتلاف - الحوادث\n- النشاط الثقافي والرياضي -\nدروس الدعم - الزيارات',
    { size: 9, bold: true, fill: FILL_SUBTLE },
  );
  setMergedCell(ws, r, bodyStart, r, bodyEnd, render.counselorNotes || '', { size: 9.5, align: ALIGN_NOTE_BODY });
  setMergedCell(ws, r, signStart, r, totalCols, 'امضاء الناظر', { size: 10, bold: true });
  ws.getRow(r).height = estimateHeight(render.counselorNotes, 58, 72);
  r += 1;

  setMergedCell(ws, r, 1, r, labelEnd, 'ملاحظات مدير المؤسسة', { size: 9.5, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, r, bodyStart, r, bodyEnd, render.directorNotes || '', { size: 9.5, align: ALIGN_NOTE_BODY });
  setMergedCell(ws, r, signStart, r, totalCols, 'امضاء المدير', { size: 10, bold: true });
  ws.getRow(r).height = estimateHeight(render.directorNotes, 58, 42);

  applyGridBorders(ws, notesStart, 1, r, totalCols, MEDIUM, MEDIUM);

  return ws;
}

function writeWholeHalf(
  ws: ExcelJS.Worksheet,
  row: number,
  item: StudentDayAbsence | undefined,
  number: number,
  side: 'right' | 'left',
): void {
  if (side === 'right') {
    setMergedCell(ws, row, 1, row, 1, number, { size: 8.5, bold: true, fill: FILL_SUBTLE });
    setMergedCell(ws, row, 2, row, 2, item?.name ?? '', { size: 8.5, align: ALIGN_RIGHT });
    setMergedCell(ws, row, 3, row, 3, item?.className ?? '', { size: 8.5 });
    setMergedCell(ws, row, 4, row, 4, item ? BOARDING_LABELS[item.boarding] : '', { size: 8.5 });
    setMergedCell(ws, row, 5, row, 5, item ? formatDate(item.since) : '', { size: 8.5 });
  } else {
    setMergedCell(ws, row, 6, row, 6, number, { size: 8.5, bold: true, fill: FILL_SUBTLE });
    setMergedCell(ws, row, 7, row, 8, item?.name ?? '', { size: 8.5, align: ALIGN_RIGHT });
    setMergedCell(ws, row, 9, row, 9, item?.className ?? '', { size: 8.5 });
    setMergedCell(ws, row, 10, row, 11, item ? BOARDING_LABELS[item.boarding] : '', { size: 8.5 });
    setMergedCell(ws, row, 12, row, 12, item ? formatDate(item.since) : '', { size: 8.5 });
  }
}

function writeParentRow(ws: ExcelJS.Worksheet, row: number, item: ParentCorrespondenceRow | undefined, number: number): void {
  setMergedCell(ws, row, 1, row, 1, number, { size: 8.5, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, row, 2, row, 2, item?.name ?? '', { size: 8.5, align: ALIGN_RIGHT });
  setMergedCell(ws, row, 3, row, 3, item?.className ?? '', { size: 8.5 });
  setMergedCell(ws, row, 4, row, 4, item?.hours ?? '', { size: 8.5 });
  setMergedCell(ws, row, 5, row, 5, item ? formatDate(item.absenceDate) : '', { size: 8.5 });
  setMergedCell(ws, row, 6, row, 7, item?.reason ?? '', { size: 8.5, align: ALIGN_RIGHT });
  setMergedCell(ws, row, 8, row, 8, item?.firstNotice ?? '', { size: 8.5 });
  setMergedCell(ws, row, 9, row, 10, item?.secondNotice ?? '', { size: 8.5 });
  setMergedCell(ws, row, 11, row, 11, item?.excuse ?? '', { size: 8.5 });
  setMergedCell(ws, row, 12, row, 12, item ? formatDate(item.struckDate) : '', { size: 8.5 });
}

function buildPage2Worksheet(workbook: ExcelJS.Workbook, render: DailyReportRender): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet('الصفحة 2 - الغيابات والمراسلات');
  const blockCount = Math.max(1, Math.ceil(render.wholeDayAbsences.length / WHOLE_BLOCK_SIZE));

  // 12-column balanced grid:
  // Right half (cols 1..5 = 57.5) and Left half (cols 6..12 = 57.5) are 50/50 symmetrical,
  // while the 10-column Parent Correspondence table maps cleanly onto the same 12 columns.
  const widths = [5.5, 21.5, 7.5, 10.5, 12.5, 5.5, 8.5, 11.5, 7.5, 4.0, 8.5, 12.0];
  configureWorksheet(ws, widths, blockCount);

  let r = 1;

  // 1. Whole-day Student Absences (1..30 | 31..60, repeating blocks if > 60)
  for (let block = 0; block < blockCount; block += 1) {
    if (block > 0) {
      ws.getRow(r - 1).addPageBreak();
    }
    setMergedCell(
      ws,
      r,
      1,
      r,
      12,
      'التلاميذ الغائبون إلى نهاية اليوم : (يسجل التلاميذ المتغيبين لمدة يوم أو أكثر فقط)',
      { size: 10, bold: true, align: ALIGN_RIGHT },
    );
    ws.getRow(r).height = 20;
    r += 1;

    const tableStart = r;
    // Right-half header
    setMergedCell(ws, r, 1, r, 1, 'الرقم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 2, r, 2, 'اللقب و الاسم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 3, r, 3, 'القسم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 4, r, 4, 'الصفة', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 5, r, 5, 'تاريخ الغياب', { size: 9, bold: true, fill: FILL_HEADER });
    // Left-half header
    setMergedCell(ws, r, 6, r, 6, 'الرقم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 7, r, 8, 'اللقب و الاسم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 9, r, 9, 'القسم', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 10, r, 11, 'الصفة', { size: 9, bold: true, fill: FILL_HEADER });
    setMergedCell(ws, r, 12, r, 12, 'تاريخ الغياب', { size: 9, bold: true, fill: FILL_HEADER });
    ws.getRow(r).height = 19;
    r += 1;

    const start = block * WHOLE_BLOCK_SIZE;
    for (let rowOffset = 0; rowOffset < WHOLE_TABLE_ROWS; rowOffset += 1) {
      const rightIdx = start + rowOffset;
      const leftIdx = start + WHOLE_TABLE_ROWS + rowOffset;
      writeWholeHalf(ws, r, render.wholeDayAbsences[rightIdx], rightIdx + 1, 'right');
      writeWholeHalf(ws, r, render.wholeDayAbsences[leftIdx], leftIdx + 1, 'left');
      ws.getRow(r).height = 14.5;
      r += 1;
    }
    const tableEnd = r - 1;
    applyGridBorders(ws, tableStart, 1, tableEnd, 12, MEDIUM, THIN);
    applyVerticalDivider(ws, tableStart, tableEnd, 5, MEDIUM);
    applyVerticalDivider(ws, tableStart, tableEnd, 1, THIN);
  }

  // Small spacer
  ws.getRow(r).height = 6;
  r += 1;

  // 2. Parent Correspondence Table (مراسلات الأولياء)
  setMergedCell(ws, r, 1, r, 12, 'مراسلات الأولياء', { size: 10, bold: true, align: ALIGN_RIGHT });
  ws.getRow(r).height = 19;
  r += 1;

  const parentsStart = r;
  setMergedCell(ws, r, 1, r, 1, 'الرقم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 2, r, 2, 'اللقب و الاسم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 3, r, 3, 'القسم', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 4, r, 4, 'ساعات', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 5, r, 5, 'تاريخ الغياب', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 6, r, 7, 'الأسباب', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 8, r, 8, 'اشعار اول', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 9, r, 10, 'اشعار ثاني', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 11, r, 11, 'اعذار', { size: 9, bold: true, fill: FILL_HEADER });
  setMergedCell(ws, r, 12, r, 12, 'تاريخ الشطب', { size: 9, bold: true, fill: FILL_HEADER });
  ws.getRow(r).height = 19;
  r += 1;

  const parentCount = Math.max(PARENT_MIN_ROWS, render.parentRows.length);
  for (let index = 0; index < parentCount; index += 1) {
    writeParentRow(ws, r, render.parentRows[index], index + 1);
    ws.getRow(r).height = 15.5;
    r += 1;
  }
  applyGridBorders(ws, parentsStart, 1, r - 1, 12, MEDIUM, THIN);

  // 3. Shared Notes & Signatures Table
  const notesStart = r;
  setMergedCell(
    ws,
    r,
    1,
    r,
    2,
    'ملاحظات و اقتراحات\nمستشار التربية حول النظافة -\nالصيانة والإتلاف - الحوادث\n- النشاط الثقافي والرياضي -\nدروس الدعم - الزيارات',
    { size: 9, bold: true, fill: FILL_SUBTLE },
  );
  setMergedCell(ws, r, 3, r, 9, render.counselorNotes || '', { size: 9.5, align: ALIGN_NOTE_BODY });
  setMergedCell(ws, r, 10, r, 12, 'الامضاء', { size: 10.5, bold: true });
  ws.getRow(r).height = estimateHeight(render.counselorNotes, 58, 72);
  r += 1;

  setMergedCell(ws, r, 1, r, 2, 'ملاحظات مدير المؤسسة', { size: 9.5, bold: true, fill: FILL_SUBTLE });
  setMergedCell(ws, r, 3, r, 9, render.directorNotes || '', { size: 9.5, align: ALIGN_NOTE_BODY });
  setMergedCell(ws, r, 10, r, 12, 'الامضاء', { size: 10.5, bold: true });
  ws.getRow(r).height = estimateHeight(render.directorNotes, 58, 86);
  applyGridBorders(ws, notesStart, 1, r, 12, MEDIUM, MEDIUM);
  r += 1;

  // 4. Footer (City & Date)
  ws.getRow(r).height = 24;
  setMergedCell(ws, r, 6, r, 12, footerText(render.header.city, render.header.reportDate), {
    size: 10.5,
    bold: true,
    align: ALIGN_CENTER,
  });

  return ws;
}

export function buildDailyReportWorkbook(render: DailyReportRender): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = render.header.institution || 'الإشراف التربوي';
  workbook.created = new Date();
  buildPage1Worksheet(workbook, render);
  buildPage2Worksheet(workbook, render);
  return workbook;
}

export async function exportDailyReportExcel(render: DailyReportRender, filename: string): Promise<void> {
  const workbook = buildDailyReportWorkbook(render);
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

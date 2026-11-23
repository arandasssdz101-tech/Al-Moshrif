import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import type { BoardingStatus, Gender, SchoolClass, Student } from '@/db/types';
import { downloadBlob } from '@/utils/download';
import { isStudentActive } from '@/utils/statistics';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 200 / 25.4; // ~200 DPI crisp Arabic RTL rendering
const FONT_FAMILY = 'Cairo, Arial, sans-serif';
const FIRST_PAGE_ROWS = 35;
const NEXT_PAGE_ROWS = 38;

export interface StudentListExportLabels {
  columns: {
    index: string;
    lastName: string;
    firstName: string;
    dateOfBirth: string;
    placeOfBirth: string;
    boardingStatus: string;
    repeater: string;
    gender: string;
  };
  gender: Record<Gender, string>;
  boarding: Record<BoardingStatus, string>;
  yes: string;
  no: string;
  listHeading: (className: string) => string;
  continuation: string;
  schoolYearLabel: string;
  exportDateLabel: string;
  institutionLabel: string;
  pageOf: (page: number, total: number) => string;
  totals: {
    total: string;
    males: string;
    females: string;
    halfBoarders: string;
    externals: string;
    repeaters: string;
  };
  fileSinglePrefix: string;
  fileAllPrefix: string;
}

export interface StudentListExportRow {
  index: number;
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  boardingStatus: string;
  repeater: string;
  gender: string;
}

export interface ClassStudentListStats {
  total: number;
  males: number;
  females: number;
  halfBoarders: number;
  externals: number;
  repeaters: number;
}

export interface ClassStudentList {
  classId: string;
  className: string;
  rows: StudentListExportRow[];
  stats: ClassStudentListStats;
}

export interface StudentListExportMeta {
  institutionName: string;
  directorate?: string;
  schoolYear: string;
  exportDate: string;
  lang: string;
}

export interface BuildClassStudentListsParams {
  classes: SchoolClass[];
  students: Student[];
  selectedClassId: string | null;
  includeLeft: boolean;
  today: string;
  lang: string;
  labels: Pick<StudentListExportLabels, 'gender' | 'boarding' | 'yes' | 'no'>;
}

export function formatExportDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const trimmed = iso.trim();
  if (!trimmed) return '—';
  const parts = trimmed.split('-');
  if (parts.length !== 3) return trimmed;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function sanitizeSheetName(name: string, used: Set<string>): string {
  const cleaned = name
    .replace(/[\\/*?:[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Class';

  if (!used.has(cleaned)) {
    used.add(cleaned);
    return cleaned;
  }

  for (let suffix = 2; suffix < 999; suffix += 1) {
    const tail = ` (${suffix})`;
    const candidate = `${cleaned.slice(0, 31 - tail.length)}${tail}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return cleaned;
}

function sanitizeFileSegment(text: string): string {
  return text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .trim();
}

function safeSpreadsheetText(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function buildClassStudentLists({
  classes,
  students,
  selectedClassId,
  includeLeft,
  today,
  lang,
  labels,
}: BuildClassStudentListsParams): ClassStudentList[] {
  const locale = lang.startsWith('ar') ? 'ar' : 'en';
  const targetClasses = (
    selectedClassId
      ? classes.filter((item) => item.id === selectedClassId)
      : [...classes].sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true }))
  );

  const byClassId = new Map<string, Student[]>();
  for (const student of students) {
    if (!includeLeft && !isStudentActive(student, today)) continue;
    const list = byClassId.get(student.classId);
    if (list) list.push(student);
    else byClassId.set(student.classId, [student]);
  }

  const lists: ClassStudentList[] = [];
  for (const schoolClass of targetClasses) {
    const classStudents = (byClassId.get(schoolClass.id) ?? []).sort((a, b) => {
      const byLast = a.lastName.localeCompare(b.lastName, locale, { sensitivity: 'base' });
      if (byLast !== 0) return byLast;
      return a.firstName.localeCompare(b.firstName, locale, { sensitivity: 'base' });
    });

    if (classStudents.length === 0) continue;

    let males = 0;
    let females = 0;
    let halfBoarders = 0;
    let externals = 0;
    let repeaters = 0;

    const rows: StudentListExportRow[] = classStudents.map((student, idx) => {
      if (student.gender === 'male') males += 1;
      else females += 1;
      if (student.boardingStatus === 'half-boarder') halfBoarders += 1;
      else externals += 1;
      if (student.repeater) repeaters += 1;

      return {
        index: idx + 1,
        lastName: student.lastName.trim() || '—',
        firstName: student.firstName.trim() || '—',
        dateOfBirth: formatExportDate(student.dateOfBirth),
        placeOfBirth: student.placeOfBirth.trim() || '—',
        boardingStatus: labels.boarding[student.boardingStatus],
        repeater: student.repeater ? labels.yes : labels.no,
        gender: labels.gender[student.gender],
      };
    });

    lists.push({
      classId: schoolClass.id,
      className: schoolClass.name,
      rows,
      stats: {
        total: classStudents.length,
        males,
        females,
        halfBoarders,
        externals,
        repeaters,
      },
    });
  }

  return lists;
}

export function buildExportFileName(
  lists: ClassStudentList[],
  exportDate: string,
  labels: Pick<StudentListExportLabels, 'fileSinglePrefix' | 'fileAllPrefix'>,
  extension: 'pdf' | 'xlsx',
): string {
  const base =
    lists.length === 1
      ? `${labels.fileSinglePrefix}-${sanitizeFileSegment(lists[0].className)}`
      : labels.fileAllPrefix;
  return `${base}-${exportDate}.${extension}`;
}

function buildStatsLine(stats: ClassStudentListStats, labels: StudentListExportLabels['totals']): string {
  return [
    `${labels.total}: ${stats.total}`,
    `${labels.males}: ${stats.males}`,
    `${labels.females}: ${stats.females}`,
    `${labels.halfBoarders}: ${stats.halfBoarders}`,
    `${labels.externals}: ${stats.externals}`,
    `${labels.repeaters}: ${stats.repeaters}`,
  ].join('   |   ');
}

// ---------------------------------------------------------------------------
// Excel export (ExcelJS — styled, RTL, print-ready, one worksheet per class)
// ---------------------------------------------------------------------------

const EXCEL_FONT = 'Arial';
const THIN_BORDER: ExcelJS.Border = { style: 'thin', color: { argb: 'FFCBD5E1' } };
const MEDIUM_BORDER: ExcelJS.Border = { style: 'medium', color: { argb: 'FF1E293B' } };
const FILL_BANNER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const FILL_HEADER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const FILL_ZEBRA: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const FILL_FOOTER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

export async function buildStudentListsExcelBuffer(
  lists: ClassStudentList[],
  meta: StudentListExportMeta,
  labels: StudentListExportLabels,
): Promise<Uint8Array> {
  const isRtl = meta.lang.startsWith('ar');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.institutionName;
  workbook.created = new Date();

  const usedSheetNames = new Set<string>();
  const headers = [
    labels.columns.index,
    labels.columns.lastName,
    labels.columns.firstName,
    labels.columns.dateOfBirth,
    labels.columns.placeOfBirth,
    labels.columns.boardingStatus,
    labels.columns.repeater,
    labels.columns.gender,
  ];
  const colWidths = [8, 22, 20, 15, 22, 15, 12, 12];

  for (const classList of lists) {
    const sheetName = sanitizeSheetName(classList.className, usedSheetNames);
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ rightToLeft: isRtl }],
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
      },
    });

    colWidths.forEach((width, idx) => {
      ws.getColumn(idx + 1).width = width;
    });

    let currentRow = 1;

    if (isRtl) {
      ws.mergeCells(currentRow, 1, currentRow, 8);
      const repCell = ws.getCell(currentRow, 1);
      repCell.value = 'الجمهورية الجزائرية الديمقراطية الشعبية — وزارة التربية الوطنية';
      repCell.font = { name: EXCEL_FONT, size: 11, bold: true, color: { argb: 'FF0F172A' } };
      repCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(currentRow).height = 22;
      currentRow += 1;
    }

    // Institution & School Year row
    ws.mergeCells(currentRow, 1, currentRow, 5);
    const instCell = ws.getCell(currentRow, 1);
    const instLine = meta.directorate
      ? `${meta.directorate} — ${meta.institutionName}`
      : `${labels.institutionLabel}: ${meta.institutionName}`;
    instCell.value = safeSpreadsheetText(instLine);
    instCell.font = { name: EXCEL_FONT, size: 10, bold: true, color: { argb: 'FF334155' } };
    instCell.alignment = { horizontal: isRtl ? 'right' : 'left', vertical: 'middle' };

    ws.mergeCells(currentRow, 6, currentRow, 8);
    const yearCell = ws.getCell(currentRow, 6);
    yearCell.value = `${labels.schoolYearLabel}: ${meta.schoolYear}  |  ${formatExportDate(meta.exportDate)}`;
    yearCell.font = { name: EXCEL_FONT, size: 10, bold: false, color: { argb: 'FF334155' } };
    yearCell.alignment = { horizontal: isRtl ? 'left' : 'right', vertical: 'middle' };
    ws.getRow(currentRow).height = 20;
    currentRow += 1;

    // Class title banner
    ws.mergeCells(currentRow, 1, currentRow, 8);
    const titleCell = ws.getCell(currentRow, 1);
    titleCell.value = safeSpreadsheetText(labels.listHeading(classList.className));
    titleCell.font = { name: EXCEL_FONT, size: 13, bold: true, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= 8; c += 1) {
      const cell = ws.getCell(currentRow, c);
      cell.fill = FILL_BANNER;
      cell.border = {
        top: MEDIUM_BORDER,
        bottom: MEDIUM_BORDER,
        left: c === 1 ? MEDIUM_BORDER : undefined,
        right: c === 8 ? MEDIUM_BORDER : undefined,
      };
    }
    ws.getRow(currentRow).height = 28;
    currentRow += 1;

    // Spacer
    ws.getRow(currentRow).height = 8;
    currentRow += 1;

    // Table headers
    const headerRowNum = currentRow;
    const headerRow = ws.getRow(headerRowNum);
    headerRow.height = 24;
    headers.forEach((header, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = header;
      cell.font = { name: EXCEL_FONT, size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = FILL_HEADER;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: MEDIUM_BORDER,
        bottom: MEDIUM_BORDER,
        left: idx === 0 ? MEDIUM_BORDER : THIN_BORDER,
        right: idx === 7 ? MEDIUM_BORDER : THIN_BORDER,
      };
    });
    ws.pageSetup.printTitlesRow = `1:${headerRowNum}`;
    currentRow += 1;

    // Student data rows
    const textAlign: Partial<ExcelJS.Alignment> = {
      horizontal: isRtl ? 'right' : 'left',
      vertical: 'middle',
      wrapText: true,
    };
    const centerAlign: Partial<ExcelJS.Alignment> = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };

    classList.rows.forEach((item, idx) => {
      const row = ws.getRow(currentRow);
      row.height = 20;
      const values: (string | number)[] = [
        item.index,
        safeSpreadsheetText(item.lastName),
        safeSpreadsheetText(item.firstName),
        item.dateOfBirth,
        safeSpreadsheetText(item.placeOfBirth),
        item.boardingStatus,
        item.repeater,
        item.gender,
      ];
      const isZebra = idx % 2 === 1;
      const isLastRow = idx === classList.rows.length - 1;

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.font = { name: EXCEL_FONT, size: 10, color: { argb: 'FF0F172A' } };
        if (isZebra) cell.fill = FILL_ZEBRA;
        cell.alignment = colIdx === 1 || colIdx === 2 || colIdx === 4 ? textAlign : centerAlign;
        cell.border = {
          top: THIN_BORDER,
          bottom: isLastRow ? MEDIUM_BORDER : THIN_BORDER,
          left: colIdx === 0 ? MEDIUM_BORDER : THIN_BORDER,
          right: colIdx === 7 ? MEDIUM_BORDER : THIN_BORDER,
        };
      });
      currentRow += 1;
    });

    // Summary row
    currentRow += 1;
    ws.mergeCells(currentRow, 1, currentRow, 8);
    const statsCell = ws.getCell(currentRow, 1);
    statsCell.value = buildStatsLine(classList.stats, labels.totals);
    statsCell.font = { name: EXCEL_FONT, size: 10, bold: true, color: { argb: 'FF1E293B' } };
    statsCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let c = 1; c <= 8; c += 1) {
      const cell = ws.getCell(currentRow, c);
      cell.fill = FILL_FOOTER;
      cell.border = {
        top: THIN_BORDER,
        bottom: THIN_BORDER,
        left: c === 1 ? THIN_BORDER : undefined,
        right: c === 8 ? THIN_BORDER : undefined,
      };
    }
    ws.getRow(currentRow).height = 24;
  }

  const raw = await workbook.xlsx.writeBuffer();
  return new Uint8Array(raw);
}

export async function downloadStudentListsExcel(
  lists: ClassStudentList[],
  meta: StudentListExportMeta,
  labels: StudentListExportLabels,
): Promise<void> {
  if (lists.length === 0) return;
  const bytes = await buildStudentListsExcelBuffer(lists, meta, labels);
  const fileName = buildExportFileName(lists, meta.exportDate, labels, 'xlsx');
  await downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), fileName);
}

// ---------------------------------------------------------------------------
// PDF export (jsPDF + 200 DPI native RTL Canvas rendering per A4 page)
// ---------------------------------------------------------------------------

interface PdfPageSlice {
  classList: ClassStudentList;
  rows: StudentListExportRow[];
  isFirstOfClass: boolean;
  isLastOfClass: boolean;
  pageNumber: number;
  totalPages: number;
}

export function paginateClassListsForPdf(lists: ClassStudentList[]): PdfPageSlice[] {
  const rawSlices: Omit<PdfPageSlice, 'pageNumber' | 'totalPages'>[] = [];
  for (const classList of lists) {
    let offset = 0;
    let isFirst = true;
    while (offset < classList.rows.length) {
      const capacity = isFirst ? FIRST_PAGE_ROWS : NEXT_PAGE_ROWS;
      const chunk = classList.rows.slice(offset, offset + capacity);
      offset += chunk.length;
      rawSlices.push({
        classList,
        rows: chunk,
        isFirstOfClass: isFirst,
        isLastOfClass: offset >= classList.rows.length,
      });
      isFirst = false;
    }
  }
  const totalPages = rawSlices.length;
  return rawSlices.map((slice, idx) => ({
    ...slice,
    pageNumber: idx + 1,
    totalPages,
  }));
}

interface PdfColumnDef {
  key: keyof StudentListExportRow;
  widthMm: number;
  align: 'start' | 'center';
  ltrValue?: boolean;
}

const PDF_COLUMNS: PdfColumnDef[] = [
  { key: 'index', widthMm: 11, align: 'center', ltrValue: true },
  { key: 'lastName', widthMm: 33, align: 'start' },
  { key: 'firstName', widthMm: 31, align: 'start' },
  { key: 'dateOfBirth', widthMm: 25, align: 'center', ltrValue: true },
  { key: 'placeOfBirth', widthMm: 34, align: 'start' },
  { key: 'boardingStatus', widthMm: 22, align: 'center' },
  { key: 'repeater', widthMm: 17, align: 'center' },
  { key: 'gender', widthMm: 17, align: 'center' },
];

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxWidth <= 0) return '';
  if (ctx.measureText(trimmed).width <= maxWidth) return trimmed;
  const ellipsis = '…';
  let end = trimmed.length;
  while (end > 1 && ctx.measureText(trimmed.slice(0, end) + ellipsis).width > maxWidth) {
    end -= 1;
  }
  return trimmed.slice(0, end) + ellipsis;
}

function renderPdfPageToDataUrl(
  canvas: HTMLCanvasElement,
  slice: PdfPageSlice,
  meta: StudentListExportMeta,
  labels: StudentListExportLabels,
): string | null {
  const widthPx = Math.round(A4_WIDTH_MM * PX_PER_MM);
  const heightPx = Math.round(A4_HEIGHT_MM * PX_PER_MM);
  if (canvas.width !== widthPx) canvas.width = widthPx;
  if (canvas.height !== heightPx) canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const isRtl = meta.lang.startsWith('ar');
  const mm = (val: number) => val * PX_PER_MM;

  // White A4 background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const marginX = mm(10);
  const contentW = mm(190);
  const rightEdge = widthPx - marginX;
  let y = mm(9);

  // 1. Official Top Header (first page of each class)
  if (slice.isFirstOfClass) {
    if (isRtl) {
      ctx.save();
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 ${mm(3.4)}px ${FONT_FAMILY}`;
      ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', widthPx / 2, y + mm(2.2));
      ctx.font = `700 ${mm(3.1)}px ${FONT_FAMILY}`;
      ctx.fillText('وزارة التربية الوطنية', widthPx / 2, y + mm(6.6));
      ctx.restore();
      y += mm(10);
    }

    // Directorate / Institution (start) & School Year / Date (end)
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#334155';
    ctx.font = `700 ${mm(2.9)}px ${FONT_FAMILY}`;
    const instLine = meta.directorate
      ? `${meta.directorate} — ${meta.institutionName}`
      : `${labels.institutionLabel}: ${meta.institutionName}`;
    const yearLine = `${labels.schoolYearLabel}: ${meta.schoolYear}   |   ${formatExportDate(meta.exportDate)}`;

    if (isRtl) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, instLine, contentW * 0.58), rightEdge, y + mm(2.6));
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, yearLine, contentW * 0.4), marginX, y + mm(2.6));
    } else {
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, instLine, contentW * 0.58), marginX, y + mm(2.6));
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, yearLine, contentW * 0.4), rightEdge, y + mm(2.6));
    }
    ctx.restore();
    y += mm(6.5);
  }

  // 2. Class Title Banner
  const bannerH = mm(9.5);
  ctx.fillStyle = '#e5ecf4';
  ctx.fillRect(marginX, y, contentW, bannerH);
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = Math.max(1, mm(0.35));
  ctx.strokeRect(marginX, y, contentW, bannerH);

  ctx.save();
  ctx.direction = isRtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0f172a';
  ctx.font = `800 ${mm(3.9)}px ${FONT_FAMILY}`;
  const headingBase = labels.listHeading(slice.classList.className);
  const headingText = slice.isFirstOfClass ? headingBase : `${headingBase} ${labels.continuation}`;
  ctx.fillText(fitText(ctx, headingText, contentW - mm(6)), widthPx / 2, y + bannerH / 2);
  ctx.restore();

  y += bannerH + mm(3);

  // 3. Column geometry (RTL places column 0 on the far right; LTR places column 0 on the far left)
  const colPositions: { col: PdfColumnDef; x: number; w: number; header: string }[] = [];
  let cursorX = isRtl ? rightEdge : marginX;
  for (const col of PDF_COLUMNS) {
    const w = mm(col.widthMm);
    const x = isRtl ? cursorX - w : cursorX;
    colPositions.push({
      col,
      x,
      w,
      header: labels.columns[col.key],
    });
    cursorX = isRtl ? x : x + w;
  }

  // 4. Table Header Row
  const tableStartY = y;
  const headerH = mm(8.2);
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(marginX, y, contentW, headerH);

  ctx.save();
  ctx.font = `700 ${mm(2.9)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.direction = isRtl ? 'rtl' : 'ltr';
  for (const pos of colPositions) {
    ctx.fillText(fitText(ctx, pos.header, pos.w - mm(2)), pos.x + pos.w / 2, y + headerH / 2);
  }
  ctx.restore();

  y += headerH;

  // 5. Data Rows
  const rowH = mm(6.4);
  const cellPad = mm(1.8);
  slice.rows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(marginX, y, contentW, rowH);
    }

    ctx.save();
    ctx.font = `600 ${mm(2.75)}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'middle';
    const midY = y + rowH / 2;

    for (const pos of colPositions) {
      const value = String(row[pos.col.key]);
      const maxTextW = pos.w - cellPad * 2;
      if (pos.col.align === 'center') {
        ctx.direction = pos.col.ltrValue ? 'ltr' : isRtl ? 'rtl' : 'ltr';
        ctx.textAlign = 'center';
        ctx.fillText(fitText(ctx, value, maxTextW), pos.x + pos.w / 2, midY);
      } else if (isRtl) {
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        ctx.fillText(fitText(ctx, value, maxTextW), pos.x + pos.w - cellPad, midY);
      } else {
        ctx.direction = 'ltr';
        ctx.textAlign = 'left';
        ctx.fillText(fitText(ctx, value, maxTextW), pos.x + cellPad, midY);
      }
    }
    ctx.restore();

    // Horizontal row border
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(1, mm(0.18));
    ctx.beginPath();
    ctx.moveTo(marginX, y + rowH);
    ctx.lineTo(rightEdge, y + rowH);
    ctx.stroke();

    y += rowH;
  });

  // Vertical column borders & crisp outer table frame
  const tableEndY = y;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = Math.max(1, mm(0.2));
  for (let i = 1; i < colPositions.length; i += 1) {
    const lineX = isRtl ? colPositions[i].x + colPositions[i].w : colPositions[i].x;
    ctx.beginPath();
    ctx.moveTo(lineX, tableStartY);
    ctx.lineTo(lineX, tableEndY);
    ctx.stroke();
  }
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = Math.max(1, mm(0.35));
  ctx.strokeRect(marginX, tableStartY, contentW, tableEndY - tableStartY);

  // 6. Class Summary Box on the last page of each class
  if (slice.isLastOfClass) {
    y += mm(3);
    const summaryH = mm(8.5);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(marginX, y, contentW, summaryH);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1, mm(0.24));
    ctx.strokeRect(marginX, y, contentW, summaryH);

    ctx.save();
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${mm(2.75)}px ${FONT_FAMILY}`;
    ctx.fillText(
      fitText(ctx, buildStatsLine(slice.classList.stats, labels.totals), contentW - mm(4)),
      widthPx / 2,
      y + summaryH / 2,
    );
    ctx.restore();
  }

  // 7. Page Footer
  const footerY = heightPx - mm(6.5);
  ctx.save();
  ctx.font = `600 ${mm(2.4)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#64748b';
  ctx.textBaseline = 'middle';
  const pageLabel = labels.pageOf(slice.pageNumber, slice.totalPages);
  if (isRtl) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, meta.institutionName, contentW * 0.6), rightEdge, footerY);
    ctx.textAlign = 'left';
    ctx.fillText(pageLabel, marginX, footerY);
  } else {
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, meta.institutionName, contentW * 0.6), marginX, footerY);
    ctx.textAlign = 'right';
    ctx.fillText(pageLabel, rightEdge, footerY);
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}

export async function buildStudentListsPdfBlob(
  lists: ClassStudentList[],
  meta: StudentListExportMeta,
  labels: StudentListExportLabels,
): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback font if document.fonts fails
    }
  }

  const slices = paginateClassListsForPdf(lists);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const title =
    lists.length === 1
      ? labels.listHeading(lists[0].className)
      : labels.fileAllPrefix;

  doc.setProperties({
    title,
    subject: 'Class Student Lists',
  });

  const scratchCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

  slices.forEach((slice, idx) => {
    if (idx > 0) doc.addPage('a4', 'portrait');
    if (scratchCanvas) {
      const dataUrl = renderPdfPageToDataUrl(scratchCanvas, slice, meta, labels);
      if (dataUrl) {
        doc.addImage(dataUrl, 'PNG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST');
      }
    }
  });

  return doc.output('blob');
}

export async function downloadStudentListsPdf(
  lists: ClassStudentList[],
  meta: StudentListExportMeta,
  labels: StudentListExportLabels,
): Promise<void> {
  if (lists.length === 0) return;
  const blob = await buildStudentListsPdfBlob(lists, meta, labels);
  const fileName = buildExportFileName(lists, meta.exportDate, labels, 'pdf');
  await downloadBlob(blob, fileName);
}

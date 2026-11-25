import { jsPDF } from 'jspdf';
import {
  BOARDING_LABELS,
  CANTEEN_SUPERVISOR_ROWS,
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
import { paginateDailyReportNotes, type PageNotesSlice } from '@/utils/dailyReportNotes';
import { absenceRate, formatRate } from '@/utils/dailyReportStats';
import { downloadBlob } from '@/utils/download';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PX_PER_MM = 8; // ~203 DPI for crisp Arabic RTL tables & borders
const FONT_FAMILY = 'Cairo, Arial, sans-serif';

const mm = (value: number): number => value * PX_PER_MM;
const pt = (value: number): number => (value * 25.4 / 72) * PX_PER_MM;

interface Rect {
  x: number;
  w: number;
}

function padTwo(num: number): string {
  return String(num).padStart(2, '0');
}

function rtlRects(leftX: number, totalW: number, weights: number[]): Rect[] {
  const sum = weights.reduce((acc, w) => acc + w, 0) || 1;
  let cursor = leftX + totalW;
  return weights.map((weight, index) => {
    const w = index === weights.length - 1 ? cursor - leftX : (weight / sum) * totalW;
    const x = cursor - w;
    cursor = x;
    return { x, w };
  });
}

function makeDotsPattern(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (typeof document === 'undefined') return '#e5e7eb';
  const tile = document.createElement('canvas');
  tile.width = 6;
  tile.height = 6;
  const tctx = tile.getContext('2d');
  if (!tctx) return '#e5e7eb';
  tctx.fillStyle = '#e5e7eb';
  tctx.fillRect(0, 0, 6, 6);
  tctx.fillStyle = '#525252';
  tctx.beginPath();
  tctx.arc(3, 3, 0.9, 0, Math.PI * 2);
  tctx.fill();
  return ctx.createPattern(tile, 'repeat') ?? '#e5e7eb';
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else if (current) {
        lines.push(current);
        current = word;
      } else {
        // Word longer than cell width: chunk by character
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
            chunk += ch;
          } else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

interface DrawCellOptions {
  align?: 'center' | 'right' | 'left';
  valign?: 'middle' | 'top';
  bold?: boolean;
  fontSizePt?: number;
  fill?: string | CanvasPattern;
  borderTop?: number;
  borderBottom?: number;
  borderLeft?: number;
  borderRight?: number;
  padXMm?: number;
  padYMm?: number;
  lineHeight?: number;
  color?: string;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: DrawCellOptions = {},
): void {
  const {
    align = 'center',
    valign = 'middle',
    bold = false,
    fontSizePt = 7.5,
    fill,
    borderTop = 1,
    borderBottom = 1,
    borderLeft = 1,
    borderRight = 1,
    padXMm = 1,
    padYMm = 0.6,
    lineHeight = 1.25,
    color = '#000000',
  } = opts;

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  ctx.strokeStyle = '#000000';
  if (borderTop > 0) {
    ctx.lineWidth = borderTop;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }
  if (borderBottom > 0) {
    ctx.lineWidth = borderBottom;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();
  }
  if (borderLeft > 0) {
    ctx.lineWidth = borderLeft;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
  }
  if (borderRight > 0) {
    ctx.lineWidth = borderRight;
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();
  }

  const trimmed = text.trim();
  if (!trimmed) return;

  const fontSizePx = pt(fontSizePt);
  const padX = mm(padXMm);
  const padY = mm(padYMm);
  const maxTextW = Math.max(4, w - padX * 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
  ctx.clip();

  ctx.direction = 'rtl';
  ctx.fillStyle = color;
  ctx.font = `${bold ? 700 : 400} ${fontSizePx}px ${FONT_FAMILY}`;
  const lines = wrapTextLines(ctx, trimmed, maxTextW);
  const stepY = fontSizePx * lineHeight;
  const maxVisibleLines = Math.max(1, Math.floor((h - padY * 2) / stepY) + (valign === 'middle' ? 1 : 0));
  const visible = lines.slice(0, Math.max(1, maxVisibleLines));

  let startY: number;
  if (valign === 'top') {
    startY = y + padY + fontSizePx * 0.5;
  } else {
    const totalH = visible.length * stepY;
    startY = y + h / 2 - totalH / 2 + stepY / 2;
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const textX = align === 'center' ? x + w / 2 : align === 'right' ? x + w - padX : x + padX;

  visible.forEach((line, idx) => {
    if (line) {
      ctx.fillText(line, textX, startY + idx * stepY);
    }
  });
  ctx.restore();
}

function drawOuterRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, widthPx = 2.4): void {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = widthPx;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawRtlLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { align?: 'right' | 'left' | 'center'; bold?: boolean; sizePt?: number; color?: string } = {},
): void {
  const { align = 'right', bold = true, sizePt = 8.5, color = '#000000' } = opts;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.fillStyle = color;
  ctx.font = `${bold ? 700 : 400} ${pt(sizePt)}px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function computeTextHeightMm(
  ctx: CanvasRenderingContext2D,
  text: string,
  widthMm: number,
  fontSizePt: number,
  lineHeight: number,
  padYMm: number,
  minMm: number,
): number {
  if (!text.trim()) return minMm;
  ctx.save();
  ctx.font = `400 ${pt(fontSizePt)}px ${FONT_FAMILY}`;
  const lines = wrapTextLines(ctx, text, Math.max(8, mm(widthMm - 4)));
  ctx.restore();
  const hPx = lines.length * pt(fontSizePt) * lineHeight + mm(padYMm * 2);
  return Math.max(minMm, hPx / PX_PER_MM);
}

function renderPage1Canvas(canvas: HTMLCanvasElement, render: DailyReportRender, notes: PageNotesSlice): void {
  canvas.width = mm(A4_WIDTH_MM);
  canvas.height = mm(A4_HEIGHT_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const dotsFill = makeDotsPattern(ctx);
  const leftX = mm(8);
  const contentW = mm(194);
  const rightX = leftX + contentW;
  let y = mm(6);

  // 1. Top Header
  const headLineStep = mm(4.2);
  drawRtlLine(ctx, `مديرية التربية لولاية : ${render.header.wilaya}`, rightX, y, { align: 'right', sizePt: 9 });
  drawRtlLine(ctx, `السنة الدراسية : ${render.header.schoolYear}`, leftX, y, { align: 'left', sizePt: 9 });
  drawRtlLine(ctx, `المؤسسة : ${render.header.institution}`, rightX, y + headLineStep, { align: 'right', sizePt: 9 });
  drawRtlLine(ctx, `الرقم: ${render.header.reportNumber}`, rightX, y + headLineStep * 2, { align: 'right', sizePt: 9 });
  y += mm(13);

  // Title box centered
  const boxW = mm(68);
  const boxH = mm(12);
  const boxX = leftX + (contentW - boxW) / 2;
  ctx.fillStyle = '#999999';
  ctx.fillRect(boxX + 3, y + 3, boxW, boxH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(boxX, y, boxW, boxH);
  drawOuterRect(ctx, boxX, y, boxW, boxH, 2.2);
  drawCell(ctx, 'التقرير اليومي للناظر', boxX, y + mm(0.8), boxW, mm(5.8), {
    fontSizePt: 10.5,
    bold: true,
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    borderRight: 0,
  });
  drawCell(ctx, `ليوم: ${formatDate(render.header.reportDate)}`, boxX + mm(3), y + mm(6.2), boxW - mm(6), mm(5), {
    fontSizePt: 9.5,
    bold: true,
    align: 'right',
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    borderRight: 0,
  });
  y += boxH + mm(2.5);

  // 2. Teachers Absences
  drawRtlLine(ctx, '1- مواضبة الأساتذة:', rightX, y, { align: 'right', sizePt: 8.5 });
  y += mm(3.8);
  drawRtlLine(ctx, '1-1- دروس لم تقدم:', rightX, y, { align: 'right', sizePt: 8 });
  y += mm(3.8);

  const teacherWeights = [
    6,
    21,
    11,
    ...Array.from({ length: TEACHER_PERIOD_COLUMNS }, () => 5.5),
    18,
  ];
  const tCols = rtlRects(leftX, contentW, teacherWeights);
  const tTableStart = y;
  const tRowH = mm(4.5);

  // Header
  const tHeaders = ['الرقم', 'اللقب و الاسم', 'المادة', ...Array.from({ length: TEACHER_PERIOD_COLUMNS }, (_, i) => String(i + 1)), 'ملاحظات'];
  tCols.forEach((rect, i) => {
    drawCell(ctx, tHeaders[i], rect.x, y, rect.w, tRowH, { bold: true, fontSizePt: 7.5 });
  });
  y += tRowH;

  const teacherRows = Math.max(TEACHER_MIN_ROWS, render.computed.teacherLines.length);
  for (let rowIdx = 0; rowIdx < teacherRows; rowIdx += 1) {
    const line = render.computed.teacherLines[rowIdx];
    const note = line
      ? [line.reason ? REASON_LABELS[line.reason] : '', line.reasonNote, line.note].filter(Boolean).join(' - ')
      : '';
    const noteH = note
      ? mm(computeTextHeightMm(ctx, note, (18 / 100) * 194, 7.2, 1.2, 0.5, 4.5))
      : tRowH;
    const rowH = Math.max(tRowH, noteH);

    drawCell(ctx, padTwo(rowIdx + 1), tCols[0].x, y, tCols[0].w, rowH, { bold: true, fontSizePt: 7.5 });
    drawCell(ctx, line?.name ?? '', tCols[1].x, y, tCols[1].w, rowH, { align: 'right', fontSizePt: 7.5 });
    drawCell(ctx, line?.subjects ?? '', tCols[2].x, y, tCols[2].w, rowH, { align: 'right', fontSizePt: 7.5 });
    for (let p = 1; p <= TEACHER_PERIOD_COLUMNS; p += 1) {
      drawCell(ctx, line?.classByPeriod[p] ?? '', tCols[2 + p].x, y, tCols[2 + p].w, rowH, { fontSizePt: 7.2 });
    }
    drawCell(ctx, note, tCols[3 + TEACHER_PERIOD_COLUMNS].x, y, tCols[3 + TEACHER_PERIOD_COLUMNS].w, rowH, {
      align: 'right',
      fontSizePt: 7.2,
    });
    y += rowH;
  }
  drawOuterRect(ctx, leftX, tTableStart, contentW, y - tTableStart, 2.4);
  y += mm(1.8);

  // 3. Observations Box
  drawCell(ctx, '2-1- ملاحظات و إجراءات:', leftX, y, contentW, mm(3.6), {
    bold: true,
    fontSizePt: 8,
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    borderRight: 0,
  });
  y += mm(3.8);
  const obsH = mm(computeTextHeightMm(ctx, render.observations, 194, 8, 1.35, 1.5, 11));
  drawCell(ctx, render.observations, leftX, y, contentW, obsH, {
    align: 'right',
    valign: 'top',
    fontSizePt: 8,
    padXMm: 2.5,
    padYMm: 1.5,
    lineHeight: 1.35,
  });
  drawOuterRect(ctx, leftX, y, contentW, obsH, 2.4);
  y += obsH + mm(1.8);

  // 4. Canteen Section
  drawRtlLine(ctx, '2- مراقبة المطعم:', rightX, y, { align: 'right', sizePt: 8.5 });
  y += mm(3.8);
  const cCols = rtlRects(leftX, contentW, [18, 6, 26, 22, 28]);
  const cRowH = mm(4.7);
  const cStart = y;
  const { canteen } = render.computed;
  const sups = resolveCanteenSupervisors(render);

  // Row 0
  drawCell(ctx, 'تعداد التلاميذ', cCols[0].x, y, cCols[0].w, cRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, String(canteen.halfBoarders), cCols[1].x, y, cCols[1].w, cRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'الوجبة الغذائية المقررة', cCols[2].x, y, cCols[2].w, cRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'الوجبة الغذائية المقدمة', cCols[3].x, y, cCols[3].w, cRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'ملاحظات', cCols[4].x, y, cCols[4].w, cRowH, { bold: true, fontSizePt: 7.5 });
  y += cRowH;

  // Rows 1..6 (right 2 columns individual, left 3 columns rowspan=6)
  const rightRows: [string, string, boolean][] = [
    ['التلاميذ الغائبون', String(canteen.absent), true],
    ['التلاميذ الحاضرون', String(canteen.present), true],
    ['المراقبون المكلفون', '', true],
    ...Array.from({ length: CANTEEN_SUPERVISOR_ROWS }, (_, i): [string, string, boolean] => [sups[i] ?? '', '', false]),
  ];
  const spanH = cRowH * rightRows.length;
  drawCell(ctx, render.plannedMeal, cCols[2].x, y, cCols[2].w, spanH, { fontSizePt: 8, padXMm: 1.5, padYMm: 1.5 });
  drawCell(ctx, render.mealServed, cCols[3].x, y, cCols[3].w, spanH, { fontSizePt: 8, padXMm: 1.5, padYMm: 1.5 });
  drawCell(ctx, render.canteenNote, cCols[4].x, y, cCols[4].w, spanH, { fontSizePt: 8, padXMm: 1.5, padYMm: 1.5 });

  rightRows.forEach(([label, val, isBold]) => {
    drawCell(ctx, label, cCols[0].x, y, cCols[0].w, cRowH, { bold: isBold, fontSizePt: 7.5 });
    drawCell(ctx, val, cCols[1].x, y, cCols[1].w, cRowH, { bold: isBold, fontSizePt: 7.5 });
    y += cRowH;
  });
  drawOuterRect(ctx, leftX, cStart, contentW, y - cStart, 2.4);
  y += mm(1.8);

  // 5. Levels Section
  drawRtlLine(ctx, '3- مراقبة التلاميذ', rightX, y, { align: 'right', sizePt: 8.5 });
  y += mm(3.8);
  if (render.entrySummary) {
    drawRtlLine(
      ctx,
      `عدد الداخلين اليوم: ${render.entrySummary.entered} من ${render.entrySummary.enrolled}`,
      rightX,
      y,
      { align: 'right', sizePt: 8 },
    );
    y += mm(3.6);
  }
  drawRtlLine(ctx, '1-3- الغيابات:', rightX, y, { align: 'right', sizePt: 8 });
  y += mm(3.6);

  const classCols = levelColumnCount(render);
  const classColWeight = 64 / classCols;
  const levelWeights = [13, ...Array.from({ length: classCols }, () => classColWeight), 7, 7, 9];
  const lCols = rtlRects(leftX, contentW, levelWeights);
  const lRowH = mm(4.5);

  // Top empty row + المجموع box
  const groupX = lCols[classCols + 2].x;
  const groupW = lCols[classCols + 1].w + lCols[classCols + 2].w;
  drawCell(ctx, 'المجموع', groupX, y, groupW, lRowH, { bold: true, fontSizePt: 7.5, fill: '#ffffff' });
  drawOuterRect(ctx, groupX, y, groupW, lRowH, 2.4);
  y += lRowH;

  const lBodyStart = y;
  // Shaded header
  drawCell(ctx, 'المستوى', lCols[0].x, y, lCols[0].w, lRowH, { bold: true, fontSizePt: 7.5, fill: '#e5e7eb' });
  const classesSpanX = lCols[classCols].x;
  const classesSpanW = lCols[1].x + lCols[1].w - classesSpanX;
  drawCell(ctx, 'الأفواج', classesSpanX, y, classesSpanW, lRowH, { bold: true, fontSizePt: 7.5, fill: '#e5e7eb' });
  drawCell(ctx, 'تلاميذ', lCols[classCols + 1].x, y, lCols[classCols + 1].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
    fill: '#e5e7eb',
    borderRight: 2.2,
  });
  drawCell(ctx, 'الغائبون', lCols[classCols + 2].x, y, lCols[classCols + 2].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
    fill: '#e5e7eb',
    borderLeft: 2.2,
  });
  drawCell(ctx, 'نسبة الغياب', lCols[classCols + 3].x, y, lCols[classCols + 3].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
    fill: '#e5e7eb',
  });
  y += lRowH;

  const { levels } = render.computed;
  const colSums = Array.from({ length: classCols }, (_, cIdx) =>
    levels.reduce((sum, lvl) => sum + (lvl.classes[cIdx]?.absent ?? 0), 0),
  );
  levels.forEach((level) => {
    const doubleH = lRowH * 2;
    drawCell(ctx, `الأقسام السنة ${level.level}`, lCols[0].x, y, lCols[0].w, lRowH, { align: 'right', bold: true, fontSizePt: 7.5 });
    drawCell(ctx, 'عدد الغائبين', lCols[0].x, y + lRowH, lCols[0].w, lRowH, { align: 'right', fontSizePt: 7.5 });

    for (let c = 0; c < classCols; c += 1) {
      const cls = level.classes[c];
      drawCell(ctx, cls ? cls.className : '/', lCols[1 + c].x, y, lCols[1 + c].w, lRowH, { bold: true, fontSizePt: 7.5 });
      drawCell(ctx, cls ? String(cls.absent) : '', lCols[1 + c].x, y + lRowH, lCols[1 + c].w, lRowH, { fontSizePt: 7.5 });
    }
    drawCell(ctx, String(level.enrolled), lCols[classCols + 1].x, y, lCols[classCols + 1].w, doubleH, {
      bold: true,
      fontSizePt: 7.5,
      borderRight: 2.2,
    });
    drawCell(ctx, String(level.absent), lCols[classCols + 2].x, y, lCols[classCols + 2].w, doubleH, {
      bold: true,
      fontSizePt: 7.5,
      borderLeft: 2.2,
    });
    drawCell(ctx, formatRate(level.rate), lCols[classCols + 3].x, y, lCols[classCols + 3].w, doubleH, {
      bold: true,
      fontSizePt: 7.5,
    });
    y += doubleH;
  });

  const totalEnrolled = levels.reduce((sum, l) => sum + l.enrolled, 0);
  const totalAbsent = levels.reduce((sum, l) => sum + l.absent, 0);
  drawCell(ctx, 'مجموع', lCols[0].x, y, lCols[0].w, lRowH, { bold: true, fontSizePt: 7.5 });
  colSums.forEach((val, c) => {
    drawCell(ctx, String(val), lCols[1 + c].x, y, lCols[1 + c].w, lRowH, { bold: true, fontSizePt: 7.5 });
  });
  drawCell(ctx, String(totalEnrolled), lCols[classCols + 1].x, y, lCols[classCols + 1].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
    borderRight: 2.2,
  });
  drawCell(ctx, String(totalAbsent), lCols[classCols + 2].x, y, lCols[classCols + 2].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
    borderLeft: 2.2,
  });
  drawCell(ctx, formatRate(absenceRate(totalAbsent, totalEnrolled)), lCols[classCols + 3].x, y, lCols[classCols + 3].w, lRowH, {
    bold: true,
    fontSizePt: 7.5,
  });
  y += lRowH;
  drawOuterRect(ctx, leftX, lBodyStart, contentW, y - lBodyStart, 2.4);
  y += mm(1.8);

  // 6. Bottom Split (Supervisors right + Summary left)
  const gapW = mm(2);
  const splitRightW = ((contentW - gapW) * 1.15) / 2.1;
  const splitLeftW = contentW - gapW - splitRightW;
  const splitRightX = rightX - splitRightW;
  const splitLeftX = leftX;

  drawRtlLine(ctx, '2-3- غيابات وتأخرات المساعدين التربويين:', rightX, y, { align: 'right', sizePt: 8 });
  drawCell(ctx, 'الخلاصة', splitLeftX, y, splitLeftW, mm(3.8), {
    bold: true,
    fontSizePt: 8.5,
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    borderRight: 0,
  });
  y += mm(4.0);

  const supCount = Math.max(SUPERVISOR_MIN_ROWS, render.supervisorRows.length);
  const splitRowCount = Math.max(supCount + 1, 5);
  const sRowH = mm(4.5);
  const supActualRowH = (splitRowCount * sRowH - sRowH) / supCount;
  const sumActualRowH = (splitRowCount * sRowH - sRowH * 2) / 3;
  const splitStartY = y;

  // Supervisors Table (right)
  const supCols = rtlRects(splitRightX, splitRightW, [36, 12, 12, 40]);
  drawCell(ctx, 'اللقب و الاسم', supCols[0].x, y, supCols[0].w, sRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'صباحا', supCols[1].x, y, supCols[1].w, sRowH, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  drawCell(ctx, 'مساءا', supCols[2].x, y, supCols[2].w, sRowH, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  drawCell(ctx, 'الملاحظات', supCols[3].x, y, supCols[3].w, sRowH, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  for (let i = 0; i < supCount; i += 1) {
    const row = render.supervisorRows[i];
    const ry = y + sRowH + i * supActualRowH;
    drawCell(ctx, row?.name ?? '', supCols[0].x, ry, supCols[0].w, supActualRowH, { align: 'right', fontSizePt: 7.5 });
    drawCell(ctx, row ? SUPERVISOR_LABELS[row.morning] : '', supCols[1].x, ry, supCols[1].w, supActualRowH, { fontSizePt: 7.5 });
    drawCell(ctx, row ? SUPERVISOR_LABELS[row.evening] : '', supCols[2].x, ry, supCols[2].w, supActualRowH, { fontSizePt: 7.5 });
    drawCell(ctx, row?.notes ?? '', supCols[3].x, ry, supCols[3].w, supActualRowH, { align: 'right', fontSizePt: 7.5 });
  }
  drawOuterRect(ctx, splitRightX, splitStartY, splitRightW, splitRowCount * sRowH, 2.4);

  // Summary Table (left)
  const sumCols = rtlRects(splitLeftX, splitLeftW, [24, 14, 14, 16, 16, 16]);
  const studentsHeadX = sumCols[3].x;
  const studentsHeadW = sumCols[1].w + sumCols[2].w + sumCols[3].w;
  drawCell(ctx, '', sumCols[0].x, y, sumCols[0].w, sRowH * 2, { borderTop: 0, borderRight: 0 });
  drawCell(ctx, 'التلاميذ', studentsHeadX, y, studentsHeadW, sRowH, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  drawCell(ctx, 'الأساتذة', sumCols[4].x, y, sumCols[4].w, sRowH * 2, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  drawCell(ctx, 'المساعدون', sumCols[5].x, y, sumCols[5].w, sRowH * 2, { bold: true, fontSizePt: 7.5, fill: dotsFill });
  drawCell(ctx, 'ذكور', sumCols[1].x, y + sRowH, sumCols[1].w, sRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'إناث', sumCols[2].x, y + sRowH, sumCols[2].w, sRowH, { bold: true, fontSizePt: 7.5 });
  drawCell(ctx, 'مجموع', sumCols[3].x, y + sRowH, sumCols[3].w, sRowH, { bold: true, fontSizePt: 7.5 });

  const { students, teachers, supervisors } = render.computed.summary;
  const sumLines: [string, (c: { total: number; absent: number; present: number }) => number][] = [
    ['المجموع', (c) => c.total],
    ['الغائبون', (c) => c.absent],
    ['الحاضرون', (c) => c.present],
  ];
  sumLines.forEach(([label, pick], idx) => {
    const ry = y + sRowH * 2 + idx * sumActualRowH;
    drawCell(ctx, label, sumCols[0].x, ry, sumCols[0].w, sumActualRowH, { bold: true, fontSizePt: 7.5 });
    drawCell(ctx, String(pick(students.male)), sumCols[1].x, ry, sumCols[1].w, sumActualRowH, { fontSizePt: 7.5 });
    drawCell(ctx, String(pick(students.female)), sumCols[2].x, ry, sumCols[2].w, sumActualRowH, { fontSizePt: 7.5 });
    drawCell(ctx, String(pick(students.all)), sumCols[3].x, ry, sumCols[3].w, sumActualRowH, { bold: true, fontSizePt: 7.5 });
    drawCell(ctx, String(pick(teachers)), sumCols[4].x, ry, sumCols[4].w, sumActualRowH, { fontSizePt: 7.5 });
    drawCell(ctx, String(pick(supervisors)), sumCols[5].x, ry, sumCols[5].w, sumActualRowH, { fontSizePt: 7.5 });
  });
  drawOuterRect(ctx, splitLeftX, splitStartY, splitLeftW, splitRowCount * sRowH, 2.4);

  y += splitRowCount * sRowH + mm(1.8);

  // 7. Page 1 Notes & Signatures
  const nCols = rtlRects(leftX, contentW, [22, 58, 20]);
  const nStart = y;
  const cNoteH = mm(computeTextHeightMm(ctx, notes.counselor, (58 / 100) * 194, 8, 1.4, 1.5, 20));
  const dNoteH = mm(computeTextHeightMm(ctx, notes.director, (58 / 100) * 194, 8, 1.4, 1.5, 10));

  drawCell(
    ctx,
    'ملاحظات حول النظافة\nالصيانة والإتلاف - الحوادث\n- النشاط الثقافي والرياضي -\nدروس الدعم - الزيارات',
    nCols[0].x,
    y,
    nCols[0].w,
    cNoteH,
    { bold: true, fontSizePt: 8, lineHeight: 1.35, borderTop: 1.8, borderBottom: 1.8, borderLeft: 1.8, borderRight: 1.8 },
  );
  drawCell(ctx, notes.counselor, nCols[1].x, y, nCols[1].w, cNoteH, {
    align: 'right',
    valign: 'top',
    fontSizePt: 8,
    padXMm: 2,
    padYMm: 1.5,
    lineHeight: 1.4,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, 'امضاء الناظر', nCols[2].x, y, nCols[2].w, cNoteH, {
    bold: true,
    fontSizePt: 8,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  y += cNoteH;

  drawCell(ctx, 'ملاحظات مدير المؤسسة', nCols[0].x, y, nCols[0].w, dNoteH, {
    bold: true,
    fontSizePt: 8,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, notes.director, nCols[1].x, y, nCols[1].w, dNoteH, {
    align: 'right',
    valign: 'top',
    fontSizePt: 8,
    padXMm: 2,
    padYMm: 1.5,
    lineHeight: 1.4,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, 'امضاء المدير', nCols[2].x, y, nCols[2].w, dNoteH, {
    bold: true,
    fontSizePt: 8,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  y += dNoteH;
  drawOuterRect(ctx, leftX, nStart, contentW, y - nStart, 2.4);
}

function drawWholeDayGrid(
  ctx: CanvasRenderingContext2D,
  render: DailyReportRender,
  startIdx: number,
  leftX: number,
  topY: number,
  contentW: number,
): number {
  const dotsFill = makeDotsPattern(ctx);
  const wCols = rtlRects(leftX, contentW, [5, 17, 7, 9, 12, 5, 17, 7, 9, 12]);
  const rH = mm(3.9);
  let y = topY;

  const headers = [
    'الرقم',
    'اللقب و الاسم',
    'القسم',
    'الصفة',
    'تاريخ الغياب',
    'الرقم',
    'اللقب و الاسم',
    'القسم',
    'الصفة',
    'تاريخ الغياب',
  ];
  headers.forEach((h, i) => {
    const isNum = i === 0 || i === 5;
    drawCell(ctx, h, wCols[i].x, y, wCols[i].w, rH, {
      bold: true,
      fontSizePt: 7.2,
      fill: dotsFill,
      borderLeft: isNum ? 1.8 : 1,
      borderRight: i === 5 ? 2.4 : 1,
    });
  });
  y += rH;

  for (let row = 0; row < WHOLE_TABLE_ROWS; row += 1) {
    const rightIdx = startIdx + row;
    const leftIdx = startIdx + WHOLE_TABLE_ROWS + row;
    const rightItem = render.wholeDayAbsences[rightIdx];
    const leftItem = render.wholeDayAbsences[leftIdx];

    drawCell(ctx, String(rightIdx + 1), wCols[0].x, y, wCols[0].w, rH, { bold: true, fontSizePt: 7.2, borderLeft: 1.8 });
    drawCell(ctx, rightItem?.name ?? '', wCols[1].x, y, wCols[1].w, rH, { align: 'right', fontSizePt: 7.2 });
    drawCell(ctx, rightItem?.className ?? '', wCols[2].x, y, wCols[2].w, rH, { fontSizePt: 7.2 });
    drawCell(ctx, rightItem ? BOARDING_LABELS[rightItem.boarding] : '', wCols[3].x, y, wCols[3].w, rH, { fontSizePt: 7.2 });
    drawCell(ctx, rightItem ? formatDate(rightItem.since) : '', wCols[4].x, y, wCols[4].w, rH, { fontSizePt: 7.2 });

    drawCell(ctx, String(leftIdx + 1), wCols[5].x, y, wCols[5].w, rH, {
      bold: true,
      fontSizePt: 7.2,
      borderLeft: 1.8,
      borderRight: 2.4,
    });
    drawCell(ctx, leftItem?.name ?? '', wCols[6].x, y, wCols[6].w, rH, { align: 'right', fontSizePt: 7.2 });
    drawCell(ctx, leftItem?.className ?? '', wCols[7].x, y, wCols[7].w, rH, { fontSizePt: 7.2 });
    drawCell(ctx, leftItem ? BOARDING_LABELS[leftItem.boarding] : '', wCols[8].x, y, wCols[8].w, rH, { fontSizePt: 7.2 });
    drawCell(ctx, leftItem ? formatDate(leftItem.since) : '', wCols[9].x, y, wCols[9].w, rH, { fontSizePt: 7.2 });
    y += rH;
  }

  drawOuterRect(ctx, leftX, topY, contentW, y - topY, 2.4);
  return y;
}

function renderPage2PrimaryCanvas(canvas: HTMLCanvasElement, render: DailyReportRender, notes: PageNotesSlice): void {
  canvas.width = mm(A4_WIDTH_MM);
  canvas.height = mm(A4_HEIGHT_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const dotsFill = makeDotsPattern(ctx);
  const leftX = mm(7);
  const contentW = mm(196);
  const rightX = leftX + contentW;
  let y = mm(5);

  // 1. Whole-day table
  drawRtlLine(
    ctx,
    'التلاميذ الغائبون إلى نهاية اليوم : (يسجل التلاميذ المتغيبين لمدة يوم أو أكثر فقط)',
    rightX,
    y,
    { align: 'right', sizePt: 8.5 },
  );
  y += mm(4.2);
  y = drawWholeDayGrid(ctx, render, 0, leftX, y, contentW);
  y += mm(1.8);

  // 2. Parents Table
  drawRtlLine(ctx, 'مراسلات الأولياء', rightX, y, { align: 'right', sizePt: 8.5 });
  y += mm(4.2);

  const pCols = rtlRects(leftX, contentW, [5, 17, 7, 7, 12, 11, 10, 10, 9, 12]);
  const pRowH = mm(3.9);
  const pStart = y;
  const pHeaders = ['الرقم', 'اللقب و الاسم', 'القسم', 'ساعات', 'تاريخ الغياب', 'الأسباب', 'اشعار اول', 'اشعار ثاني', 'اعذار', 'تاريخ الشطب'];
  pHeaders.forEach((h, i) => {
    drawCell(ctx, h, pCols[i].x, y, pCols[i].w, pRowH, {
      bold: true,
      fontSizePt: 7.2,
      fill: dotsFill,
      borderLeft: i === 0 ? 1.8 : 1,
    });
  });
  y += pRowH;

  const pTotal = Math.max(PARENT_MIN_ROWS, render.parentRows.length);
  for (let i = 0; i < pTotal; i += 1) {
    const row = render.parentRows[i];
    drawCell(ctx, String(i + 1), pCols[0].x, y, pCols[0].w, pRowH, { bold: true, fontSizePt: 7.2, borderLeft: 1.8 });
    drawCell(ctx, row?.name ?? '', pCols[1].x, y, pCols[1].w, pRowH, { align: 'right', fontSizePt: 7.2 });
    drawCell(ctx, row?.className ?? '', pCols[2].x, y, pCols[2].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row?.hours ?? '', pCols[3].x, y, pCols[3].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row ? formatDate(row.absenceDate) : '', pCols[4].x, y, pCols[4].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row?.reason ?? '', pCols[5].x, y, pCols[5].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row?.firstNotice ?? '', pCols[6].x, y, pCols[6].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row?.secondNotice ?? '', pCols[7].x, y, pCols[7].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row?.excuse ?? '', pCols[8].x, y, pCols[8].w, pRowH, { fontSizePt: 7.2 });
    drawCell(ctx, row ? formatDate(row.struckDate) : '', pCols[9].x, y, pCols[9].w, pRowH, { fontSizePt: 7.2 });
    y += pRowH;
  }
  drawOuterRect(ctx, leftX, pStart, contentW, y - pStart, 2.4);

  // 3. Page 2 Notes & Signatures (enlarged 50mm counselor + 24mm director, flush below parents table)
  const nCols = rtlRects(leftX, contentW, [22, 58, 20]);
  const nStart = y;
  const cNoteH = mm(computeTextHeightMm(ctx, notes.counselor, (58 / 100) * 196, 8, 1.4, 1.5, 50));
  const dNoteH = mm(computeTextHeightMm(ctx, notes.director, (58 / 100) * 196, 8, 1.4, 1.5, 24));

  drawCell(
    ctx,
    'ملاحظات و اقتراحات\nمستشار التربية حول النظافة -\nالصيانة والإتلاف - الحوادث\n- النشاط الثقافي والرياضي -\nدروس الدعم - الزيارات',
    nCols[0].x,
    y,
    nCols[0].w,
    cNoteH,
    {
      bold: true,
      fontSizePt: 8,
      lineHeight: 1.4,
      fill: '#f3f4f6',
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    },
  );
  drawCell(ctx, notes.counselor, nCols[1].x, y, nCols[1].w, cNoteH, {
    align: 'right',
    valign: 'top',
    fontSizePt: 8,
    padXMm: 2,
    padYMm: 1.5,
    lineHeight: 1.4,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, 'الامضاء', nCols[2].x, y, nCols[2].w, cNoteH, {
    bold: true,
    fontSizePt: 8,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  y += cNoteH;

  drawCell(ctx, 'ملاحظات مدير المؤسسة', nCols[0].x, y, nCols[0].w, dNoteH, {
    bold: true,
    fontSizePt: 8,
    fill: '#f3f4f6',
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, notes.director, nCols[1].x, y, nCols[1].w, dNoteH, {
    align: 'right',
    valign: 'top',
    fontSizePt: 8,
    padXMm: 2,
    padYMm: 1.5,
    lineHeight: 1.4,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  drawCell(ctx, 'الامضاء', nCols[2].x, y, nCols[2].w, dNoteH, {
    bold: true,
    fontSizePt: 8,
    borderTop: 1.8,
    borderBottom: 1.8,
    borderLeft: 1.8,
    borderRight: 1.8,
  });
  y += dNoteH;
  drawOuterRect(ctx, leftX, nStart, contentW, y - nStart, 2.4);

  // 4. Footer
  y += mm(2.5);
  drawRtlLine(ctx, footerText(render.header.city, render.header.reportDate), leftX + mm(16), y, {
    align: 'left',
    sizePt: 9,
  });
}

function renderContinuationNotesCanvas(
  canvas: HTMLCanvasElement,
  render: DailyReportRender,
  notes: PageNotesSlice,
  extraIndex: number,
  extraTotal: number,
): void {
  canvas.width = mm(A4_WIDTH_MM);
  canvas.height = mm(A4_HEIGHT_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const leftX = mm(7);
  const contentW = mm(196);
  const rightX = leftX + contentW;
  let y = mm(5);

  drawRtlLine(ctx, `المؤسسة : ${render.header.institution}`, rightX, y, { align: 'right', sizePt: 9 });
  drawRtlLine(ctx, `ليوم: ${formatDate(render.header.reportDate)}`, leftX, y, { align: 'left', sizePt: 9 });
  drawRtlLine(ctx, `التقرير اليومي للناظر — الرقم: ${render.header.reportNumber}`, rightX, y + mm(4.2), {
    align: 'right',
    sizePt: 9,
  });
  y += mm(11);

  const suffix = extraTotal > 1 ? ` (${extraIndex + 1}/${extraTotal})` : '';
  drawRtlLine(ctx, `تابع التقرير اليومي — تتمة ملاحظات الصفحة الثانية${suffix}`, rightX, y, {
    align: 'right',
    sizePt: 8.5,
  });
  y += mm(4.5);

  const nCols = rtlRects(leftX, contentW, [20, 60, 20]);
  const nStart = y;
  if (notes.counselor) {
    const h = mm(computeTextHeightMm(ctx, notes.counselor, (60 / 100) * 196, 8, 1.4, 1.5, 36));
    drawCell(ctx, 'ملاحظات و اقتراحات\nمستشار التربية\n(تابع)', nCols[0].x, y, nCols[0].w, h, {
      bold: true,
      fontSizePt: 8,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    drawCell(ctx, notes.counselor, nCols[1].x, y, nCols[1].w, h, {
      align: 'right',
      valign: 'top',
      fontSizePt: 8,
      padXMm: 2,
      padYMm: 1.5,
      lineHeight: 1.4,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    drawCell(ctx, 'الامضاء', nCols[2].x, y, nCols[2].w, h, {
      bold: true,
      fontSizePt: 8,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    y += h;
  }
  if (notes.director) {
    const h = mm(computeTextHeightMm(ctx, notes.director, (60 / 100) * 196, 8, 1.4, 1.5, 36));
    drawCell(ctx, 'ملاحظات مدير المؤسسة\n(تابع)', nCols[0].x, y, nCols[0].w, h, {
      bold: true,
      fontSizePt: 8,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    drawCell(ctx, notes.director, nCols[1].x, y, nCols[1].w, h, {
      align: 'right',
      valign: 'top',
      fontSizePt: 8,
      padXMm: 2,
      padYMm: 1.5,
      lineHeight: 1.4,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    drawCell(ctx, 'الامضاء', nCols[2].x, y, nCols[2].w, h, {
      bold: true,
      fontSizePt: 8,
      borderTop: 1.8,
      borderBottom: 1.8,
      borderLeft: 1.8,
      borderRight: 1.8,
    });
    y += h;
  }
  if (y > nStart) {
    drawOuterRect(ctx, leftX, nStart, contentW, y - nStart, 2.4);
  }

  y += mm(3);
  drawRtlLine(ctx, footerText(render.header.city, render.header.reportDate), leftX + mm(16), y, {
    align: 'left',
    sizePt: 9,
  });
}

function renderExtraWholeDayCanvas(canvas: HTMLCanvasElement, render: DailyReportRender, block: number): void {
  canvas.width = mm(A4_WIDTH_MM);
  canvas.height = mm(A4_HEIGHT_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const leftX = mm(7);
  const contentW = mm(196);
  const rightX = leftX + contentW;
  let y = mm(5);

  drawRtlLine(
    ctx,
    'التلاميذ الغائبون إلى نهاية اليوم : (يسجل التلاميذ المتغيبين لمدة يوم أو أكثر فقط)',
    rightX,
    y,
    { align: 'right', sizePt: 8.5 },
  );
  y += mm(4.2);
  y = drawWholeDayGrid(ctx, render, block * WHOLE_BLOCK_SIZE, leftX, y, contentW);
  y += mm(3);
  drawRtlLine(ctx, footerText(render.header.city, render.header.reportDate), leftX + mm(16), y, {
    align: 'left',
    sizePt: 9,
  });
}

export async function buildDailyReportPdfBlob(render: DailyReportRender): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback font
    }
  }

  const paginatedNotes = paginateDailyReportNotes(render);
  const blockCount = Math.max(1, Math.ceil(render.wholeDayAbsences.length / WHOLE_BLOCK_SIZE));

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title: `التقرير اليومي للناظر - ${formatDate(render.header.reportDate)}`,
    subject: 'Daily Report',
  });

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let pageCount = 0;

  const pushPage = (draw: (c: HTMLCanvasElement) => void) => {
    if (pageCount > 0) doc.addPage('a4', 'portrait');
    pageCount += 1;
    if (!canvas) return;
    draw(canvas);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      doc.addImage(dataUrl, 'PNG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST');
    }
  };

  pushPage((c) => renderPage1Canvas(c, render, paginatedNotes.page1));
  pushPage((c) => renderPage2PrimaryCanvas(c, render, paginatedNotes.page2));

  paginatedNotes.extraPages.forEach((extraSlice, index) => {
    pushPage((c) => renderContinuationNotesCanvas(c, render, extraSlice, index, paginatedNotes.extraPages.length));
  });

  for (let block = 1; block < blockCount; block += 1) {
    pushPage((c) => renderExtraWholeDayCanvas(c, render, block));
  }

  return doc.output('blob');
}

export async function exportDailyReportPdf(render: DailyReportRender, filename: string): Promise<void> {
  const blob = await buildDailyReportPdfBlob(render);
  await downloadBlob(blob, filename);
}

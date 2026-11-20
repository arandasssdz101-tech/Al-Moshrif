import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { downloadBlob } from '@/utils/download';
import {
  chunkCardsForA4,
  type CardPrintDensity,
  type PrintableStudentCard,
} from '@/utils/studentCardsPrint';

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

export interface A4CardGridLayout {
  density: CardPrintDensity;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gapX: number;
  gapY: number;
  marginX: number;
  marginY: number;
  cutPad: number;
  innerW: number;
  innerH: number;
  headerH: number;
  subHeaderH: number;
  footerH: number;
  qrBoxSize: number;
  sidePad: number;
  bodyGap: number;
}

export function getA4CardLayout(density: CardPrintDensity): A4CardGridLayout {
  if (density === 8) {
    const cols = 2;
    const rows = 4;
    const cellW = 92;
    const cellH = 64;
    const gapX = 6;
    const gapY = 4;
    const cutPad = 1.4;
    const totalW = cols * cellW + (cols - 1) * gapX;
    const totalH = rows * cellH + (rows - 1) * gapY;
    return {
      density,
      cols,
      rows,
      cellW,
      cellH,
      gapX,
      gapY,
      marginX: (A4_WIDTH_MM - totalW) / 2,
      marginY: (A4_HEIGHT_MM - totalH) / 2,
      cutPad,
      innerW: cellW - cutPad * 2,
      innerH: cellH - cutPad * 2,
      headerH: 7.4,
      subHeaderH: 5.2,
      footerH: 5.0,
      qrBoxSize: 33.5,
      sidePad: 2.6,
      bodyGap: 2.6,
    };
  }

  // Default economical 10 cards per A4 page (2 columns x 5 rows, CR80 ~86mm x 54mm)
  const cols = 2;
  const rows = 5;
  const cellW = 86;
  const cellH = 54;
  const gapX = 6;
  const gapY = 2;
  const cutPad = 1.4;
  const totalW = cols * cellW + (cols - 1) * gapX;
  const totalH = rows * cellH + (rows - 1) * gapY;
  return {
    density: 10,
    cols,
    rows,
    cellW,
    cellH,
    gapX,
    gapY,
    marginX: (A4_WIDTH_MM - totalW) / 2,
    marginY: (A4_HEIGHT_MM - totalH) / 2,
    cutPad,
    innerW: cellW - cutPad * 2,
    innerH: cellH - cutPad * 2,
    headerH: 6.4,
    subHeaderH: 4.6,
    footerH: 4.4,
    qrBoxSize: 27.5,
    sidePad: 2.4,
    bodyGap: 2.4,
  };
}

export function cardSlotPosition(
  layout: A4CardGridLayout,
  indexOnPage: number,
  rtlOrder = true,
): { cellX: number; cellY: number; innerX: number; innerY: number } {
  const row = Math.floor(indexOnPage / layout.cols);
  const rawCol = indexOnPage % layout.cols;
  const col = rtlOrder ? layout.cols - 1 - rawCol : rawCol;
  const cellX = layout.marginX + col * (layout.cellW + layout.gapX);
  const cellY = layout.marginY + row * (layout.cellH + layout.gapY);
  return {
    cellX,
    cellY,
    innerX: cellX + layout.cutPad,
    innerY: cellY + layout.cutPad,
  };
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else if (lines.length < maxLines - 1) {
      lines.push(current);
      current = words[i];
    } else {
      current = truncateText(ctx, `${current} ${words.slice(i).join(' ')}`, maxWidth);
      break;
    }
  }
  lines.push(truncateText(ctx, current, maxWidth));
  return lines;
}

function drawRtlLabelValueRow(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  y: number,
  maxWidth: number,
  label: string,
  value: string,
  labelFont: string,
  valueFont: string,
  gapPx: number,
  valueLtr = false,
): void {
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = labelFont;
  ctx.fillStyle = '#334155';
  ctx.fillText(label, rightX, y);
  const labelWidth = ctx.measureText(label).width;

  const valueMaxWidth = Math.max(0, maxWidth - labelWidth - gapPx);
  const valueRightX = rightX - labelWidth - gapPx;
  ctx.font = valueFont;
  ctx.fillStyle = '#000000';
  ctx.direction = valueLtr ? 'ltr' : 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText(truncateText(ctx, value, valueMaxWidth), valueRightX, y);
  ctx.restore();
}

// 300 DPI rasterization for crisp Arabic RTL shaping via browser native engine
const PX_PER_MM = 11.81;
const FONT_FAMILY = 'Cairo, Arial, sans-serif';

function renderCardTextLayer(
  canvas: HTMLCanvasElement,
  card: PrintableStudentCard,
  layout: A4CardGridLayout,
): string | null {
  const widthPx = Math.round(layout.innerW * PX_PER_MM);
  const heightPx = Math.round(layout.innerH * PX_PER_MM);
  if (canvas.width !== widthPx) canvas.width = widthPx;
  if (canvas.height !== heightPx) canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mm = (val: number) => val * PX_PER_MM;
  const isLarge = layout.density === 8;

  // Clean ink-saving white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const padX = mm(layout.sidePad);
  const headerH = mm(layout.headerH);
  const subHeaderH = mm(layout.subHeaderH);
  const footerH = mm(layout.footerH);

  // Header strip: Institution name (right) & School Year (left)
  const yearFontPx = mm(isLarge ? 2.65 : 2.45);
  const instFontPx = mm(isLarge ? 3.0 : 2.75);
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';

  ctx.font = `700 ${yearFontPx}px ${FONT_FAMILY}`;
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  const yearText = card.schoolYear.trim();
  const yearWidth = ctx.measureText(yearText).width;
  ctx.fillText(yearText, padX, headerH / 2);

  ctx.font = `700 ${instFontPx}px ${FONT_FAMILY}`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  const instMaxW = Math.max(0, widthPx - padX * 2 - yearWidth - mm(2.5));
  ctx.fillText(truncateText(ctx, card.institutionName, instMaxW), widthPx - padX, headerH / 2);

  // Crisp hairline under header
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(1, mm(0.32));
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(widthPx, headerH);
  ctx.stroke();
  ctx.restore();

  // Sub-header: "بطاقة التلميذ"
  const subTop = headerH;
  const subBottom = headerH + subHeaderH;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${mm(isLarge ? 2.6 : 2.35)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#0f172a';
  ctx.fillText('بطاقة التلميذ', widthPx / 2, subTop + subHeaderH / 2);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1, mm(0.18));
  ctx.beginPath();
  ctx.moveTo(0, subBottom);
  ctx.lineTo(widthPx, subBottom);
  ctx.stroke();
  ctx.restore();

  // Body right-side Arabic info block (left side is reserved for vector QR code)
  const bodyTop = subBottom;
  const bodyBottom = heightPx - footerH;
  const bodyH = bodyBottom - bodyTop;
  const textRightX = widthPx - padX;
  const qrReserveW = padX + mm(layout.qrBoxSize) + mm(layout.bodyGap);
  const textMaxW = Math.max(0, widthPx - padX - qrReserveW);

  const nameFontPx = mm(isLarge ? 3.55 : 3.2);
  const rowFontPx = mm(isLarge ? 2.85 : 2.55);
  const nameLineH = mm(isLarge ? 4.35 : 3.85);
  const rowLineH = mm(isLarge ? 4.4 : 3.85);

  ctx.save();
  ctx.font = `700 ${nameFontPx}px ${FONT_FAMILY}`;
  const nameLines = wrapLines(ctx, card.fullName, textMaxW, 2);
  ctx.restore();

  const blockHeight = nameLines.length * nameLineH + mm(1.2) + 3 * rowLineH;
  let cursorY = bodyTop + Math.max(mm(1.5), (bodyH - blockHeight) / 2);

  // Student Full Name
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${nameFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#000000';
  for (const line of nameLines) {
    ctx.fillText(line, textRightX, cursorY + nameLineH / 2);
    cursorY += nameLineH;
  }
  ctx.restore();

  cursorY += mm(1.2);
  const labelFont = `600 ${rowFontPx}px ${FONT_FAMILY}`;
  const valueFont = `700 ${rowFontPx}px ${FONT_FAMILY}`;
  const labelGap = mm(1.2);

  drawRtlLabelValueRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'القسم:',
    card.className,
    labelFont,
    valueFont,
    labelGap,
  );
  cursorY += rowLineH;

  drawRtlLabelValueRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'النظام:',
    card.regimeLabel,
    labelFont,
    valueFont,
    labelGap,
  );
  cursorY += rowLineH;

  drawRtlLabelValueRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'رقم التسجيل:',
    card.registrationNumber,
    labelFont,
    valueFont,
    labelGap,
    true,
  );

  // Footer strip
  const footerTop = heightPx - footerH;
  ctx.save();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1, mm(0.18));
  ctx.beginPath();
  ctx.moveTo(0, footerTop);
  ctx.lineTo(widthPx, footerTop);
  ctx.stroke();

  const footerFontPx = mm(isLarge ? 2.2 : 2.05);
  ctx.font = `600 ${footerFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#334155';
  ctx.textBaseline = 'middle';

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  const footerYearW = ctx.measureText(yearText).width;
  ctx.fillText(yearText, padX, footerTop + footerH / 2);

  if (card.directorate?.trim()) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const dirMaxW = Math.max(0, widthPx - padX * 2 - footerYearW - mm(2));
    ctx.fillText(truncateText(ctx, card.directorate, dirMaxW), widthPx - padX, footerTop + footerH / 2);
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function drawVectorQrCode(
  doc: jsPDF,
  payload: string,
  boxX: number,
  boxY: number,
  boxSizeMm: number,
): void {
  // White quiet-zone backing + crisp subtle frame
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.18);
  doc.roundedRect(boxX, boxY, boxSizeMm, boxSizeMm, 1.1, 1.1, 'FD');

  const utf8Bytes = new TextEncoder().encode(payload);
  const qr = QRCode.create([{ data: utf8Bytes, mode: 'byte' }], {
    errorCorrectionLevel: 'M',
  });
  const count = qr.modules.size;
  const quietZoneModules = 4;
  const innerPad = 0.6;
  const usable = boxSizeMm - innerPad * 2;
  const moduleMm = usable / (count + quietZoneModules * 2);
  const originX = boxX + innerPad + quietZoneModules * moduleMm;
  const originY = boxY + innerPad + quietZoneModules * moduleMm;
  // Tiny overlap eliminates subpixel hairlines between adjacent dark modules in PDF viewers
  const drawSize = moduleMm + 0.018;

  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.modules.get(row, col)) {
        doc.rect(originX + col * moduleMm, originY + row * moduleMm, drawSize, drawSize, 'F');
      }
    }
  }
}

export async function buildStudentCardsPdfBlob(
  cards: PrintableStudentCard[],
  title: string,
  density: CardPrintDensity = 10,
): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback system font if font loading fails
    }
  }

  const layout = getA4CardLayout(density);
  const pages = chunkCardsForA4(cards, density);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  doc.setProperties({
    title,
    subject: 'Student ID & QR Cards',
  });

  const scratchCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

  pages.forEach((pageCards, pageIndex) => {
    if (pageIndex > 0) doc.addPage('a4', 'portrait');

    pageCards.forEach((card, cardIndex) => {
      const { cellX, cellY, innerX, innerY } = cardSlotPosition(layout, cardIndex, true);

      // 1. Crisp vector Arabic RTL text layer (300 DPI canvas -> PNG)
      if (scratchCanvas) {
        const pngDataUrl = renderCardTextLayer(scratchCanvas, card, layout);
        if (pngDataUrl) {
          doc.addImage(pngDataUrl, 'PNG', innerX, innerY, layout.innerW, layout.innerH, undefined, 'FAST');
        }
      }

      // 2. Crisp vector card border (ink-saving dark hairline)
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.32);
      doc.setLineDashPattern([], 0);
      doc.roundedRect(innerX, innerY, layout.innerW, layout.innerH, 1.8, 1.8, 'S');

      // 3. Pure vector UTF-8 QR code on the left side of card body
      const bodyTopY = innerY + layout.headerH + layout.subHeaderH;
      const bodyHeight = layout.innerH - layout.headerH - layout.subHeaderH - layout.footerH;
      const qrX = innerX + layout.sidePad;
      const qrY = bodyTopY + (bodyHeight - layout.qrBoxSize) / 2;
      drawVectorQrCode(doc, card.qrPayload, qrX, qrY, layout.qrBoxSize);

      // 4. Outer dashed cut-line around each card for easy scissors/guillotine cutting
      doc.setDrawColor(100, 116, 139);
      doc.setLineWidth(0.24);
      doc.setLineDashPattern([1.8, 1.2], 0);
      doc.rect(cellX, cellY, layout.cellW, layout.cellH, 'S');
      doc.setLineDashPattern([], 0);
    });
  });

  return doc.output('blob');
}

export async function downloadStudentCardsPdf(
  cards: PrintableStudentCard[],
  title: string,
  density: CardPrintDensity = 10,
): Promise<void> {
  if (cards.length === 0) return;
  const blob = await buildStudentCardsPdfBlob(cards, title, density);
  const safeName = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'student-cards';
  await downloadBlob(blob, `${safeName}.pdf`);
}

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { downloadBlob } from '@/utils/download';
import {
  ALGERIA_FLAG_SVG,
  ALGERIA_MAP_ASPECT_RATIO,
  ALGERIA_MAP_WATERMARK_URL,
  CARD_TITLE_AR,
  GUILLOCHE_BG_SVG,
  MINISTRY_EMBLEM_SVG,
  MINISTRY_NAME_AR,
  REPUBLIC_NAME_AR,
  STUDENT_PHOTO_PLACEHOLDER_SVG,
  svgToDataUrl,
} from '@/utils/studentCardArtwork';
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
  qrBezelPad: number;
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
      headerH: 11.8,
      subHeaderH: 0,
      footerH: 5.8,
      qrBoxSize: 33.5,
      qrBezelPad: 1.3,
      sidePad: 2.4,
      bodyGap: 2.2,
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
    headerH: 10.4,
    subHeaderH: 0,
    footerH: 5.1,
    qrBoxSize: 27.5,
    qrBezelPad: 1.15,
    sidePad: 2.2,
    bodyGap: 2.0,
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

interface CardArtworkImages {
  flag: HTMLImageElement | null;
  emblem: HTMLImageElement | null;
  map: HTMLImageElement | null;
  guilloche: HTMLImageElement | null;
  photo: HTMLImageElement | null;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 1500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function loadSvgImage(svg: string): Promise<HTMLImageElement | null> {
  return loadImageFromUrl(svgToDataUrl(svg));
}

async function loadCardArtworkImages(): Promise<CardArtworkImages> {
  const [flag, emblem, map, guilloche, photo] = await Promise.all([
    loadSvgImage(ALGERIA_FLAG_SVG),
    loadSvgImage(MINISTRY_EMBLEM_SVG),
    loadImageFromUrl(ALGERIA_MAP_WATERMARK_URL),
    loadSvgImage(GUILLOCHE_BG_SVG),
    loadSvgImage(STUDENT_PHOTO_PLACEHOLDER_SVG),
  ]);
  return { flag, emblem, map, guilloche, photo };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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
  ctx.fillStyle = '#2d3a32';
  ctx.fillText(label, rightX, y);
  const labelWidth = ctx.measureText(label).width;

  const valueMaxWidth = Math.max(0, maxWidth - labelWidth - gapPx);
  const valueRightX = rightX - labelWidth - gapPx;
  ctx.font = valueFont;
  ctx.fillStyle = '#111814';
  ctx.direction = valueLtr ? 'ltr' : 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText(truncateText(ctx, value, valueMaxWidth), valueRightX, y);
  ctx.restore();
}

function drawRtlPairRow(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  y: number,
  maxWidth: number,
  firstLabel: string,
  firstValue: string,
  secondLabel: string,
  secondValue: string,
  labelFont: string,
  valueFont: string,
  gapPx: number,
  pairGapPx: number,
): void {
  const halfMax = Math.max(0, (maxWidth - pairGapPx) / 2);
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  ctx.font = labelFont;
  ctx.fillStyle = '#2d3a32';
  ctx.fillText(firstLabel, rightX, y);
  const firstLabelW = ctx.measureText(firstLabel).width;

  ctx.font = valueFont;
  ctx.fillStyle = '#111814';
  const firstValText = truncateText(ctx, firstValue, Math.max(0, halfMax - firstLabelW - gapPx));
  ctx.fillText(firstValText, rightX - firstLabelW - gapPx, y);
  const firstValW = ctx.measureText(firstValText).width;

  const usedFirst = firstLabelW + gapPx + firstValW + pairGapPx;
  const secondRightX = rightX - usedFirst;
  const remainingW = Math.max(0, maxWidth - usedFirst);

  if (remainingW > 0) {
    ctx.font = labelFont;
    ctx.fillStyle = '#2d3a32';
    ctx.fillText(secondLabel, secondRightX, y);
    const secondLabelW = ctx.measureText(secondLabel).width;

    ctx.font = valueFont;
    ctx.fillStyle = '#111814';
    const secondValText = truncateText(ctx, secondValue, Math.max(0, remainingW - secondLabelW - gapPx));
    ctx.fillText(secondValText, secondRightX - secondLabelW - gapPx, y);
  }
  ctx.restore();
}

// 300 DPI rasterization for crisp Arabic RTL shaping via browser native engine
const PX_PER_MM = 11.81;
const FONT_FAMILY = 'Cairo, Arial, sans-serif';

function renderCardTextLayer(
  canvas: HTMLCanvasElement,
  card: PrintableStudentCard,
  layout: A4CardGridLayout,
  artwork: CardArtworkImages,
): string | null {
  const widthPx = Math.round(layout.innerW * PX_PER_MM);
  const heightPx = Math.round(layout.innerH * PX_PER_MM);
  if (canvas.width !== widthPx) canvas.width = widthPx;
  if (canvas.height !== heightPx) canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mm = (val: number) => val * PX_PER_MM;
  const isLarge = layout.density === 8;

  const padX = mm(layout.sidePad);
  const headerH = mm(layout.headerH);
  const footerH = mm(layout.footerH);
  const bodyTop = headerH;
  const bodyBottom = heightPx - footerH;
  const bodyH = bodyBottom - bodyTop;

  // Clip entire card to rounded corners matching the PDF border radius (2mm)
  ctx.save();
  drawRoundedRectPath(ctx, 0, 0, widthPx, heightPx, mm(1.8));
  ctx.clip();

  // 1. Soft pearl-sage card base background
  const bodyBgGrad = ctx.createLinearGradient(0, bodyTop, 0, bodyBottom);
  bodyBgGrad.addColorStop(0, '#e9eee9');
  bodyBgGrad.addColorStop(0.16, '#f5f7f4');
  bodyBgGrad.addColorStop(0.84, '#f3f6f2');
  bodyBgGrad.addColorStop(1, '#e3e9e3');
  ctx.fillStyle = bodyBgGrad;
  ctx.fillRect(0, 0, widthPx, heightPx);

  // 2. Guilloche fine security curves across the body
  if (artwork.guilloche) {
    ctx.drawImage(artwork.guilloche, 0, bodyTop, widthPx, bodyH);
  }

  // 3. Centered exact Algeria map + translucent red crescent & star watermark
  if (artwork.map) {
    const mapH = bodyH * 0.95;
    const mapW = mapH * ALGERIA_MAP_ASPECT_RATIO;
    ctx.drawImage(artwork.map, (widthPx - mapW) / 2, bodyTop + (bodyH - mapH) / 2, mapW, mapH);
  }

  // 4. Top Metallic Sage-Silver Header Band
  const headerGrad = ctx.createLinearGradient(0, 0, widthPx, 0);
  headerGrad.addColorStop(0, '#b7c2b8');
  headerGrad.addColorStop(0.26, '#d4ddd5');
  headerGrad.addColorStop(0.54, '#e4e9e4');
  headerGrad.addColorStop(0.82, '#ccd6cd');
  headerGrad.addColorStop(1, '#bac6bb');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, widthPx, headerH);

  // Top light bevel + bottom metallic border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = Math.max(1, mm(0.16));
  ctx.beginPath();
  ctx.moveTo(0, mm(0.15));
  ctx.lineTo(widthPx, mm(0.15));
  ctx.stroke();

  ctx.strokeStyle = '#7f8c81';
  ctx.lineWidth = Math.max(1, mm(0.24));
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(widthPx, headerH);
  ctx.stroke();

  // Header contents: School Year (left) | بطاقة التلميذ (center-left) | Ministry Lockup (center-right) | Institution (far right)
  const yearText = card.schoolYear.trim();
  const headerMidY = headerH / 2;

  ctx.save();
  ctx.textBaseline = 'middle';

  // Far left: School Year
  ctx.font = `800 ${mm(isLarge ? 2.55 : 2.3)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#1e2923';
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillText(yearText, padX, headerMidY);

  // Far right: Institution Name
  const instMaxW = widthPx * 0.21;
  ctx.font = `800 ${mm(isLarge ? 2.5 : 2.25)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#1a241e';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  const instText = truncateText(ctx, card.institutionName, instMaxW);
  ctx.fillText(instText, widthPx - padX, headerMidY);
  const instActualW = Math.min(instMaxW, ctx.measureText(instText).width);

  // Center-right: Ministry lockup (Flag + Republic mini + Ministry name + Tree emblem)
  const emblemW = mm(isLarge ? 7.2 : 6.4);
  const emblemH = mm(isLarge ? 6.3 : 5.6);
  const flagW = mm(isLarge ? 3.5 : 3.1);
  const flagH = mm(isLarge ? 2.3 : 2.05);
  const lockupRightX = widthPx - padX - instActualW - mm(2.0);
  const miniFontPx = mm(isLarge ? 1.45 : 1.3);
  const minFontPx = mm(isLarge ? 2.25 : 2.0);

  // Flag + Republic mini text (top line of lockup)
  ctx.font = `700 ${miniFontPx}px ${FONT_FAMILY}`;
  const miniW = ctx.measureText(REPUBLIC_NAME_AR).width;
  ctx.font = `800 ${minFontPx}px ${FONT_FAMILY}`;
  const ministryNameW = ctx.measureText(MINISTRY_NAME_AR).width;
  const textColW = Math.max(miniW + flagW + mm(0.8), ministryNameW);

  // Draw flag at top-right of text column, then republic mini text to its left
  if (artwork.flag) {
    ctx.drawImage(
      artwork.flag,
      lockupRightX - flagW,
      headerMidY - mm(isLarge ? 2.85 : 2.55),
      flagW,
      flagH,
    );
  }
  ctx.font = `700 ${miniFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#253129';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText(
    REPUBLIC_NAME_AR,
    lockupRightX - flagW - mm(0.75),
    headerMidY - mm(isLarge ? 1.65 : 1.45),
  );

  // Main Ministry line below
  ctx.font = `800 ${minFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#141e18';
  ctx.fillText(
    MINISTRY_NAME_AR,
    lockupRightX,
    headerMidY + mm(isLarge ? 1.55 : 1.35),
  );

  // Ministry Tree Emblem to the left of the text column
  const emblemX = lockupRightX - textColW - mm(0.9) - emblemW;
  if (artwork.emblem) {
    ctx.drawImage(artwork.emblem, emblemX, headerMidY - emblemH / 2, emblemW, emblemH);
  }

  // Center-left: Prominent "بطاقة التلميذ" centered cleanly between year and emblem
  ctx.font = `800 ${mm(isLarge ? 2.55 : 2.3)}px ${FONT_FAMILY}`;
  const yearRightEdge = padX + ctx.measureText(yearText).width + mm(1.8);
  const titleCenterX = (yearRightEdge + emblemX - mm(1.2)) / 2;
  ctx.font = `800 ${mm(isLarge ? 3.35 : 3.0)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#141e18';
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillText(CARD_TITLE_AR, titleCenterX, headerMidY);
  ctx.restore();

  // 5. Left-side Metallic Champagne-Silver Beveled QR Frame (pure vector QR drawn on top by jsPDF)
  const qrOuterPx = mm(layout.qrBoxSize);
  const qrX = padX;
  const qrY = bodyTop + (bodyH - qrOuterPx) / 2;
  const bezelPadPx = mm(layout.qrBezelPad);

  ctx.save();
  ctx.shadowColor = 'rgba(26, 36, 30, 0.24)';
  ctx.shadowBlur = mm(1.4);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = mm(0.5);
  const bezelGrad = ctx.createLinearGradient(qrX, qrY, qrX + qrOuterPx, qrY + qrOuterPx);
  bezelGrad.addColorStop(0, '#dbd7cb');
  bezelGrad.addColorStop(0.34, '#8f8b7e');
  bezelGrad.addColorStop(0.68, '#e8e5da');
  bezelGrad.addColorStop(1, '#9d998b');
  drawRoundedRectPath(ctx, qrX, qrY, qrOuterPx, qrOuterPx, mm(2.0));
  ctx.fillStyle = bezelGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRectPath(ctx, qrX, qrY, qrOuterPx, qrOuterPx, mm(2.0));
  ctx.strokeStyle = '#6c695e';
  ctx.lineWidth = Math.max(1, mm(0.18));
  ctx.stroke();

  // Pure white inner backing inside metallic bezel
  drawRoundedRectPath(
    ctx,
    qrX + bezelPadPx,
    qrY + bezelPadPx,
    qrOuterPx - bezelPadPx * 2,
    qrOuterPx - bezelPadPx * 2,
    mm(1.1),
  );
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#b4b0a4';
  ctx.lineWidth = Math.max(1, mm(0.14));
  ctx.stroke();
  ctx.restore();

  // 6. Right-side Student Portrait Box, Full Name, and Structured Info Rows
  const textRightX = widthPx - padX;
  const qrReserveW = padX + qrOuterPx + mm(layout.bodyGap);
  const textMaxW = Math.max(0, widthPx - padX - qrReserveW);

  const photoW = mm(isLarge ? 12.2 : 10.2);
  const photoH = mm(isLarge ? 14.2 : 11.8);
  const photoGap = mm(isLarge ? 1.8 : 1.6);

  const nameFontPx = mm(isLarge ? 3.2 : 2.8);
  const nameLineH = mm(isLarge ? 3.8 : 3.3);
  const rowFontPx = mm(isLarge ? 2.4 : 2.08);
  const rowLineH = mm(isLarge ? 3.55 : 2.95);
  const topBlockH = photoH + mm(isLarge ? 1.2 : 0.9);
  const totalBlockH = topBlockH + 5 * rowLineH;
  const blockStartY = bodyTop + Math.max(mm(0.8), (bodyH - totalBlockH) / 2);

  // Portrait Photo Slot (top right)
  const photoX = textRightX - photoW;
  const photoY = blockStartY;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(photoX, photoY, photoW, photoH);
  if (artwork.photo) {
    ctx.drawImage(artwork.photo, photoX, photoY, photoW, photoH);
  }
  ctx.strokeStyle = '#616e64';
  ctx.lineWidth = Math.max(1, mm(0.18));
  ctx.strokeRect(photoX, photoY, photoW, photoH);
  ctx.restore();

  // Student Full Name beside photo (aligned toward lower-middle of photo box)
  const nameRightX = photoX - photoGap;
  const nameMaxW = Math.max(0, textMaxW - photoW - photoGap);
  ctx.save();
  ctx.font = `800 ${nameFontPx}px ${FONT_FAMILY}`;
  const nameLines = wrapLines(ctx, card.fullName, nameMaxW, 2);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#141d17';
  const nameBlockH = nameLines.length * nameLineH;
  let nameCursorY = photoY + photoH - nameBlockH - mm(0.6);
  if (nameCursorY < photoY) nameCursorY = photoY;
  for (const line of nameLines) {
    ctx.fillText(line, nameRightX, nameCursorY + nameLineH / 2);
    nameCursorY += nameLineH;
  }
  ctx.restore();

  // 5 Structured Student Info Rows below photo/name
  let cursorY = blockStartY + topBlockH;
  const labelFont = `700 ${rowFontPx}px ${FONT_FAMILY}`;
  const valueFont = `800 ${rowFontPx}px ${FONT_FAMILY}`;
  const labelGap = mm(0.8);

  drawRtlPairRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'القسم:',
    card.className,
    'الجنس:',
    card.genderLabel ?? '—',
    labelFont,
    valueFont,
    labelGap,
    mm(2.2),
  );
  cursorY += rowLineH;

  drawRtlLabelValueRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'تاريخ الميلاد:',
    card.dateOfBirth ?? '—',
    labelFont,
    valueFont,
    labelGap,
    true,
  );
  cursorY += rowLineH;

  drawRtlLabelValueRow(
    ctx,
    textRightX,
    cursorY + rowLineH / 2,
    textMaxW,
    'مكان الميلاد:',
    card.placeOfBirth ?? '—',
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

  // 7. Bottom Metallic Sage-Silver Footer Band
  const footerTop = heightPx - footerH;
  const footerGrad = ctx.createLinearGradient(0, footerTop, widthPx, footerTop);
  footerGrad.addColorStop(0, '#b7c2b8');
  footerGrad.addColorStop(0.28, '#d4ddd5');
  footerGrad.addColorStop(0.58, '#e2e7e2');
  footerGrad.addColorStop(1, '#c7d1c8');
  ctx.fillStyle = footerGrad;
  ctx.fillRect(0, footerTop, widthPx, footerH);

  ctx.save();
  ctx.strokeStyle = '#7f8c81';
  ctx.lineWidth = Math.max(1, mm(0.24));
  ctx.beginPath();
  ctx.moveTo(0, footerTop);
  ctx.lineTo(widthPx, footerTop);
  ctx.stroke();

  const footerFontPx = mm(isLarge ? 2.2 : 2.0);
  const footerMidY = footerTop + footerH / 2;
  ctx.font = `800 ${footerFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#1a241e';
  ctx.textBaseline = 'middle';

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillText(yearText, padX, footerMidY);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText(REPUBLIC_NAME_AR, widthPx - padX, footerMidY);
  ctx.restore();

  ctx.restore(); // end rounded card clip

  return canvas.toDataURL('image/png');
}

function drawVectorQrCode(
  doc: jsPDF,
  payload: string,
  boxX: number,
  boxY: number,
  boxSizeMm: number,
  bezelPadMm: number,
): void {
  const innerX = boxX + bezelPadMm;
  const innerY = boxY + bezelPadMm;
  const innerSize = boxSizeMm - bezelPadMm * 2;

  // Crisp pure-white QR background inside the metallic bezel (ensures instant scanner readability)
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(innerX + 0.15, innerY + 0.15, innerSize - 0.3, innerSize - 0.3, 0.9, 0.9, 'F');

  const utf8Bytes = new TextEncoder().encode(payload);
  const qr = QRCode.create([{ data: utf8Bytes, mode: 'byte' }], {
    errorCorrectionLevel: 'M',
  });
  const count = qr.modules.size;
  const quietZoneModules = 4;
  const innerPad = 0.5;
  const usable = innerSize - innerPad * 2;
  const moduleMm = usable / (count + quietZoneModules * 2);
  const originX = innerX + innerPad + quietZoneModules * moduleMm;
  const originY = innerY + innerPad + quietZoneModules * moduleMm;
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

  const artwork = await loadCardArtworkImages();
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

      // 1. Official Algerian student card backdrop + metallic bands + Arabic RTL typography (300 DPI PNG)
      if (scratchCanvas) {
        const pngDataUrl = renderCardTextLayer(scratchCanvas, card, layout, artwork);
        if (pngDataUrl) {
          doc.addImage(pngDataUrl, 'PNG', innerX, innerY, layout.innerW, layout.innerH, undefined, 'FAST');
        }
      }

      // 2. Crisp vector card border matching metallic sage frame
      doc.setDrawColor(138, 151, 140);
      doc.setLineWidth(0.28);
      doc.setLineDashPattern([], 0);
      doc.roundedRect(innerX, innerY, layout.innerW, layout.innerH, 1.8, 1.8, 'S');

      // 3. Pure vector UTF-8 QR code inside the beveled metallic frame on the left side
      const bodyTopY = innerY + layout.headerH + layout.subHeaderH;
      const bodyHeight = layout.innerH - layout.headerH - layout.subHeaderH - layout.footerH;
      const qrX = innerX + layout.sidePad;
      const qrY = bodyTopY + (bodyHeight - layout.qrBoxSize) / 2;
      drawVectorQrCode(doc, card.qrPayload, qrX, qrY, layout.qrBoxSize, layout.qrBezelPad);

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

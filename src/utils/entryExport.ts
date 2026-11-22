import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import type { GateEntry } from '@/db/types';
import { downloadBlob } from '@/utils/download';
import type { DailyEntryStats } from '@/utils/entry';

export interface EntryLogExportRow {
  time: string;
  studentName: string;
  className: string;
  boardingLabel: string;
  resultLabel: string;
  lateLabel: string;
  sourceLabel: string;
  scannedCode: string;
  result: GateEntry['result'];
  late: boolean;
}

export interface EntryLogExportMeta {
  title: string;
  institutionName: string;
  date: string;
  isRtl: boolean;
  stats: DailyEntryStats;
  labels: {
    date: string;
    entered: string;
    notEntered: string;
    late: string;
    duplicates: string;
    unknown: string;
    time: string;
    student: string;
    className: string;
    status: string;
    result: string;
    delay: string;
    source: string;
    code: string;
  };
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function exportEntryLogExcel(
  rows: EntryLogExportRow[],
  meta: EntryLogExportMeta,
  filename: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.institutionName || 'الإشراف التربوي';
  workbook.created = new Date();

  const ws = workbook.addWorksheet(meta.title.slice(0, 31) || 'Entry Log');
  ws.views = [{ rightToLeft: meta.isRtl, showGridLines: true }];
  ws.columns = [
    { width: 12 },
    { width: 26 },
    { width: 13 },
    { width: 14 },
    { width: 15 },
    { width: 14 },
    { width: 13 },
    { width: 22 },
  ];

  const alignMain: Partial<ExcelJS.Alignment> = {
    horizontal: meta.isRtl ? 'right' : 'left',
    vertical: 'middle',
    wrapText: true,
  };
  const alignCenter: Partial<ExcelJS.Alignment> = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };

  // Title row
  ws.mergeCells(1, 1, 1, 8);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${meta.title} — ${meta.institutionName}`;
  titleCell.font = { name: 'Arial', size: 13, bold: true };
  titleCell.alignment = alignCenter;
  ws.getRow(1).height = 24;

  // Summary strip row
  ws.mergeCells(2, 1, 2, 8);
  const summaryCell = ws.getCell(2, 1);
  summaryCell.value = `${meta.labels.date}: ${meta.date}   |   ${meta.labels.entered}: ${meta.stats.entered}/${meta.stats.enrolled}   |   ${meta.labels.notEntered}: ${meta.stats.notEntered}   |   ${meta.labels.late}: ${meta.stats.late}   |   ${meta.labels.duplicates}: ${meta.stats.duplicates}   |   ${meta.labels.unknown}: ${meta.stats.unknown}`;
  summaryCell.font = { name: 'Arial', size: 10, bold: true };
  summaryCell.alignment = alignCenter;
  ws.getRow(2).height = 20;

  // Table header
  const headers = [
    meta.labels.time,
    meta.labels.student,
    meta.labels.className,
    meta.labels.status,
    meta.labels.result,
    meta.labels.delay,
    meta.labels.source,
    meta.labels.code,
  ];
  const headerRow = ws.getRow(4);
  headerRow.height = 22;
  headers.forEach((label, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = label;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = alignCenter;
  });

  rows.forEach((row, index) => {
    const excelRow = ws.getRow(5 + index);
    excelRow.height = 19;
    const values = [
      row.time,
      row.studentName,
      row.className,
      row.boardingLabel,
      row.resultLabel,
      row.lateLabel,
      row.sourceLabel,
      row.scannedCode,
    ];
    values.forEach((value, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      cell.value = value;
      cell.font = { name: 'Arial', size: 9.5 };
      cell.alignment = colIdx === 1 || colIdx === 7 ? alignMain : alignCenter;
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  await downloadBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

function drawTruncatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  if (!text) return;
  let value = text;
  while (value.length > 1 && ctx.measureText(value).width > maxWidth) {
    value = `${value.slice(0, -2)}…`;
  }
  ctx.fillText(value, x, y);
}

export async function exportEntryLogPdf(
  rows: EntryLogExportRow[],
  meta: EntryLogExportMeta,
  filename: string,
): Promise<void> {
  // Render crisp A4 pages on Canvas so Arabic RTL text shapes natively without external font CDN
  const pageW = 1240;
  const pageH = 1754;
  const margin = 56;
  const usableW = pageW - margin * 2;
  const rowsPerPage = 32;
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fontStack = 'Cairo, "Segoe UI", Tahoma, Arial, sans-serif';

  const colSpecs = [
    { label: meta.labels.time, width: 0.11 },
    { label: meta.labels.student, width: 0.25 },
    { label: meta.labels.className, width: 0.1 },
    { label: meta.labels.status, width: 0.12 },
    { label: meta.labels.result, width: 0.13 },
    { label: meta.labels.delay, width: 0.1 },
    { label: meta.labels.source, width: 0.09 },
    { label: meta.labels.code, width: 0.1 },
  ];

  const orderedCols = meta.isRtl ? [...colSpecs].reverse() : colSpecs;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.direction = meta.isRtl ? 'rtl' : 'ltr';

    // Header banner
    ctx.fillStyle = '#0F766E';
    ctx.fillRect(margin, margin, usableW, 74);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 28px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${meta.title} — ${meta.institutionName}`, pageW / 2, margin + 28);

    ctx.font = `500 18px ${fontStack}`;
    ctx.fillText(`${meta.labels.date}: ${meta.date}`, pageW / 2, margin + 56);

    // Summary boxes
    const summaryY = margin + 90;
    const summaryItems = [
      `${meta.labels.entered}: ${meta.stats.entered}/${meta.stats.enrolled}`,
      `${meta.labels.notEntered}: ${meta.stats.notEntered}`,
      `${meta.labels.late}: ${meta.stats.late}`,
      `${meta.labels.duplicates}: ${meta.stats.duplicates}`,
      `${meta.labels.unknown}: ${meta.stats.unknown}`,
    ];
    const boxW = usableW / summaryItems.length;
    summaryItems.forEach((item, idx) => {
      const bx = margin + idx * boxW;
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(bx + 4, summaryY, boxW - 8, 42);
      ctx.strokeStyle = '#CBD5E1';
      ctx.strokeRect(bx + 4, summaryY, boxW - 8, 42);
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 17px ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.fillText(item, bx + boxW / 2, summaryY + 22);
    });

    // Table header
    const tableTop = summaryY + 58;
    const headerH = 42;
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(margin, tableTop, usableW, headerH);

    let cursorX = margin;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 16px ${fontStack}`;
    ctx.textAlign = 'center';
    for (const col of orderedCols) {
      const colW = col.width * usableW;
      ctx.fillText(col.label, cursorX + colW / 2, tableTop + headerH / 2);
      cursorX += colW;
    }

    // Rows
    const slice = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const rowH = 42;
    slice.forEach((row, rIdx) => {
      const y = tableTop + headerH + rIdx * rowH;
      ctx.fillStyle = rIdx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      ctx.fillRect(margin, y, usableW, rowH);
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(margin, y, usableW, rowH);

      const values = [
        row.time,
        row.studentName,
        row.className,
        row.boardingLabel,
        row.resultLabel,
        row.lateLabel,
        row.sourceLabel,
        row.scannedCode,
      ];
      const orderedValues = meta.isRtl ? [...values].reverse() : values;

      let cellX = margin;
      ctx.font = `500 15px ${fontStack}`;
      orderedCols.forEach((col, cIdx) => {
        const colW = col.width * usableW;
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'center';
        drawTruncatedText(ctx, orderedValues[cIdx] ?? '', cellX + colW / 2, y + rowH / 2, colW - 12);
        cellX += colW;
      });
    });

    // Footer page number
    ctx.fillStyle = '#64748B';
    ctx.font = `500 15px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${pageIndex + 1} / ${totalPages}`, pageW / 2, pageH - 28);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
  }

  const blob = pdf.output('blob');
  await downloadBlob(blob, filename);
}

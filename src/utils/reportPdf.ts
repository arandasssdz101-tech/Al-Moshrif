import { jsPDF } from 'jspdf';
import { downloadBlob } from '@/utils/download';
import type { PrintableReport, PrintableSection } from '@/utils/printReport';

const A4_LANDSCAPE_W = 297;
const A4_LANDSCAPE_H = 210;
const PX_PER_MM = 7;
const FONT_FAMILY = 'Cairo, Inter, Arial, sans-serif';

const mm = (value: number): number => value * PX_PER_MM;
const pt = (value: number): number => (value * 25.4 / 72) * PX_PER_MM;

interface TableRowItem {
  kind: 'section-heading' | 'table-header' | 'row' | 'footer';
  heading?: string;
  cells?: string[];
  colWidths?: number[];
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function computeColWidths(section: PrintableSection, totalW: number): number[] {
  const count = Math.max(1, section.headers.length);
  if (count === 1) return [totalW];
  const firstW = Math.min(totalW * 0.28, Math.max(totalW * 0.16, mm(45)));
  const restW = (totalW - firstW) / (count - 1);
  return [firstW, ...Array.from({ length: count - 1 }, () => restW)];
}

export async function buildPrintableReportPdfBlob(report: PrintableReport): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback font
    }
  }

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  doc.setProperties({ title: report.title });

  const isRtl = report.dir === 'rtl';
  const marginMm = 12;
  const contentWMm = A4_LANDSCAPE_W - marginMm * 2;
  const usableTopMm = 28;
  const usableBottomMm = A4_LANDSCAPE_H - 14;

  // Flatten sections into paginated layout items
  const items: TableRowItem[] = [];
  for (const section of report.sections) {
    const colWidths = computeColWidths(section, mm(contentWMm));
    if (section.heading) {
      items.push({ kind: 'section-heading', heading: section.heading });
    }
    items.push({ kind: 'table-header', cells: section.headers, colWidths });
    for (const row of section.rows) {
      items.push({ kind: 'row', cells: row, colWidths });
    }
    if (section.footer) {
      items.push({ kind: 'footer', cells: section.footer, colWidths });
    }
  }

  const itemHeightMm = (kind: TableRowItem['kind']): number => {
    if (kind === 'section-heading') return 9;
    if (kind === 'table-header') return 8;
    return 7;
  };

  const pages: TableRowItem[][] = [];
  let current: TableRowItem[] = [];
  let yMm = usableTopMm;
  let activeHeader: TableRowItem | null = null;

  for (const item of items) {
    if (item.kind === 'table-header') activeHeader = item;
    const h = itemHeightMm(item.kind);
    if (yMm + h > usableBottomMm && current.length > 0) {
      pages.push(current);
      current = [];
      yMm = usableTopMm;
      if (item.kind === 'row' || item.kind === 'footer') {
        if (activeHeader) {
          current.push(activeHeader);
          yMm += itemHeightMm('table-header');
        }
      }
    }
    current.push(item);
    yMm += h;
  }
  if (current.length > 0 || pages.length === 0) {
    pages.push(current);
  }

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

  pages.forEach((pageItems, pageIndex) => {
    if (pageIndex > 0) doc.addPage('a4', 'landscape');
    if (!canvas) return;
    canvas.width = mm(A4_LANDSCAPE_W);
    canvas.height = mm(A4_LANDSCAPE_H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const leftX = mm(marginMm);
    const contentW = mm(contentWMm);
    const rightX = leftX + contentW;

    ctx.save();
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.fillStyle = '#171717';
    ctx.textBaseline = 'top';
    ctx.textAlign = isRtl ? 'right' : 'left';
    const anchorX = isRtl ? rightX : leftX;
    ctx.font = `700 ${pt(14)}px ${FONT_FAMILY}`;
    ctx.fillText(report.title, anchorX, mm(10));
    ctx.fillStyle = '#525252';
    ctx.font = `400 ${pt(9.5)}px ${FONT_FAMILY}`;
    ctx.fillText(report.subtitle, anchorX, mm(17.5));
    ctx.restore();

    let y = mm(usableTopMm);
    for (const item of pageItems) {
      const h = mm(itemHeightMm(item.kind));
      if (item.kind === 'section-heading' && item.heading) {
        ctx.save();
        ctx.direction = isRtl ? 'rtl' : 'ltr';
        ctx.fillStyle = '#171717';
        ctx.font = `700 ${pt(11)}px ${FONT_FAMILY}`;
        ctx.textAlign = isRtl ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.heading, isRtl ? rightX : leftX, y + h / 2);
        ctx.restore();
        y += h;
        continue;
      }

      const cells = item.cells ?? [];
      const widths = item.colWidths ?? [];
      let cursor = isRtl ? rightX : leftX;
      const isHeader = item.kind === 'table-header';
      const isFooter = item.kind === 'footer';

      cells.forEach((cellText, colIdx) => {
        const cw = widths[colIdx] ?? contentW / Math.max(1, cells.length);
        const cx = isRtl ? cursor - cw : cursor;
        cursor = isRtl ? cx : cursor + cw;

        ctx.fillStyle = isHeader ? '#f5f5f5' : isFooter ? '#fafafa' : '#ffffff';
        ctx.fillRect(cx, y, cw, h);
        ctx.strokeStyle = '#d4d4d4';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, y, cw, h);

        ctx.save();
        ctx.direction = isRtl ? 'rtl' : 'ltr';
        ctx.fillStyle = '#171717';
        ctx.font = `${isHeader || isFooter ? 700 : 400} ${pt(8.5)}px ${FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        const alignStart = colIdx === 0;
        ctx.textAlign = alignStart ? (isRtl ? 'right' : 'left') : (isRtl ? 'left' : 'right');
        const tx =
          ctx.textAlign === 'right'
            ? cx + cw - mm(2)
            : cx + mm(2);
        ctx.fillText(fitText(ctx, cellText, Math.max(4, cw - mm(4))), tx, y + h / 2);
        ctx.restore();
      });

      y += h;
    }

    // Page number footer
    ctx.save();
    ctx.fillStyle = '#737373';
    ctx.font = `500 ${pt(8.5)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pageIndex + 1} / ${pages.length}`, canvas.width / 2, mm(A4_LANDSCAPE_H - 7));
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      doc.addImage(dataUrl, 'PNG', 0, 0, A4_LANDSCAPE_W, A4_LANDSCAPE_H, undefined, 'FAST');
    }
  });

  return doc.output('blob');
}

export async function exportPrintableReportPdf(report: PrintableReport, filename: string): Promise<void> {
  const blob = await buildPrintableReportPdfBlob(report);
  await downloadBlob(blob, filename);
}

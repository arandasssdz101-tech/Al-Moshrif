import type { Student } from '@/db/types';
import { esc } from '@/utils/dailyReportHtml';
import { downloadBlob } from '@/utils/download';
import { isNativeApp } from '@/utils/platform';
import {
  buildStudentQrForRecord,
  formatStudentRegime,
  generateStudentQrSvg,
  studentFullName,
  studentRegistrationNumber,
} from '@/utils/studentQr';

export type CardPrintDensity = 10 | 8;
export type CardSortOrder = 'lastName' | 'firstName' | 'regNumber';

export interface PrintableStudentCard {
  id: string;
  institutionName: string;
  directorate?: string;
  schoolYear: string;
  fullName: string;
  className: string;
  registrationNumber: string;
  regimeLabel: string;
  qrPayload: string;
}

export function sortStudentsForCards(students: Student[], order: CardSortOrder): Student[] {
  const list = [...students];
  if (order === 'firstName') {
    return list.sort(
      (a, b) =>
        a.firstName.localeCompare(b.firstName, 'ar', { sensitivity: 'base' }) ||
        a.lastName.localeCompare(b.lastName, 'ar', { sensitivity: 'base' }),
    );
  }
  if (order === 'regNumber') {
    return list.sort((a, b) =>
      studentRegistrationNumber(a).localeCompare(studentRegistrationNumber(b), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  }
  return list.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'ar', { sensitivity: 'base' }) ||
      a.firstName.localeCompare(b.firstName, 'ar', { sensitivity: 'base' }),
  );
}

export function requiredA4Pages(cardCount: number, density: CardPrintDensity): number {
  if (cardCount <= 0) return 0;
  return Math.ceil(cardCount / density);
}

export function toPrintableCard(
  student: Student,
  classNameLabel: string,
  institutionName: string,
  schoolYear: string,
  directorate?: string,
): PrintableStudentCard {
  return {
    id: student.id,
    institutionName,
    directorate,
    schoolYear,
    fullName: studentFullName(student),
    className: classNameLabel,
    registrationNumber: studentRegistrationNumber(student),
    regimeLabel: formatStudentRegime(student.boardingStatus),
    qrPayload: buildStudentQrForRecord(student, classNameLabel, schoolYear),
  };
}

export const CARDS_PER_A4_PAGE = 8;

const PRINT_CARDS_CSS = `
@page { size: A4 portrait; margin: 7mm 9mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #000000;
  font-family: Cairo, Arial, sans-serif;
  direction: rtl;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.qr-sheet {
  width: 192mm;
  margin: 0 auto;
  display: grid;
  justify-content: center;
  align-content: start;
  page-break-after: always;
  break-after: page;
}
.qr-sheet:last-child {
  page-break-after: auto;
  break-after: auto;
}
/* 10 cards per A4 page: 2 columns x 5 rows (CR80 standard ~86mm x 54mm) */
.qr-sheet--10 {
  grid-template-columns: repeat(2, 86mm);
  grid-auto-rows: 54mm;
  gap: 2mm 6mm;
}
/* 8 cards per A4 page: 2 columns x 4 rows (~92mm x 64mm, larger QR code) */
.qr-sheet--8 {
  grid-template-columns: repeat(2, 92mm);
  grid-auto-rows: 64mm;
  gap: 4mm 6mm;
}
/* Clean dashed cut-line wrapper + strict page-break protection */
.id-card-cut {
  border: 0.75pt dashed #64748b;
  padding: 1.4mm;
  background: #ffffff;
  break-inside: avoid;
  page-break-inside: avoid;
  display: flex;
}
.id-card {
  width: 100%;
  height: 100%;
  border: 0.9pt solid #0f172a;
  border-radius: 2mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: #000000;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Economical ink-saving header: white background + crisp dark text & hairline rule */
.id-card-header {
  background: #ffffff;
  color: #000000;
  border-bottom: 1pt solid #0f172a;
  padding: 1.4mm 2.6mm;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2mm;
}
.id-card-inst {
  font-size: 7.8pt;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id-card-year {
  font-size: 7pt;
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.id-card-sub {
  border-bottom: 0.5pt solid #cbd5e1;
  color: #0f172a;
  font-size: 6.8pt;
  font-weight: 700;
  text-align: center;
  padding: 0.5mm 2mm;
  background: #ffffff;
}
.id-card-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2.2mm;
  padding: 1.8mm 2.6mm;
  background: #ffffff;
}
.id-card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9mm;
}
.id-card-name {
  font-size: 9.2pt;
  font-weight: 700;
  color: #000000;
  line-height: 1.2;
  margin-bottom: 0.4mm;
  word-break: break-word;
}
.id-card-row {
  display: flex;
  align-items: baseline;
  gap: 1.2mm;
  font-size: 7.4pt;
  line-height: 1.25;
}
.id-card-label {
  color: #334155;
  font-weight: 600;
  white-space: nowrap;
}
.id-card-val {
  color: #000000;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id-card-qr {
  flex-shrink: 0;
  background: #ffffff;
  border: 0.5pt solid #94a3b8;
  border-radius: 1.2mm;
  padding: 0.6mm;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-sheet--10 .id-card-qr {
  width: 28mm;
  height: 28mm;
}
.qr-sheet--8 .id-card-qr {
  width: 34mm;
  height: 34mm;
}
.qr-sheet--8 .id-card-name {
  font-size: 10.2pt;
}
.qr-sheet--8 .id-card-row {
  font-size: 8pt;
  gap: 1.5mm;
}
.qr-sheet--8 .id-card-inst {
  font-size: 8.4pt;
}
.id-card-qr svg {
  width: 100%;
  height: 100%;
  display: block;
}
.id-card-footer {
  border-top: 0.5pt solid #cbd5e1;
  padding: 0.7mm 2.6mm;
  font-size: 6pt;
  color: #334155;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
}
@media print {
  header, nav, button, .no-print { display: none !important; }
  html, body { background: #ffffff !important; }
  .qr-sheet { box-shadow: none !important; margin: 0 auto !important; padding: 0 !important; }
}
@media screen {
  body { background: #f1f5f9; padding: 6mm; }
  .qr-sheet { background: #ffffff; box-shadow: 0 2px 10px rgba(0,0,0,0.08); margin-bottom: 8mm; padding: 5mm; }
}
`;

export function chunkCardsForA4<T>(cards: T[], perPage: number = CARDS_PER_A4_PAGE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < cards.length; index += perPage) {
    chunks.push(cards.slice(index, index + perPage));
  }
  return chunks;
}

export async function buildPrintableStudentCardsHtml(
  cards: PrintableStudentCard[],
  title: string,
  lang = 'ar',
  density: CardPrintDensity = 10,
): Promise<string> {
  const renderedCards = await Promise.all(
    cards.map(async (card) => {
      const qrSvg = await generateStudentQrSvg(card.qrPayload, 'M');
      return `<div class="id-card-cut">
  <article class="id-card">
    <div class="id-card-header">
      <div class="id-card-inst">${esc(card.institutionName)}</div>
      <div class="id-card-year" dir="ltr">${esc(card.schoolYear)}</div>
    </div>
    <div class="id-card-sub">بطاقة التلميذ</div>
    <div class="id-card-body">
      <div class="id-card-info">
        <div class="id-card-name">${esc(card.fullName)}</div>
        <div class="id-card-row">
          <span class="id-card-label">القسم:</span>
          <span class="id-card-val">${esc(card.className)}</span>
        </div>
        <div class="id-card-row">
          <span class="id-card-label">النظام:</span>
          <span class="id-card-val">${esc(card.regimeLabel)}</span>
        </div>
        <div class="id-card-row">
          <span class="id-card-label">رقم التسجيل:</span>
          <span class="id-card-val" dir="ltr">${esc(card.registrationNumber)}</span>
        </div>
      </div>
      <div class="id-card-qr" aria-label="QR">${qrSvg}</div>
    </div>
    <div class="id-card-footer">
      <span>${esc(card.directorate ?? '')}</span>
      <span dir="ltr">${esc(card.schoolYear)}</span>
    </div>
  </article>
</div>`;
    }),
  );

  const sheets = chunkCardsForA4(renderedCards, density)
    .map((sheetCards) => `<section class="qr-sheet qr-sheet--${density}">${sheetCards.join('')}</section>`)
    .join('');

  return `<!doctype html>
<html lang="${esc(lang)}" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>${PRINT_CARDS_CSS}</style>
</head>
<body>${sheets}</body>
</html>`;
}

export async function printStudentCardsA4(
  cards: PrintableStudentCard[],
  title: string,
  lang = 'ar',
  density: CardPrintDensity = 10,
): Promise<void> {
  if (cards.length === 0) return;
  const html = await buildPrintableStudentCardsHtml(cards, title, lang, density);

  if (isNativeApp) {
    const fileName = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'student-cards';
    await downloadBlob(new Blob([html], { type: 'text/html' }), `${fileName}.html`);
    return;
  }

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

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60_000);
  }, 300);
}

import type { Student } from '@/db/types';
import { esc } from '@/utils/dailyReportHtml';
import { downloadBlob } from '@/utils/download';
import { isNativeApp } from '@/utils/platform';
import {
  ALGERIA_FLAG_SVG,
  ALGERIA_MAP_WATERMARK_URL,
  CARD_TITLE_AR,
  GUILLOCHE_BG_SVG,
  MINISTRY_EMBLEM_SVG,
  MINISTRY_NAME_AR,
  REPUBLIC_NAME_AR,
  STUDENT_PHOTO_PLACEHOLDER_SVG,
} from '@/utils/studentCardArtwork';
import {
  buildStudentQrForRecord,
  formatCardBirthDate,
  formatCardBirthPlace,
  formatStudentGender,
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
  genderLabel?: string;
  dateOfBirth?: string;
  placeOfBirth?: string;
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
    genderLabel: formatStudentGender(student.gender),
    dateOfBirth: formatCardBirthDate(student.dateOfBirth),
    placeOfBirth: formatCardBirthPlace(student.placeOfBirth),
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
  color: #16201a;
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
  position: relative;
  width: 100%;
  height: 100%;
  border: 0.65pt solid #8a978c;
  border-radius: 2mm;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #e9eee9 0%, #f5f7f4 16%, #f3f6f2 84%, #e3e9e3 100%);
  color: #16201a;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Top Metallic Sage-Silver Header Band */
.id-card-header {
  position: relative;
  z-index: 2;
  background: linear-gradient(90deg, #b7c2b8 0%, #d4ddd5 26%, #e4e9e4 54%, #ccd6cd 82%, #bac6bb 100%);
  border-bottom: 0.65pt solid #7f8c81;
  box-shadow: inset 0 0.4pt 0 rgba(255, 255, 255, 0.7);
  padding: 1.1mm 2.2mm;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.4mm;
  height: 10.4mm;
}
.id-card-inst {
  max-width: 22%;
  font-size: 6.4pt;
  font-weight: 800;
  color: #1a241e;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id-card-ministry {
  display: flex;
  align-items: center;
  gap: 1.1mm;
  flex-shrink: 0;
}
.id-card-ministry-text {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.05;
}
.id-card-ministry-top {
  display: flex;
  align-items: center;
  gap: 0.8mm;
}
.id-card-flag {
  width: 3.1mm;
  height: 2.1mm;
  display: inline-block;
  flex-shrink: 0;
}
.id-card-flag svg { width: 100%; height: 100%; display: block; }
.id-card-rep-mini {
  font-size: 3.7pt;
  font-weight: 700;
  color: #253129;
  white-space: nowrap;
}
.id-card-ministry-name {
  font-size: 5.8pt;
  font-weight: 800;
  color: #141e18;
  margin-top: 0.35mm;
  white-space: nowrap;
}
.id-card-emblem {
  width: 6.4mm;
  height: 5.6mm;
  display: inline-block;
  flex-shrink: 0;
}
.id-card-emblem svg { width: 100%; height: 100%; display: block; }
.id-card-title {
  font-size: 8.6pt;
  font-weight: 800;
  color: #141e18;
  white-space: nowrap;
  flex-shrink: 0;
}
.id-card-year {
  font-size: 6.6pt;
  font-weight: 800;
  color: #1e2923;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
/* Body with Guilloche Security Curves & Algeria Map Watermark */
.id-card-body {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2mm;
  padding: 1.4mm 2.2mm;
  overflow: hidden;
}
.id-card-guilloche {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
.id-card-guilloche svg {
  width: 100%;
  height: 100%;
  display: block;
}
.id-card-map {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 0;
}
.id-card-map img {
  height: 95%;
  width: auto;
  display: block;
  object-fit: contain;
}
.id-card-info {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45mm;
}
.id-card-top-person {
  display: flex;
  align-items: flex-end;
  gap: 1.6mm;
  margin-bottom: 0.4mm;
}
.id-card-photo {
  width: 10.2mm;
  height: 11.8mm;
  border: 0.45pt solid #616e64;
  background: #ffffff;
  flex-shrink: 0;
  overflow: hidden;
}
.id-card-photo svg {
  width: 100%;
  height: 100%;
  display: block;
}
.id-card-name {
  flex: 1;
  min-width: 0;
  font-size: 8.2pt;
  font-weight: 800;
  color: #141d17;
  line-height: 1.15;
  padding-bottom: 0.6mm;
  word-break: break-word;
}
.id-card-row {
  display: flex;
  align-items: baseline;
  gap: 0.8mm;
  font-size: 6.1pt;
  line-height: 1.18;
}
.id-card-row--pair {
  gap: 2.0mm;
}
.id-card-pair-item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.7mm;
  min-width: 0;
}
.id-card-label {
  color: #2d3a32;
  font-weight: 700;
  white-space: nowrap;
}
.id-card-val {
  color: #111814;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Metallic Beveled Champagne-Silver QR Frame */
.id-card-qr-bezel {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  border-radius: 2mm;
  padding: 1.15mm;
  background: linear-gradient(145deg, #dbd7cb 0%, #8f8b7e 34%, #e8e5da 68%, #9d998b 100%);
  border: 0.45pt solid #6c695e;
  box-shadow: 0 0.8mm 1.8mm rgba(26, 36, 30, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
}
.id-card-qr {
  background: #ffffff;
  border-radius: 1.1mm;
  border: 0.35pt solid #b4b0a4;
  padding: 0.5mm;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.qr-sheet--10 .id-card-qr-bezel {
  width: 27.5mm;
  height: 27.5mm;
}
.qr-sheet--8 .id-card-header {
  height: 11.8mm;
  padding: 1.3mm 2.5mm;
}
.qr-sheet--8 .id-card-inst { font-size: 7.2pt; }
.qr-sheet--8 .id-card-rep-mini { font-size: 4.1pt; }
.qr-sheet--8 .id-card-ministry-name { font-size: 6.4pt; }
.qr-sheet--8 .id-card-emblem { width: 7.2mm; height: 6.3mm; }
.qr-sheet--8 .id-card-title { font-size: 9.6pt; }
.qr-sheet--8 .id-card-year { font-size: 7.4pt; }
.qr-sheet--8 .id-card-qr-bezel {
  width: 33.5mm;
  height: 33.5mm;
  padding: 1.3mm;
}
.qr-sheet--8 .id-card-photo {
  width: 12.2mm;
  height: 14.2mm;
}
.qr-sheet--8 .id-card-info {
  gap: 0.7mm;
}
.qr-sheet--8 .id-card-name {
  font-size: 9.4pt;
}
.qr-sheet--8 .id-card-row {
  font-size: 7.0pt;
  gap: 1.0mm;
}
.qr-sheet--8 .id-card-footer {
  height: 5.8mm;
  font-size: 6.4pt;
}
.id-card-qr svg {
  width: 100%;
  height: 100%;
  display: block;
}
/* Bottom Metallic Sage-Silver Footer Band */
.id-card-footer {
  position: relative;
  z-index: 2;
  height: 5.1mm;
  border-top: 0.65pt solid #7f8c81;
  background: linear-gradient(90deg, #b7c2b8 0%, #d4ddd5 28%, #e2e7e2 58%, #c7d1c8 100%);
  box-shadow: inset 0 0.4pt 0 rgba(255, 255, 255, 0.55);
  padding: 0 2.4mm;
  font-size: 5.8pt;
  font-weight: 800;
  color: #1a241e;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2mm;
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
      <div class="id-card-ministry">
        <div class="id-card-ministry-text">
          <div class="id-card-ministry-top">
            <span class="id-card-flag">${ALGERIA_FLAG_SVG}</span>
            <span class="id-card-rep-mini">${REPUBLIC_NAME_AR}</span>
          </div>
          <span class="id-card-ministry-name">${MINISTRY_NAME_AR}</span>
        </div>
        <span class="id-card-emblem">${MINISTRY_EMBLEM_SVG}</span>
      </div>
      <div class="id-card-title">${CARD_TITLE_AR}</div>
      <div class="id-card-year" dir="ltr">${esc(card.schoolYear)}</div>
    </div>
    <div class="id-card-body">
      <div class="id-card-guilloche" aria-hidden="true">${GUILLOCHE_BG_SVG}</div>
      <div class="id-card-map" aria-hidden="true"><img src="${ALGERIA_MAP_WATERMARK_URL}" alt="" /></div>
      <div class="id-card-info">
        <div class="id-card-top-person">
          <div class="id-card-photo" aria-hidden="true">${STUDENT_PHOTO_PLACEHOLDER_SVG}</div>
          <div class="id-card-name">${esc(card.fullName)}</div>
        </div>
        <div class="id-card-row id-card-row--pair">
          <span class="id-card-pair-item">
            <span class="id-card-label">القسم:</span>
            <span class="id-card-val">${esc(card.className)}</span>
          </span>
          <span class="id-card-pair-item">
            <span class="id-card-label">الجنس:</span>
            <span class="id-card-val">${esc(card.genderLabel ?? '—')}</span>
          </span>
        </div>
        <div class="id-card-row">
          <span class="id-card-label">تاريخ الميلاد:</span>
          <span class="id-card-val" dir="ltr">${esc(card.dateOfBirth ?? '—')}</span>
        </div>
        <div class="id-card-row">
          <span class="id-card-label">مكان الميلاد:</span>
          <span class="id-card-val">${esc(card.placeOfBirth ?? '—')}</span>
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
      <div class="id-card-qr-bezel" aria-label="QR">
        <div class="id-card-qr">${qrSvg}</div>
      </div>
    </div>
    <div class="id-card-footer">
      <span>${REPUBLIC_NAME_AR}</span>
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

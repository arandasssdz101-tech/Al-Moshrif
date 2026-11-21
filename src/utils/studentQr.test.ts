import { describe, expect, it } from 'vitest';
import { isCardAbsenceEnabled } from '@/db/institutions';
import type { Student } from '@/db/types';
import { findStudentByCode } from '@/utils/canteen';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  buildStudentCardsPdfBlob,
  cardSlotPosition,
  getA4CardLayout,
} from '@/utils/studentCardsPdf';
import {
  buildPrintableStudentCardsHtml,
  chunkCardsForA4,
  requiredA4Pages,
  sortStudentsForCards,
  toPrintableCard,
} from '@/utils/studentCardsPrint';
import {
  buildStudentQrForRecord,
  buildStudentQrPayload,
  formatCardBirthDate,
  formatCardBirthPlace,
  formatStudentGender,
  formatStudentRegime,
  generateStudentQrSvg,
  matchStudentFromScan,
  normalizeScannedCode,
  parseStudentQrPayload,
} from '@/utils/studentQr';

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu-101',
    institutionId: 'inst-1',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
    deletedAt: null,
    updatedBy: 'user-1',
    firstName: 'أحمد',
    lastName: 'بن سالم',
    gender: 'male',
    dateOfBirth: '2013-04-10',
    placeOfBirth: 'العفرون',
    repeater: false,
    boardingStatus: 'half-boarder',
    classId: 'cls-1',
    joinDate: '2026-09-01',
    leaveDate: null,
    cardCode: 'REG-2026-001',
    ...overrides,
  };
}

describe('Student ID & QR Cards utilities', () => {
  it('encodes and parses structured UTF-8 student QR payloads accurately', () => {
    const student = makeStudent();
    const payload = buildStudentQrForRecord(student, '1م1', '2026/2025');
    expect(payload).toBe('ID:stu-101|NAME:أحمد بن سالم|CLASS:1م1|REGIME:نصف داخلي|YEAR:2026/2025');

    const parsed = parseStudentQrPayload(payload);
    expect(parsed).toEqual({
      id: 'stu-101',
      name: 'أحمد بن سالم',
      className: '1م1',
      regime: 'نصف داخلي',
      year: '2026/2025',
    });
  });

  it('formats all supported regime labels including boarder', () => {
    expect(formatStudentRegime('half-boarder')).toBe('نصف داخلي');
    expect(formatStudentRegime('boarder')).toBe('داخلي');
    expect(formatStudentRegime('external')).toBe('خارجي');
  });

  it('matches students from structured QR payloads, NIN payloads, cardCode, and student ID', () => {
    const s1 = makeStudent({ id: 'stu-101', cardCode: 'REG-001' });
    const s2 = makeStudent({ id: 'stu-202', firstName: 'سارة', lastName: 'مراد', boardingStatus: 'external', cardCode: '998877' });
    const students = [s1, s2];

    const qrPayload = buildStudentQrPayload({
      id: 'stu-101',
      fullName: 'أحمد بن سالم',
      className: '1م1',
      regime: 'نصف داخلي',
      schoolYear: '2026/2025',
    });

    expect(matchStudentFromScan(students, qrPayload)?.id).toBe('stu-101');
    expect(findStudentByCode(students, qrPayload, 'cardCode')?.id).toBe('stu-101');
    expect(matchStudentFromScan(students, 'NIN:998877|اسم:سارة مراد')?.id).toBe('stu-202');
    expect(matchStudentFromScan(students, 'REG-001')?.id).toBe('stu-101');
    expect(matchStudentFromScan(students, 'stu-202')?.id).toBe('stu-202');
    expect(matchStudentFromScan(students, 'ID:unknown|NAME:X')).toBeNull();
  });

  it('sorts students by lastName, firstName, and registration number', () => {
    const a = makeStudent({ id: 's1', firstName: 'يوسف', lastName: 'أمين', cardCode: '10' });
    const b = makeStudent({ id: 's2', firstName: 'آدم', lastName: 'عمراني', cardCode: '2' });
    const c = makeStudent({ id: 's3', firstName: 'بشير', lastName: 'بن علي', cardCode: '3' });

    expect(sortStudentsForCards([b, c, a], 'lastName').map((s) => s.id)).toEqual(['s1', 's3', 's2']);
    expect(sortStudentsForCards([a, c, b], 'firstName').map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect(sortStudentsForCards([a, c, b], 'regNumber').map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });

  it('generates crisp UTF-8 SVG QR codes with clean white quiet-zone margin', async () => {
    const payload = 'ID:stu-101|NAME:أحمد بن سالم|CLASS:1م1|REGIME:نصف داخلي|YEAR:2026/2025';
    const svg = await generateStudentQrSvg(payload, 'H');
    expect(svg).toContain('<svg');
    expect(svg.toLowerCase()).toContain('#ffffff');
    expect(svg.toLowerCase()).toContain('#000000');
  });

  it('computes A4 sheet counts and generates economical 10-card and 8-card layouts with dashed cut-lines', async () => {
    expect(requiredA4Pages(40, 10)).toBe(4);
    expect(requiredA4Pages(40, 8)).toBe(5);
    expect(requiredA4Pages(0, 10)).toBe(0);

    const cards = Array.from({ length: 12 }, (_, index) => ({
      id: `stu-${index + 1}`,
      institutionName: 'متوسطة بولعراس رابح',
      directorate: 'مديرية التربية لولاية البليدة',
      schoolYear: '2026/2025',
      fullName: `تلميذ ${index + 1}`,
      className: '4م3',
      registrationNumber: `REG-${index + 1}`,
      regimeLabel: 'نصف داخلي',
      qrPayload: `ID:stu-${index + 1}|NAME:تلميذ ${index + 1}|CLASS:4م3|REGIME:نصف داخلي|YEAR:2026/2025`,
    }));

    // 10 cards per A4 sheet (2x5) -> 12 cards = 2 sheets (10 + 2)
    expect(chunkCardsForA4(cards, 10).map((sheet) => sheet.length)).toEqual([10, 2]);
    const html10 = await buildPrintableStudentCardsHtml(cards, 'بطاقات 4م3', 'ar', 10);
    expect(html10).toContain('qr-sheet--10');
    expect(html10).toContain('dashed');
    expect(html10).toContain('break-inside: avoid');
    expect(html10).toContain('page-break-inside: avoid');
    expect((html10.match(/class="qr-sheet qr-sheet--10"/g) ?? []).length).toBe(2);
    expect((html10.match(/class="id-card-cut"/g) ?? []).length).toBe(12);

    // 8 cards per A4 sheet (2x4) -> 12 cards = 2 sheets (8 + 4)
    expect(chunkCardsForA4(cards, 8).map((sheet) => sheet.length)).toEqual([8, 4]);
    const html8 = await buildPrintableStudentCardsHtml(cards, 'بطاقات 4م3', 'ar', 8);
    expect(html8).toContain('qr-sheet--8');
    expect((html8.match(/class="qr-sheet qr-sheet--8"/g) ?? []).length).toBe(2);
  });

  it('keeps A4 PDF card grid slots strictly within 210x297mm bounds and generates a valid multi-page PDF blob', async () => {
    for (const density of [10, 8] as const) {
      const layout = getA4CardLayout(density);
      expect(layout.cols * layout.rows).toBe(density);
      expect(layout.marginX).toBeGreaterThan(0);
      expect(layout.marginY).toBeGreaterThan(0);

      for (let i = 0; i < density; i += 1) {
        const pos = cardSlotPosition(layout, i, true);
        expect(pos.cellX).toBeGreaterThanOrEqual(0);
        expect(pos.cellY).toBeGreaterThanOrEqual(0);
        expect(pos.cellX + layout.cellW).toBeLessThanOrEqual(A4_WIDTH_MM);
        expect(pos.cellY + layout.cellH).toBeLessThanOrEqual(A4_HEIGHT_MM);
      }
      // First card sits on the right column in RTL mode
      expect(cardSlotPosition(layout, 0, true).cellX).toBeGreaterThan(cardSlotPosition(layout, 1, true).cellX);
    }

    const cards = Array.from({ length: 12 }, (_, index) => ({
      id: `stu-${index + 1}`,
      institutionName: 'متوسطة بولعراس رابح',
      directorate: 'مديرية التربية لولاية البليدة',
      schoolYear: '2026/2025',
      fullName: `تلميذ ${index + 1}`,
      className: '4م3',
      registrationNumber: `REG-${index + 1}`,
      regimeLabel: 'نصف داخلي',
      qrPayload: `ID:stu-${index + 1}|NAME:تلميذ ${index + 1}|CLASS:4م3|REGIME:نصف داخلي|YEAR:2026/2025`,
    }));

    const pdfBlob = await buildStudentCardsPdfBlob(cards, 'بطاقات 4م3', 10);
    expect(pdfBlob.type).toBe('application/pdf');
    expect(pdfBlob.size).toBeGreaterThan(1000);
    const pdfText = new TextDecoder('latin1').decode(await pdfBlob.arrayBuffer());
    expect(pdfText.startsWith('%PDF-')).toBe(true);
    // 12 cards at 10 per A4 page => 2 PDF pages
    expect(pdfText).toContain('/Count 2');
  });

  it('defaults card-based absence recording to enabled and respects explicit disable', () => {
    expect(isCardAbsenceEnabled({})).toBe(true);
    expect(isCardAbsenceEnabled({ cardAbsenceEnabled: undefined })).toBe(true);
    expect(isCardAbsenceEnabled({ cardAbsenceEnabled: true })).toBe(true);
    expect(isCardAbsenceEnabled({ cardAbsenceEnabled: false })).toBe(false);
  });

  it('normalizes scanned text: trims, strips control chars/newlines, converts Arabic-Indic digits, and handles optional French AZERTY digits', () => {
    expect(normalizeScannedCode('  \u0000\tREG-٢٠٢٦-٠٠١\r\n ')).toBe('REG-2026-001');
    expect(normalizeScannedCode('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');

    // French AZERTY top-row symbols-only string converts to 1234567890 by default
    expect(normalizeScannedCode('&é"\'(-è_çà\r\n')).toBe('1234567890');
    expect(normalizeScannedCode('&é"\'(-è_çà', { convertAzertyDigits: false })).toBe('&é"\'(-è_çà');

    // Structured QR payloads containing hyphens must NOT be altered by AZERTY digit conversion
    const structured = 'ID:stu-101|NAME:أحمد بن سالم|CLASS:1م1|REGIME:نصف داخلي|YEAR:2026/2025';
    expect(normalizeScannedCode(` ${structured}\r\n`)).toBe(structured);
  });

  it('includes gender, date of birth, and place of birth on printable cards', async () => {
    expect(formatStudentGender('male')).toBe('ذكر');
    expect(formatStudentGender('female')).toBe('أنثى');
    expect(formatCardBirthDate('2013-04-10')).toBe('10/04/2013');
    expect(formatCardBirthDate(null)).toBe('—');
    expect(formatCardBirthPlace('العفرون')).toBe('العفرون');
    expect(formatCardBirthPlace('')).toBe('—');

    const student = makeStudent({ gender: 'female', dateOfBirth: '2012-11-05', placeOfBirth: 'البليدة' });
    const card = toPrintableCard(student, '4م3', 'متوسطة بولعراس رابح', '2026/2025');
    expect(card.genderLabel).toBe('أنثى');
    expect(card.dateOfBirth).toBe('05/11/2012');
    expect(card.placeOfBirth).toBe('البليدة');

    const html = await buildPrintableStudentCardsHtml([card], 'بطاقة تلميذ', 'ar', 10);
    expect(html).toContain('الجنس:');
    expect(html).toContain('أنثى');
    expect(html).toContain('تاريخ الميلاد:');
    expect(html).toContain('05/11/2012');
    expect(html).toContain('مكان الميلاد:');
    expect(html).toContain('البليدة');
    expect(html).toContain('وزارة التربية الوطنية');
    expect(html).toContain('الجمهورية الجزائرية الديمقراطية الشعبية');
    expect(html).toContain('id-card-photo');
    expect(html).toContain('id-card-map');
    expect(html).toContain('id-card-qr-bezel');
  });
});

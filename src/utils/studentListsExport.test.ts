import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { SchoolClass, Student } from '@/db/types';
import {
  buildClassStudentLists,
  buildExportFileName,
  buildStudentListsExcelBuffer,
  buildStudentListsPdfBlob,
  formatExportDate,
  paginateClassListsForPdf,
  sanitizeSheetName,
  type StudentListExportLabels,
} from '@/utils/studentListsExport';

const AR_LABELS: StudentListExportLabels = {
  columns: {
    index: 'الرقم',
    lastName: 'اللقب',
    firstName: 'الاسم',
    dateOfBirth: 'تاريخ الميلاد',
    placeOfBirth: 'مكان الميلاد',
    boardingStatus: 'الصفة',
    repeater: 'الإعادة',
    gender: 'الجنس',
  },
  gender: { male: 'ذكر', female: 'أنثى' },
  boarding: { 'half-boarder': 'نصف داخلي', external: 'خارجي' },
  yes: 'نعم',
  no: 'لا',
  listHeading: (className) => `قائمة تلاميذ القسم: ${className}`,
  continuation: '(تتمة)',
  schoolYearLabel: 'السنة الدراسية',
  exportDateLabel: 'تاريخ التصدير',
  institutionLabel: 'المؤسسة',
  pageOf: (page, total) => `صفحة ${page} من ${total}`,
  totals: {
    total: 'المجموع',
    males: 'الذكور',
    females: 'الإناث',
    halfBoarders: 'نصف داخلي',
    externals: 'خارجي',
    repeaters: 'المعيدون',
  },
  fileSinglePrefix: 'قائمة-تلاميذ',
  fileAllPrefix: 'قوائم-التلاميذ-حسب-القسم',
};

const CLASSES: SchoolClass[] = [
  {
    id: 'c2',
    institutionId: 'inst-1',
    name: '2م1',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    deletedAt: null,
    updatedBy: 'u1',
  },
  {
    id: 'c1',
    institutionId: 'inst-1',
    name: '1م1',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    deletedAt: null,
    updatedBy: 'u1',
  },
];

function makeStudent(overrides: Partial<Student>): Student {
  return {
    id: 's1',
    institutionId: 'inst-1',
    classId: 'c1',
    firstName: 'أحمد',
    lastName: 'بن علي',
    gender: 'male',
    dateOfBirth: '2012-05-14',
    placeOfBirth: 'الجزائر',
    repeater: false,
    boardingStatus: 'half-boarder',
    joinDate: '2026-09-01',
    leaveDate: null,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    deletedAt: null,
    updatedBy: 'u1',
    ...overrides,
  };
}

describe('studentListsExport', () => {
  it('groups students by class, sorts alphabetically, formats fields, and filters left students', () => {
    const students: Student[] = [
      makeStudent({ id: 's1', classId: 'c1', lastName: 'زيدان', firstName: 'كريم', repeater: true, boardingStatus: 'external', gender: 'male' }),
      makeStudent({ id: 's2', classId: 'c1', lastName: 'بن علي', firstName: 'مريم', dateOfBirth: '2013-02-09', placeOfBirth: 'وهران', repeater: false, boardingStatus: 'half-boarder', gender: 'female' }),
      makeStudent({ id: 's3', classId: 'c1', lastName: 'غائب', firstName: 'سمير', leaveDate: '2026-10-01' }),
      makeStudent({ id: 's4', classId: 'c2', lastName: 'حداد', firstName: 'يوسف', dateOfBirth: null, placeOfBirth: '' }),
    ];

    const lists = buildClassStudentLists({
      classes: CLASSES,
      students,
      selectedClassId: null,
      includeLeft: false,
      today: '2026-11-22',
      lang: 'ar',
      labels: AR_LABELS,
    });

    expect(lists.map((item) => item.className)).toEqual(['1م1', '2م1']);
    expect(lists[0].rows).toEqual([
      {
        index: 1,
        lastName: 'بن علي',
        firstName: 'مريم',
        dateOfBirth: '09/02/2013',
        placeOfBirth: 'وهران',
        boardingStatus: 'نصف داخلي',
        repeater: 'لا',
        gender: 'أنثى',
      },
      {
        index: 2,
        lastName: 'زيدان',
        firstName: 'كريم',
        dateOfBirth: '14/05/2012',
        placeOfBirth: 'الجزائر',
        boardingStatus: 'خارجي',
        repeater: 'نعم',
        gender: 'ذكر',
      },
    ]);
    expect(lists[0].stats).toEqual({
      total: 2,
      males: 1,
      females: 1,
      halfBoarders: 1,
      externals: 1,
      repeaters: 1,
    });
    expect(lists[1].rows[0].dateOfBirth).toBe('—');
    expect(lists[1].rows[0].placeOfBirth).toBe('—');

    const withLeft = buildClassStudentLists({
      classes: CLASSES,
      students,
      selectedClassId: 'c1',
      includeLeft: true,
      today: '2026-11-22',
      lang: 'ar',
      labels: AR_LABELS,
    });
    expect(withLeft).toHaveLength(1);
    expect(withLeft[0].rows).toHaveLength(3);
  });

  it('builds a valid multi-sheet RTL Excel workbook with all requested columns', async () => {
    const students: Student[] = [
      makeStudent({ id: 's1', classId: 'c1', lastName: 'بن علي', firstName: 'أحمد' }),
      makeStudent({ id: 's2', classId: 'c2', lastName: 'حداد', firstName: 'سارة', gender: 'female', boardingStatus: 'external', repeater: true }),
    ];
    const lists = buildClassStudentLists({
      classes: CLASSES,
      students,
      selectedClassId: null,
      includeLeft: false,
      today: '2026-11-22',
      lang: 'ar',
      labels: AR_LABELS,
    });

    const bytes = await buildStudentListsExcelBuffer(
      lists,
      {
        institutionName: 'متوسطة الشهيد بن بولعيد',
        directorate: 'مديرية التربية لولاية الجزائر',
        schoolYear: '2026/2027',
        exportDate: '2026-11-22',
        lang: 'ar',
      },
      AR_LABELS,
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['1م1', '2م1']);

    const ws1 = wb.worksheets[0];
    expect(ws1.views[0]?.rightToLeft).toBe(true);
    expect(ws1.getRow(5).values).toEqual([
      undefined,
      'الرقم',
      'اللقب',
      'الاسم',
      'تاريخ الميلاد',
      'مكان الميلاد',
      'الصفة',
      'الإعادة',
      'الجنس',
    ]);
    expect(ws1.getRow(6).values).toEqual([
      undefined,
      1,
      'بن علي',
      'أحمد',
      '14/05/2012',
      'الجزائر',
      'نصف داخلي',
      'لا',
      'ذكر',
    ]);
  });

  it('paginates large classes across A4 pages and builds a valid PDF blob', async () => {
    const manyStudents = Array.from({ length: 42 }, (_, idx) =>
      makeStudent({
        id: `s-${idx}`,
        classId: 'c1',
        lastName: `لقب ${idx + 1}`,
        firstName: `اسم ${idx + 1}`,
      }),
    );

    const lists = buildClassStudentLists({
      classes: [CLASSES[1]],
      students: manyStudents,
      selectedClassId: 'c1',
      includeLeft: false,
      today: '2026-11-22',
      lang: 'ar',
      labels: AR_LABELS,
    });

    const slices = paginateClassListsForPdf(lists);
    expect(slices).toHaveLength(2);
    expect(slices[0].isFirstOfClass).toBe(true);
    expect(slices[0].isLastOfClass).toBe(false);
    expect(slices[1].isFirstOfClass).toBe(false);
    expect(slices[1].isLastOfClass).toBe(true);
    expect(slices[0].rows.length + slices[1].rows.length).toBe(42);

    const blob = await buildStudentListsPdfBlob(
      lists,
      {
        institutionName: 'متوسطة الشهيد بن بولعيد',
        schoolYear: '2026/2027',
        exportDate: '2026-11-22',
        lang: 'ar',
      },
      AR_LABELS,
    );
    expect(blob.size).toBeGreaterThan(500);
    expect(blob.type).toBe('application/pdf');
  });

  it('sanitizes Excel sheet names, dates, and export filenames cleanly', () => {
    const used = new Set<string>();
    expect(sanitizeSheetName('1م/1:*?', used)).toBe('1م 1');
    expect(sanitizeSheetName('1م/1:*?', used)).toBe('1م 1 (2)');
    expect(formatExportDate('2012-05-14')).toBe('14/05/2012');
    expect(formatExportDate(null)).toBe('—');

    const lists = buildClassStudentLists({
      classes: [CLASSES[1]],
      students: [makeStudent({ classId: 'c1' })],
      selectedClassId: 'c1',
      includeLeft: false,
      today: '2026-11-22',
      lang: 'ar',
      labels: AR_LABELS,
    });
    expect(buildExportFileName(lists, '2026-11-22', AR_LABELS, 'pdf')).toBe('قائمة-تلاميذ-1م1-2026-11-22.pdf');
    expect(buildExportFileName(lists, '2026-11-22', AR_LABELS, 'xlsx')).toBe('قائمة-تلاميذ-1م1-2026-11-22.xlsx');
  });
});

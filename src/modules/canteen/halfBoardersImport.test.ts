import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseDateCell,
  parseBoardingCell,
  detectHbMapping,
  matchStudent,
  buildHbPreviewRows,
  findHalfBoardersMissingFromImport,
  buildHalfBoarderTemplate,
  buildHalfBoarderExportRows,
} from '@/modules/canteen/halfBoardersImport';
import type { SchoolClass, Student } from '@/db/types';

const T = '2026-11-08';

function makeClass(id: string, name: string): SchoolClass {
  return {
    id,
    institutionId: 'inst',
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
    updatedBy: null,
    name,
    level: null,
  };
}

function makeStudent(id: string, firstName: string, lastName: string, dateOfBirth: string | null, classId: string, cardCode?: string): Student {
  return {
    id,
    institutionId: 'inst',
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
    updatedBy: null,
    firstName,
    lastName,
    gender: 'male',
    dateOfBirth,
    placeOfBirth: '',
    repeater: false,
    boardingStatus: 'half-boarder',
    classId,
    joinDate: null,
    leaveDate: null,
    cardCode: cardCode ?? null,
  };
}

describe('parseDateCell', () => {
  it('parses dd/mm/yyyy', () => {
    expect(parseDateCell('15/03/2010')).toEqual({ value: '2010-03-15', valid: true });
  });

  it('parses d-m-yyyy', () => {
    expect(parseDateCell('5-3-2010')).toEqual({ value: '2010-03-05', valid: true });
  });

  it('parses yyyy-mm-dd', () => {
    expect(parseDateCell('2010-03-15')).toEqual({ value: '2010-03-15', valid: true });
  });

  it('parses Excel serial number', () => {
    expect(parseDateCell(40252)).toEqual({ value: '2010-03-15', valid: true });
  });

  it('parses Date object', () => {
    const d = new Date(Date.UTC(2010, 2, 15));
    expect(parseDateCell(d)).toEqual({ value: '2010-03-15', valid: true });
  });

  it('returns invalid for bad text', () => {
    expect(parseDateCell('not-a-date')).toEqual({ value: null, valid: false });
  });

  it('returns valid null for empty string', () => {
    expect(parseDateCell('')).toEqual({ value: null, valid: true });
  });
});

describe('detectHbMapping', () => {
  it('detects Arabic headers', () => {
    const headers = ['الاسم', 'اللقب', 'تاريخ الميلاد', 'القسم', 'كود البطاقة'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });

  it('detects English headers', () => {
    const headers = ['First name', 'Last name', 'Date of birth', 'Class name', 'Card code'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });

  it('detects variant aliases', () => {
    const headers = ['الإسم', 'النسب', 'تاريخ الازدياد', 'الفوج', 'رقم البطاقة'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });

  it('detects English aliases', () => {
    const headers = ['first', 'surname', 'dob', 'grade', 'barcode'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });

  it('detects new requested aliases: التلميذ, Name, Family, Birth, Date, ID', () => {
    const headers = ['التلميذ', 'Family', 'Birth', 'Group', 'ID'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });

  it('detects single Name column as firstName', () => {
    const headers = ['Name', 'Date of birth', 'Class'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.dateOfBirth).toBe(1);
    expect(mapping.className).toBe(2);
  });

  it('fuzzy matches partial headers', () => {
    const headers = ['Student First Name', 'Student Family Name', 'Date of Birth', 'Class Name', 'Card Barcode'];
    const mapping = detectHbMapping(headers);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.className).toBe(3);
    expect(mapping.cardCode).toBe(4);
  });
});

describe('matchStudent', () => {
  const classes = [makeClass('c1', '1م1'), makeClass('c2', '2م1')];
  const existing = [
    makeStudent('s1', 'محمد', 'العربي', '2010-03-15', 'c1'),
    makeStudent('s2', 'أحمد', 'بن علي', '2009-01-10', 'c2', '123456'),
  ];

  it('matches by name and birth date', () => {
    expect(matchStudent('محمد', 'العربي', '2010-03-15', null, existing, classes)?.id).toBe('s1');
  });

  it('matches with Arabic normalization (أ vs ا)', () => {
    expect(matchStudent('احمد', 'بن علي', '2009-01-10', null, existing, classes)?.id).toBe('s2');
  });

  it('matches by name and class when no birth date', () => {
    expect(matchStudent('محمد', 'العربي', null, '1م1', existing, classes)?.id).toBe('s1');
  });

  it('returns null when no match', () => {
    expect(matchStudent('غير', 'موجود', '2010-03-15', null, existing, classes)).toBeNull();
  });
});

describe('buildHbPreviewRows', () => {
  const classes = [makeClass('c1', '1م1')];
  const existing = [makeStudent('s1', 'محمد', 'العربي', '2010-03-15', 'c1', '111')];
  const mapping = { firstName: 0, lastName: 1, dateOfBirth: 2, className: 3, cardCode: 4 };

  it('marks matched student as update', () => {
    const rows = buildHbPreviewRows({
      rows: [['محمد', 'العربي', '15/03/2010', '1م1', '222']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('update');
    expect(rows[0].matchedStudent?.id).toBe('s1');
    expect(rows[0].input).not.toBeNull();
    expect(rows[0].input?.cardCode).toBe('222');
    expect(rows[0].input?.firstName).toBe('محمد');
    expect(rows[0].input?.lastName).toBe('العربي');
    expect(rows[0].input?.dateOfBirth).toBe('2010-03-15');
    expect(rows[0].input?.classId).toBe('c1');
    expect(rows[0].input?.boardingStatus).toBe('half-boarder');
  });

  it('automatically skips/excludes unregistered students not found in Students list', () => {
    const rows = buildHbPreviewRows({
      rows: [['سامي', 'جديد', '15/03/2011', '1م1', '333']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('skipped');
    expect(rows[0].matchedStudent).toBeNull();
    expect(rows[0].input).toBeNull();
  });

  it('reports error for missing first name', () => {
    const rows = buildHbPreviewRows({
      rows: [['', 'العربي', '15/03/2010', '1م1', '444']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows[0].action).toBe('error');
    expect(rows[0].issues.some((i) => i.key === 'missingName')).toBe(true);
  });

  it('matches registered student even when optional cells are empty and preserves data', () => {
    const rows = buildHbPreviewRows({
      rows: [['محمد', 'العربي', '', '', '']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows[0].action).toBe('update');
    expect(rows[0].input?.dateOfBirth).toBe('2010-03-15');
    expect(rows[0].input?.classId).toBe('c1');
    expect(rows[0].input?.cardCode).toBe('111');
  });

  it('reports warning for duplicate card code in file between two matched students', () => {
    const twoExisting = [
      ...existing,
      makeStudent('s2', 'علي', 'أحمد', '2011-03-15', 'c1', '222'),
    ];
    const rows = buildHbPreviewRows({
      rows: [
        ['محمد', 'العربي', '15/03/2010', '1م1', '999'],
        ['علي', 'أحمد', '15/03/2011', '1م1', '999'],
      ],
      mapping,
      classes,
      existing: twoExisting,
      today: T,
    });
    expect(rows[0].action).toBe('update');
    expect(rows[1].action).toBe('update');
    expect(rows[1].issues.some((i) => i.key === 'duplicateInFile')).toBe(true);
  });

  it('reports warning for duplicate card code already used by another student', () => {
    const twoExisting = [
      ...existing,
      makeStudent('s2', 'سامي', 'جديد', '2011-03-15', 'c1'),
    ];
    const rows = buildHbPreviewRows({
      rows: [['سامي', 'جديد', '15/03/2011', '1م1', '111']],
      mapping,
      classes,
      existing: twoExisting,
      today: T,
    });
    expect(rows[0].issues.some((i) => i.key === 'duplicateExisting')).toBe(true);
    expect(rows[0].action).toBe('update');
  });

  it('preserves leading zeros in card code on matched student', () => {
    const rows = buildHbPreviewRows({
      rows: [['محمد', 'العربي', '15/03/2010', '1م1', '007']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows[0].input?.cardCode).toBe('007');
  });

  it('reads numeric card code as string on matched student', () => {
    const rows = buildHbPreviewRows({
      rows: [['محمد', 'العربي', '15/03/2010', '1م1', 123456]],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows[0].input?.cardCode).toBe('123456');
  });

  it('skips empty rows', () => {
    const rows = buildHbPreviewRows({
      rows: [['', '', '', '', '']],
      mapping,
      classes,
      existing,
      today: T,
    });
    expect(rows).toHaveLength(0);
  });

  it('splits single full name column into first and last name to match student', () => {
    const singleNameMapping = { firstName: 0, dateOfBirth: 1, className: 2, cardCode: 3 };
    const rows = buildHbPreviewRows({
      rows: [['محمد العربي', '15/03/2010', '1م1', '888']],
      mapping: singleNameMapping,
      classes,
      existing,
      today: T,
    });
    expect(rows[0].action).toBe('update');
    expect(rows[0].input?.firstName).toBe('محمد');
    expect(rows[0].input?.lastName).toBe('العربي');
  });

  it('finds existing half-boarders missing from import to convert them to external', () => {
    const students: Student[] = [
      makeStudent('s1', 'محمد', 'العربي', '2010-03-15', 'c1', '111'), // half-boarder & in file
      makeStudent('s2', 'أحمد', 'بن علي', '2010-05-10', 'c1', '222'), // half-boarder & NOT in file -> external
      { ...makeStudent('s3', 'كريم', 'سعيد', '2010-08-20', 'c1'), boardingStatus: 'external' }, // already external
    ];
    const rows = buildHbPreviewRows({
      rows: [
        ['محمد', 'العربي', '15/03/2010', '1م1', '111'],
        ['تلميذ', 'غير مسجل', '15/03/2010', '1م1', '999'],
      ],
      mapping,
      classes,
      existing: students,
      today: T,
    });

    expect(rows[0].action).toBe('update');
    expect(rows[1].action).toBe('skipped');

    const missing = findHalfBoardersMissingFromImport(students, rows);
    expect(missing.map((s) => s.id)).toEqual(['s2']);
  });

  it('detects and parses boardingStatus (الصفة) column in headers, rows, template, and export', () => {
    const headers = ['الاسم', 'اللقب', 'تاريخ الميلاد', 'القسم', 'الصفة', 'كود البطاقة'];
    const detected = detectHbMapping(headers);
    expect(detected.boardingStatus).toBe(4);
    expect(detected.cardCode).toBe(5);

    expect(parseBoardingCell('نصف داخلي')).toEqual({ value: 'half-boarder', valid: true });
    expect(parseBoardingCell('ممنوح')).toEqual({ value: 'half-boarder', valid: true });
    expect(parseBoardingCell('خارجي')).toEqual({ value: 'external', valid: true });
    expect(parseBoardingCell('')).toEqual({ value: 'half-boarder', valid: true });
    expect(parseBoardingCell('قيمة غريبة')).toEqual({ value: 'half-boarder', valid: false });

    const wbAr = buildHalfBoarderTemplate('ar');
    const sheetAr = XLSX.utils.sheet_to_json<string[]>(wbAr.Sheets['نصف الداخليين'], { header: 1 });
    expect(sheetAr[0]).toContain('الصفة');
    expect(sheetAr[1]).toContain('نصف داخلي');

    const exported = buildHalfBoarderExportRows(existing, classes, 'ar');
    expect(exported[0]['الصفة']).toBe('نصف داخلي');
  });

  it('detects class conflict for matched student and auto-corrects classId to student registered class', () => {
    const twoClasses = [makeClass('c1', '1م1'), makeClass('c2', '2م1')];
    const rows = buildHbPreviewRows({
      rows: [
        ['محمد', 'العربي', '15/03/2010', '2م1', '111'],
        ['محمد', 'العربي', '', 'قسم خاطئ', ''],
      ],
      mapping,
      classes: twoClasses,
      existing,
      today: T,
    });

    // Matched by name+DOB, class in file (2م1) conflicts with registered class (1م1)
    expect(rows[0].action).toBe('update');
    expect(rows[0].classConflict).toEqual({
      fileClassName: '2م1',
      fileClassId: 'c2',
      registeredClassId: 'c1',
      registeredClassName: '1م1',
    });
    expect(rows[0].input?.classId).toBe('c1');
    // Keeping the student's own card code '111' should not trigger duplicateExisting
    expect(rows[0].issues).toEqual([]);

    // Matched by unique name even without DOB and with an unknown class string -> corrected to registered class c1
    expect(rows[1].action).toBe('update');
    expect(rows[1].classConflict).toEqual({
      fileClassName: 'قسم خاطئ',
      fileClassId: null,
      registeredClassId: 'c1',
      registeredClassName: '1م1',
    });
    expect(rows[1].input?.classId).toBe('c1');
    expect(rows[1].issues).toEqual([]);
  });
});

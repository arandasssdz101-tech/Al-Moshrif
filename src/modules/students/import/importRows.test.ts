import { describe, expect, it } from 'vitest';
import type { SchoolClass, Student, StudentInput } from '@/db/types';
import {
  buildPreviewRows,
  findExtraExistingStudents,
  planStudentImport,
  type ColumnMapping,
} from './importRows';

const BASE = {
  institutionId: 'inst-1',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  deletedAt: null,
  updatedBy: 'head-1',
};

const CLASSES: SchoolClass[] = [
  { ...BASE, id: 'c1', name: '1م1', level: 1 },
  { ...BASE, id: 'c2', name: '1م2', level: 1 },
];

function makeStudent(overrides: Partial<Student> & { id: string; firstName: string; lastName: string }): Student {
  return {
    ...BASE,
    gender: 'male',
    dateOfBirth: '2013-04-10',
    placeOfBirth: 'الجزائر',
    repeater: false,
    boardingStatus: 'external',
    classId: 'c1',
    joinDate: '2026-09-01',
    leaveDate: null,
    cardCode: null,
    ...overrides,
  };
}

const MAPPING: ColumnMapping = {
  firstName: 0,
  lastName: 1,
  gender: 2,
  dateOfBirth: 3,
  className: 4,
};

describe('Student Excel import modes (replace, addMissing, delete extras)', () => {
  it('classifies existing vs new rows and detects extra students in the old list', () => {
    const existing: Student[] = [
      makeStudent({ id: 's1', firstName: 'أحمد', lastName: 'بن علي', dateOfBirth: '2013-04-10' }),
      makeStudent({ id: 's2', firstName: 'يوسف', lastName: 'قاسم', dateOfBirth: '2013-05-11' }),
      makeStudent({ id: 's3', firstName: 'سارة', lastName: 'مراد', gender: 'female', dateOfBirth: '2013-06-12' }),
    ];

    // New Excel file has 2 students (s1 kept + new student s4), while s2 and s3 are extra in old list
    const preview = buildPreviewRows({
      rows: [
        ['أحمد', 'بن علي', 'ذكر', '2013-04-10', '1م1'],
        ['آمنة', 'كريم', 'أنثى', '2013-07-15', '1م2'],
      ],
      mapping: MAPPING,
      classes: CLASSES,
      existing,
      today: '2026-10-01',
    });

    expect(preview).toHaveLength(2);
    expect(preview[0].status).toBe('existing');
    expect(preview[0].matchedStudentId).toBe('s1');
    expect(preview[0].input).not.toBeNull();

    expect(preview[1].status).toBe('new');
    expect(preview[1].matchedStudentId).toBeNull();
    expect(preview[1].input).not.toBeNull();

    const extras = findExtraExistingStudents(existing, preview);
    expect(extras.map((s) => s.id).sort()).toEqual(['s2', 's3']);
  });

  it('replace mode deletes extra old students, updates matching students, and adds new ones', () => {
    const existing: Student[] = [
      makeStudent({ id: 's1', firstName: 'أحمد', lastName: 'بن علي', classId: 'c1' }),
      makeStudent({ id: 's2', firstName: 'يوسف', lastName: 'قاسم', classId: 'c1' }),
    ];
    const incomingRows: StudentInput[] = [
      {
        firstName: 'أحمد',
        lastName: 'بن علي',
        gender: 'male',
        dateOfBirth: '2013-04-10',
        placeOfBirth: 'البليدة',
        repeater: false,
        boardingStatus: 'half-boarder',
        classId: 'c2',
        joinDate: '2026-09-01',
        leaveDate: null,
        cardCode: 'C100',
      },
      {
        firstName: 'نور',
        lastName: 'سليم',
        gender: 'female',
        dateOfBirth: '2013-08-20',
        placeOfBirth: 'وهران',
        repeater: false,
        boardingStatus: 'external',
        classId: 'c1',
        joinDate: '2026-09-01',
        leaveDate: null,
        cardCode: 'C101',
      },
    ];

    const plan = planStudentImport({
      existing,
      incomingRows,
      mode: 'replace',
    });

    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0].firstName).toBe('نور');
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].existing.id).toBe('s1');
    expect(plan.toUpdate[0].input.boardingStatus).toBe('half-boarder');
    expect(plan.toDelete.map((s) => s.id)).toEqual(['s2']);
  });

  it('addMissing mode adds only missing students and optionally deletes selected extra old students', () => {
    const existing: Student[] = [
      makeStudent({ id: 's1', firstName: 'أحمد', lastName: 'بن علي' }),
      makeStudent({ id: 's2', firstName: 'يوسف', lastName: 'قاسم' }),
      makeStudent({ id: 's3', firstName: 'سارة', lastName: 'مراد', gender: 'female' }),
    ];
    const incomingRows: StudentInput[] = [
      {
        firstName: 'أحمد',
        lastName: 'بن علي',
        gender: 'male',
        dateOfBirth: '2013-04-10',
        placeOfBirth: 'الجزائر',
        repeater: false,
        boardingStatus: 'external',
        classId: 'c1',
        joinDate: '2026-09-01',
        leaveDate: null,
        cardCode: null,
      },
      {
        firstName: 'مريم',
        lastName: 'عادل',
        gender: 'female',
        dateOfBirth: '2013-09-01',
        placeOfBirth: 'سطيف',
        repeater: false,
        boardingStatus: 'external',
        classId: 'c1',
        joinDate: '2026-09-01',
        leaveDate: null,
        cardCode: null,
      },
    ];

    // Without deletion option: keeps s1, s2, s3 untouched and adds only مريم
    const addOnlyPlan = planStudentImport({
      existing,
      incomingRows,
      mode: 'addMissing',
    });
    expect(addOnlyPlan.toAdd).toHaveLength(1);
    expect(addOnlyPlan.toAdd[0].firstName).toBe('مريم');
    expect(addOnlyPlan.toUpdate).toHaveLength(0);
    expect(addOnlyPlan.skippedExistingCount).toBe(1);
    expect(addOnlyPlan.toDelete).toHaveLength(0);

    // With deletion option targeting extra student s2 only: deletes s2 and keeps s3
    const addAndDeletePlan = planStudentImport({
      existing,
      incomingRows,
      mode: 'addMissing',
      deleteExtraStudentIds: ['s2'],
    });
    expect(addAndDeletePlan.toAdd).toHaveLength(1);
    expect(addAndDeletePlan.toDelete.map((s) => s.id)).toEqual(['s2']);
  });
});

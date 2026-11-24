import { describe, expect, it } from 'vitest';
import type { CanteenEntry, SchoolClass, Student, StudentAbsence, Teacher, TeacherAbsence, TimetableSlot, User } from '@/db/types';
import { cleanDailyReportSubject, computePage2, formatDailyReportSubjects, periodColumns, type Page2Input } from '@/utils/dailyPage2';
import { studentDayAbsences } from '@/utils/dailyPage1';
import { weekdayOfDate } from '@/utils/absences';
import { formatRate } from '@/utils/dailyReportStats';

const DATE = '2026-11-02';
const base = { institutionId: 'inst', createdAt: '', updatedAt: '', deletedAt: null, updatedBy: null };

function student(id: string, gender: 'male' | 'female'): Student {
  return {
    ...base,
    id,
    firstName: id,
    lastName: 'X',
    gender,
    dateOfBirth: null,
    placeOfBirth: '',
    repeater: false,
    boardingStatus: 'external',
    classId: 'c1',
    joinDate: null,
    leaveDate: null,
  };
}

function slot(period: number): TimetableSlot {
  return { ...base, id: `slot${period}`, classId: 'c1', day: weekdayOfDate(DATE), period, subject: 'Math', teacherId: 't1', roomId: null };
}

function absence(studentId: string, period: number): StudentAbsence {
  return { ...base, id: `${studentId}-${period}`, classId: 'c1', studentId, date: DATE, period, subject: 'Math', justified: false };
}

function input(overrides: Partial<Page2Input>): Page2Input {
  return {
    date: DATE,
    rule: 'wholeDay',
    classes: [{ ...base, id: 'c1', name: '1م1', level: undefined }] as SchoolClass[],
    students: [student('s1', 'male'), student('s2', 'female')],
    slots: [slot(1), slot(2)],
    studentAbsences: [absence('s1', 1), absence('s1', 2), absence('s2', 1)],
    teachers: [{ ...base, id: 't1', name: 'Teacher', assignments: [] } as Teacher],
    teacherAbsences: [],
    supervisors: [],
    supervisorRows: [],
    teacherNotes: {},
    canteenEntries: [],
    canteenTrackingStart: null,
    ...overrides,
  };
}

describe('periodColumns', () => {
  it('uses seven columns by default and grows up to eight', () => {
    expect(periodColumns([])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(periodColumns([8])).toHaveLength(8);
    expect(periodColumns([9])).toHaveLength(8);
  });
});

describe('computePage2 student totals', () => {
  it('counts only whole-day absences under the whole-day rule', () => {
    const result = computePage2(input({}));
    const level1 = result.levels.find((item) => item.level === 1);
    expect(level1).toMatchObject({ enrolled: 2, absent: 1 });
    expect(level1?.rate).toBe(50);
    expect(formatRate(level1?.rate ?? null)).toBe('50.00%');
    expect(result.summary.students.all).toEqual({ total: 2, absent: 1, present: 1 });
    expect(result.summary.students.male).toEqual({ total: 1, absent: 1, present: 0 });
    expect(result.summary.students.female).toEqual({ total: 1, absent: 0, present: 1 });
  });

  it('counts any absent period under the at-least-one-period rule', () => {
    const result = computePage2(input({ rule: 'anyPeriod' }));
    expect(result.levels.find((item) => item.level === 1)).toMatchObject({ enrolled: 2, absent: 2, rate: 100 });
  });

  it('shows a dash when a level has no enrolled students', () => {
    const result = computePage2(input({}));
    const level4 = result.levels.find((item) => item.level === 4);
    expect(level4).toMatchObject({ enrolled: 0, absent: 0, rate: null });
    expect(formatRate(level4?.rate ?? null)).toBe('—');
  });

  it('includes both full-day absentees and students absent in the last hour of their timetable in the daily report', () => {
    const s3 = student('s3', 'female');
    const result = computePage2(
      input({
        students: [student('s1', 'male'), student('s2', 'female'), s3],
        slots: [slot(1), slot(2), slot(3)],
        studentAbsences: [
          // s1: full day (1, 2, 3) -> counted
          absence('s1', 1),
          absence('s1', 2),
          absence('s1', 3),
          // s2: only period 1 (present at end of timetable) -> NOT counted under wholeDay rule
          absence('s2', 1),
          // s3: absent in period 3 (last hour of class timetable) -> counted!
          absence('s3', 3),
        ],
      }),
    );

    const level1 = result.levels.find((item) => item.level === 1);
    expect(level1).toMatchObject({ enrolled: 3, absent: 2 });
    expect(result.summary.students.all).toEqual({ total: 3, absent: 2, present: 1 });

    const page1Rows = studentDayAbsences({
      date: DATE,
      students: [student('s1', 'male'), student('s2', 'female'), s3],
      classes: [{ ...base, id: 'c1', name: '1م1', level: undefined }] as SchoolClass[],
      absences: [
        absence('s1', 1),
        absence('s1', 2),
        absence('s1', 3),
        absence('s2', 1),
        absence('s3', 3),
      ],
      slots: [slot(1), slot(2), slot(3)],
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
    });

    const reported = page1Rows.filter((row) => row.wholeDay || row.absentUntilEndOfDay);
    expect(reported.map((row) => row.studentId)).toEqual(['s1', 's3']);
    expect(reported.find((row) => row.studentId === 's1')?.wholeDay).toBe(true);
    expect(reported.find((row) => row.studentId === 's3')?.wholeDay).toBe(false);
    expect(reported.find((row) => row.studentId === 's3')?.absentUntilEndOfDay).toBe(true);
  });

  it('evaluates each student strictly against their own class timetable when classes end at different hours', () => {
    const classA: SchoolClass = { ...base, id: 'c1', name: '1م1', level: 1 };
    const classB: SchoolClass = { ...base, id: 'c2', name: '1م2', level: 1 };
    const students = [
      { ...student('a-last', 'male'), classId: 'c1' },
      { ...student('b-mid', 'female'), classId: 'c2' },
      { ...student('b-last', 'male'), classId: 'c2' },
    ];
    const weekday = weekdayOfDate(DATE);
    // c1 finishes at period 4; c2 finishes at period 6
    const slots: TimetableSlot[] = [
      { ...slot(1), id: 'a1', classId: 'c1', day: weekday },
      { ...slot(2), id: 'a2', classId: 'c1', day: weekday },
      { ...slot(3), id: 'a3', classId: 'c1', day: weekday },
      { ...slot(4), id: 'a4', classId: 'c1', day: weekday },
      { ...slot(1), id: 'b1', classId: 'c2', day: weekday },
      { ...slot(4), id: 'b4', classId: 'c2', day: weekday },
      { ...slot(6), id: 'b6', classId: 'c2', day: weekday },
    ];
    const absences: StudentAbsence[] = [
      { ...absence('a-last', 4), classId: 'c1' }, // last hour of c1 -> counted
      { ...absence('b-mid', 4), classId: 'c2' }, // NOT last hour of c2 -> not counted
      { ...absence('b-last', 6), classId: 'c2' }, // last hour of c2 -> counted
    ];

    const page1 = computePage2(input({ classes: [classA, classB], students, slots, studentAbsences: absences }));
    const level1 = page1.levels.find((item) => item.level === 1);
    expect(level1?.classes).toEqual([
      { classId: 'c1', className: '1م1', enrolled: 1, absent: 1 },
      { classId: 'c2', className: '1م2', enrolled: 2, absent: 1 },
    ]);
    expect(page1.summary.students.all).toEqual({ total: 3, absent: 2, present: 1 });

    const page2 = studentDayAbsences({
      date: DATE,
      students,
      classes: [classA, classB],
      absences,
      slots,
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
    }).filter((row) => row.wholeDay || row.absentUntilEndOfDay);
    expect(page2.map((row) => row.studentId)).toEqual(['a-last', 'b-last']);
  });

  it('handles duplicate timetable slots, moved students (stale record.classId), blank joinDate/leaveDate, and ignores late marks', () => {
    const movedStudent: Student = {
      ...student('s1', 'male'),
      classId: 'c1',
      joinDate: '' as unknown as null,
      leaveDate: '' as unknown as null,
    };
    const lateStudent: Student = student('s2', 'female');
    const duplicateSlots: TimetableSlot[] = [
      slot(1),
      { ...slot(1), id: 'slot1-dup', subject: 'Math TD' },
      slot(2),
      slot(4),
    ];
    const absences: StudentAbsence[] = [
      // s1 moved from old-class -> record still has old-class, absent all 3 distinct periods (1, 2, 4)
      { ...absence('s1', 1), classId: 'old-class' },
      { ...absence('s1', 2), classId: 'old-class' },
      { ...absence('s1', 4), classId: 'old-class' },
      // s2 only marked late on the last period -> must NOT be counted as absent
      { ...absence('s2', 4), status: 'late', justified: true },
    ];

    const page1 = computePage2(
      input({
        classes: [{ ...base, id: 'c1', name: '١م1', level: undefined }] as SchoolClass[],
        students: [movedStudent, lateStudent],
        slots: duplicateSlots,
        studentAbsences: absences,
      }),
    );
    expect(page1.levels.find((item) => item.level === 1)).toMatchObject({ enrolled: 2, absent: 1 });
    expect(page1.summary.students.all).toEqual({ total: 2, absent: 1, present: 1 });

    const page2 = studentDayAbsences({
      date: DATE,
      students: [movedStudent, lateStudent],
      classes: [{ ...base, id: 'c1', name: '١م1', level: undefined }] as SchoolClass[],
      absences,
      slots: duplicateSlots,
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
    }).filter((row) => row.wholeDay || row.absentUntilEndOfDay);
    expect(page2.map((row) => row.studentId)).toEqual(['s1']);
    expect(page2[0]?.wholeDay).toBe(true);
  });

  it('includes gate-entry absences in the daily report when a class has no timetable entered for that day', () => {
    const s1 = student('s1', 'male');
    const gateAbsence: StudentAbsence = {
      ...absence('s1', 1),
      subject: '—',
      status: 'absent',
      source: 'gate',
    };

    const page1 = computePage2(
      input({
        students: [s1],
        slots: [],
        studentAbsences: [gateAbsence],
      }),
    );
    expect(page1.levels.find((item) => item.level === 1)).toMatchObject({ enrolled: 1, absent: 1 });
    expect(page1.summary.students.all).toEqual({ total: 1, absent: 1, present: 0 });

    const page2 = studentDayAbsences({
      date: DATE,
      students: [s1],
      classes: [{ ...base, id: 'c1', name: '1م1', level: undefined }] as SchoolClass[],
      absences: [gateAbsence],
      slots: [],
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
    }).filter((row) => row.wholeDay || row.absentUntilEndOfDay);
    expect(page2.map((row) => row.studentId)).toEqual(['s1']);
    expect(page2[0]?.wholeDay).toBe(true);
  });
});

describe('computePage2 teachers, canteen and supervisors', () => {
  it('marks the lessons a teacher did not give and counts the absent teacher', () => {
    const teacherAbsence: TeacherAbsence = {
      ...base,
      id: 'ta1',
      teacherId: 't1',
      date: DATE,
      lessons: [{ period: 2, classId: 'c1', subject: 'Math' }],
    };
    const result = computePage2(input({ teacherAbsences: [teacherAbsence] }));
    expect(result.teacherLines).toHaveLength(1);
    expect(result.teacherLines[0]).toMatchObject({ name: 'Teacher', subjects: 'Math', marks: [2], classes: '1م1' });
    expect(result.summary.teachers).toEqual({ total: 1, absent: 1, present: 0 });
  });

  it('shows only the base subject name without TD duplicates for absent teachers', () => {
    const teacherAbsence: TeacherAbsence = {
      ...base,
      id: 'ta-td',
      teacherId: 't1',
      date: DATE,
      lessons: [
        { period: 1, classId: 'c1', subject: 'فرنسية' },
        { period: 2, classId: 'c1', subject: 'فرنسية Td' },
        { period: 3, classId: 'c1', subject: 'فرنسية (TD)' },
      ],
    };
    const result = computePage2(input({ teacherAbsences: [teacherAbsence] }));
    expect(result.teacherLines[0]?.subjects).toBe('فرنسية');
  });

  it('cleans TD markers across all subjects and formats', () => {
    expect(cleanDailyReportSubject('فرنسية Td')).toBe('فرنسية');
    expect(cleanDailyReportSubject('رياضيات TD')).toBe('رياضيات');
    expect(cleanDailyReportSubject('إنجليزية (T.D)')).toBe('إنجليزية');
    expect(cleanDailyReportSubject('TD عربية')).toBe('عربية');
    expect(cleanDailyReportSubject('فرنسيةTD')).toBe('فرنسية');
    expect(cleanDailyReportSubject('فيزياء - أعمال موجهة')).toBe('فيزياء');
    expect(cleanDailyReportSubject('علوم طبيعية (أ.م)')).toBe('علوم طبيعية');
    expect(cleanDailyReportSubject('Study')).toBe('Study');

    expect(formatDailyReportSubjects(['فرنسية/ فرنسية    Td'])).toBe('فرنسية');
    expect(formatDailyReportSubjects(['رياضيات TD'])).toBe('رياضيات');
    expect(formatDailyReportSubjects(['إنجليزية', 'انجليزية td'])).toBe('إنجليزية');
    expect(formatDailyReportSubjects(['رياضيات', 'رياضيات TD', 'فيزياء Td'])).toBe('رياضيات / فيزياء');
  });

  it('counts a supervisor absent when either period is absent', () => {
    const supervisors = [
      { ...base, id: 'u1', name: 'A', role: 'supervisor', status: 'approved' },
      { ...base, id: 'u2', name: 'B', role: 'supervisor', status: 'approved' },
    ] as User[];
    const result = computePage2(
      input({
        supervisors,
        supervisorRows: [{ supervisorId: 'u1', name: 'A', morning: 'none', evening: 'absent', notes: '' }],
      }),
    );
    expect(result.summary.supervisors).toEqual({ total: 2, absent: 1, present: 1 });
  });

  it('lists absent half-boarders with their class', () => {
    const boarder = { ...student('s1', 'male'), boardingStatus: 'half-boarder' as const };
    const result = computePage2(input({ students: [boarder, student('s2', 'female')] }));
    expect(result.canteen).toEqual({
      halfBoarders: 1,
      present: 0,
      absent: 1,
      absentNames: ['s1 X (1م1)'],
      source: 'calculated',
    });
  });
});

describe('computePage2 canteen from scans', () => {
  const boarder = (id: string) => ({ ...student(id, 'male'), boardingStatus: 'half-boarder' as const });
  const scan = (studentId: string, result: 'accepted' | 'rejected'): CanteenEntry => ({
    ...base,
    id: `e-${studentId}-${result}`,
    studentId,
    scannedCode: 'code',
    date: DATE,
    time: '07:30',
    result,
    reason: result === 'rejected' ? 'duplicate' : null,
    manual: false,
    supervisorId: null,
  });
  const students = [boarder('b1'), boarder('b2'), student('s3', 'female')];

  it('uses accepted scans and lists half-boarders without one', () => {
    const result = computePage2(input({ students, studentAbsences: [], canteenEntries: [scan('b1', 'accepted')] }));
    expect(result.canteen).toEqual({
      halfBoarders: 2,
      present: 1,
      absent: 1,
      absentNames: ['b2 X (1م1)'],
      source: 'scans',
    });
  });

  it('treats a rejected scan as not entered', () => {
    const result = computePage2(
      input({ students, studentAbsences: [], canteenEntries: [scan('b1', 'accepted'), scan('b2', 'rejected')] }),
    );
    expect(result.canteen).toMatchObject({ present: 1, absent: 1, absentNames: ['b2 X (1م1)'], source: 'scans' });
  });

  it('ignores scans from other dates', () => {
    const otherDay = { ...scan('b1', 'accepted'), date: '2026-11-03' };
    const result = computePage2(input({ students, studentAbsences: [], canteenEntries: [otherDay] }));
    expect(result.canteen).toMatchObject({ halfBoarders: 2, absent: 2, source: 'calculated' });
  });

  it('uses manual canteenEnteredCount when card scanning stopped and computes absent half-boarders', () => {
    const allStudents = [boarder('b1'), boarder('b2'), boarder('b3'), student('s4', 'female')];
    const result = computePage2(
      input({
        students: allStudents,
        studentAbsences: [],
        canteenEntries: [],
        canteenEnteredCount: 2,
      }),
    );
    expect(result.canteen).toMatchObject({
      halfBoarders: 3,
      present: 2,
      absent: 1,
      source: 'manual',
    });
  });

  it('prefers manual canteenEnteredCount over partial scans and prevents negative absent counts', () => {
    const allStudents = [boarder('b1'), boarder('b2'), boarder('b3')];
    const overEntered = computePage2(
      input({
        students: allStudents,
        studentAbsences: [],
        canteenEntries: [scan('b1', 'accepted')],
        canteenEnteredCount: 4,
      }),
    );
    expect(overEntered.canteen).toMatchObject({
      halfBoarders: 3,
      present: 4,
      absent: 0,
      source: 'manual',
    });

    const zeroEntered = computePage2(
      input({
        students: allStudents,
        studentAbsences: [],
        canteenEntries: [scan('b1', 'accepted')],
        canteenEnteredCount: 0,
      }),
    );
    expect(zeroEntered.canteen).toMatchObject({
      halfBoarders: 3,
      present: 0,
      absent: 3,
      source: 'manual',
    });
  });
});

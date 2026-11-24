import { describe, expect, it } from 'vitest';
import type { SchoolClass, Student, StudentAbsence } from '@/db/types';
import { buildClassAbsenceRegister, daysInMonthCount } from '@/utils/absenceRegister';
import { buildAbsenceRegisterWorkbook } from '@/utils/absenceRegisterExport';

const schoolClass: SchoolClass = {
  id: 'cls-1',
  institutionId: 'inst-1',
  name: '1م1',
  level: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
  updatedBy: 'user-1',
};

function makeStudent(id: string, lastName: string, firstName: string, extra: Partial<Student> = {}): Student {
  return {
    id,
    institutionId: 'inst-1',
    classId: 'cls-1',
    firstName,
    lastName,
    gender: 'male',
    dateOfBirth: '2014-01-10',
    placeOfBirth: 'Algiers',
    repeater: false,
    boardingStatus: 'external',
    joinDate: null,
    leaveDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    updatedBy: 'user-1',
    ...extra,
  };
}

function makeAbsence(
  id: string,
  studentId: string,
  date: string,
  period: number,
  extra: Partial<StudentAbsence> = {},
): StudentAbsence {
  return {
    id,
    institutionId: 'inst-1',
    classId: 'cls-1',
    studentId,
    date,
    period,
    subject: 'Math',
    justified: false,
    status: 'absent',
    source: 'manual',
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    deletedAt: null,
    updatedBy: 'user-1',
    ...extra,
  };
}

describe('buildClassAbsenceRegister', () => {
  it('computes morning (periods 1-4) and evening (periods 5-7) absence hours per day and includes all active class students', () => {
    const s1 = makeStudent('s1', 'أحمد', 'بلال');
    const s2 = makeStudent('s2', 'بوزيد', 'ياسين', { deletedAt: undefined as unknown as null });
    const s3 = makeStudent('s3', 'جلال', 'مريم', { leaveDate: '2026-10-20' }); // left before November, still shown with hasLeft
    const s4 = makeStudent('s4', 'دحمان', 'نور', { joinDate: '2026-12-01' }); // future joinDate, still shown in class list
    const s5 = makeStudent('s5', 'زروقي', 'أمين', { deletedAt: '2026-11-01T00:00:00.000Z' }); // soft-deleted, excluded

    const absences: StudentAbsence[] = [
      // s1 on 2026-11-09: 2 morning hours (P1, P3) + 1 evening hour (P5 at 13:00)
      makeAbsence('a1', 's1', '2026-11-09', 1),
      makeAbsence('a2', 's1', '2026-11-09', 3, { justified: true }),
      makeAbsence('a3', 's1', '2026-11-09', 5, { source: 'gate' }),
      // s1 on 2026-11-09: late status must NOT count as absence hours
      makeAbsence('a4', 's1', '2026-11-09', 2, { status: 'late', justified: true }),
      // s1 on 2026-11-09: deleted record must be ignored
      makeAbsence('a5', 's1', '2026-11-09', 4, { deletedAt: '2026-11-09T10:00:00.000Z' }),
      // s1 duplicate period 5 should count once
      makeAbsence('a6', 's1', '2026-11-09', 5, { updatedAt: '2026-11-09T14:00:00.000Z' }),
      // s2 on 2026-11-10: 2 evening hours (P6, P7)
      makeAbsence('a7', 's2', '2026-11-10', 6),
      makeAbsence('a8', 's2', '2026-11-10', 7),
      // Different month should be ignored
      makeAbsence('a9', 's1', '2026-10-09', 1),
    ];

    const register = buildClassAbsenceRegister({
      schoolClass,
      students: [s2, s1, s3, s4, s5],
      studentAbsences: absences,
      month: '2026-11',
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: ['2026-11-01'],
      eveningStartTime: '13:00',
      lang: 'ar',
    });

    expect(daysInMonthCount('2026-11')).toBe(30);
    expect(register.days).toHaveLength(30);
    expect(register.days[0].isHoliday).toBe(true);
    expect(register.days[0].isSchoolDay).toBe(false);
    expect(register.rows).toHaveLength(4);
    expect(register.rows.map((r) => r.student.id)).toEqual(['s1', 's2', 's3', 's4']);

    const row1 = register.rows[0];
    expect(row1.index).toBe(1);
    expect(row1.student.id).toBe('s1');
    expect(row1.hasLeft).toBe(false);
    expect(row1.days[8]).toMatchObject({
      day: 9,
      date: '2026-11-09',
      morningHours: 2,
      eveningHours: 1,
      morningPeriods: [1, 3],
      eveningPeriods: [5],
    });
    expect(row1.morningTotal).toBe(2);
    expect(row1.eveningTotal).toBe(1);
    expect(row1.totalHours).toBe(3);
    expect(row1.justifiedHours).toBe(1);
    expect(row1.unjustifiedHours).toBe(2);

    const row2 = register.rows[1];
    expect(row2.index).toBe(2);
    expect(row2.student.id).toBe('s2');
    expect(row2.hasLeft).toBe(false);
    expect(row2.days[9]).toMatchObject({
      day: 10,
      morningHours: 0,
      eveningHours: 2,
    });
    expect(row2.totalHours).toBe(2);

    const row3 = register.rows[2];
    expect(row3.student.id).toBe('s3');
    expect(row3.hasLeft).toBe(true);

    const row4 = register.rows[3];
    expect(row4.student.id).toBe('s4');
    expect(row4.hasLeft).toBe(false);

    expect(register.dailyTotals[8]).toMatchObject({ day: 9, morningHours: 2, eveningHours: 1 });
    expect(register.dailyTotals[9]).toMatchObject({ day: 10, morningHours: 0, eveningHours: 2 });
    expect(register.totals).toEqual({
      studentCount: 4,
      absentStudentCount: 2,
      morningHours: 2,
      eveningHours: 3,
      totalHours: 5,
      justifiedHours: 1,
      unjustifiedHours: 4,
    });
  });

  it('includes students with non-ISO joinDate or leaveDate and sets hasLeft accurately', () => {
    const s1 = makeStudent('s1', 'أحمد', 'بلال', { joinDate: '25/09/2026', leaveDate: '20/10/2026' });
    const s2 = makeStudent('s2', 'بوزيد', 'ياسين', { joinDate: '2026/12/05', leaveDate: null });

    const register = buildClassAbsenceRegister({
      schoolClass,
      students: [s1, s2],
      studentAbsences: [],
      month: '2026-11',
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
      eveningStartTime: '13:00',
      lang: 'ar',
    });

    expect(register.rows).toHaveLength(2);
    expect(register.rows[0].student.id).toBe('s1');
    expect(register.rows[0].hasLeft).toBe(true);
    expect(register.rows[1].student.id).toBe('s2');
    expect(register.rows[1].hasLeft).toBe(false);
  });

  it('builds an RTL Excel workbook with frozen panes, morning/evening sub-columns, and totals', () => {
    const s1 = makeStudent('s1', 'أحمد', 'بلال');
    const absences = [
      makeAbsence('a1', 's1', '2026-11-09', 1),
      makeAbsence('a2', 's1', '2026-11-09', 5),
    ];

    const register = buildClassAbsenceRegister({
      schoolClass,
      students: [s1],
      studentAbsences: absences,
      month: '2026-11',
      workingDays: [0, 1, 2, 3, 4],
      holidayDates: [],
      eveningStartTime: '13:00',
      lang: 'ar',
    });

    const workbook = buildAbsenceRegisterWorkbook(
      [register],
      {
        institutionName: 'متوسطة الأمل',
        monthDisplay: 'نوفمبر 2026 (2026-11)',
        schoolYear: '2026 / 2027',
        lang: 'ar',
        dir: 'rtl',
      },
      {
        bannerTitle: 'سجل الغياب الشهري',
        institutionLabel: 'المؤسسة',
        monthLabel: 'الشهر',
        classLabel: 'القسم',
        schoolYearLabel: 'السنة الدراسية',
        legendText: 'الفترات: ( ص ) صباحي | ( م ) مسائي',
        colIndex: 'الرقم',
        colFullName: 'اللقب والاسم',
        colDaysHeader: 'أيام الشهر',
        colMonthlyTotal: 'المجموع الشهري',
        shortMorning: 'ص',
        shortEvening: 'م',
        colTotal: 'الإجمالي',
        footerTotal: 'المجموع',
        filePrefix: 'سجل_الغياب_الشهري',
      },
    );

    const ws = workbook.getWorksheet('1م1');
    expect(ws).toBeDefined();
    expect(ws?.views[0]).toMatchObject({
      rightToLeft: true,
      state: 'frozen',
      xSplit: 2,
      ySplit: 6,
    });
    // Day 9 is columns 19 (ص) and 20 (م)
    expect(ws?.getCell(5, 19).value).toBe(9);
    expect(ws?.getCell(6, 19).value).toBe('ص');
    expect(ws?.getCell(6, 20).value).toBe('م');
    expect(ws?.getCell(7, 1).value).toBe(1);
    expect(ws?.getCell(7, 2).value).toBe('أحمد بلال');
    expect(ws?.getCell(7, 19).value).toBe(1);
    expect(ws?.getCell(7, 20).value).toBe(1);
    // Totals columns: 30 days -> lastDayCol = 62 -> 63 (مجموع ص), 64 (مجموع م), 65 (الإجمالي)
    expect(ws?.getCell(7, 63).value).toBe(1);
    expect(ws?.getCell(7, 64).value).toBe(1);
    expect(ws?.getCell(7, 65).value).toBe(2);
    // Footer row 8
    expect(ws?.getCell(8, 1).value).toBe('المجموع');
    expect(ws?.getCell(8, 65).value).toBe(2);
  });
});

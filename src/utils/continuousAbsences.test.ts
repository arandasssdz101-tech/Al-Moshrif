import { describe, expect, it } from 'vitest';
import type { ContinuousAbsence, SchoolClass, Student, StudentAbsence } from '@/db/types';
import {
  buildContinuousParentRows,
  computeNoticeSchedule,
  effectiveAbsenceEndForSync,
  enumerateSchoolDaysInRange,
  evaluateContinuousAbsenceStatus,
  mergeParentCorrespondenceRows,
} from '@/utils/continuousAbsences';

const CLASS_1: SchoolClass = {
  id: 'c1',
  institutionId: 'inst-1',
  name: '1م1',
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
  deletedAt: null,
  updatedBy: 'u1',
};

const STUDENT_1: Student = {
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
};

function makeContinuous(overrides: Partial<ContinuousAbsence> = {}): ContinuousAbsence {
  return {
    id: 'ca-1',
    institutionId: 'inst-1',
    studentId: 's1',
    classId: 'c1',
    startDate: '2026-11-01',
    endDate: null,
    reason: '',
    justified: false,
    struckAt: null,
    createdAt: '2026-11-01',
    updatedAt: '2026-11-01',
    deletedAt: null,
    updatedBy: 'u1',
    ...overrides,
  };
}

describe('continuousAbsences schedule and escalation', () => {
  it('computes Day 4 first notice, Day 10 second notice, Day 18 excuse, and Day 33 strike-off', () => {
    const schedule = computeNoticeSchedule('2026-11-01');
    expect(schedule).toEqual({
      startDate: '2026-11-01',
      firstNoticeDate: '2026-11-04',
      secondNoticeDate: '2026-11-11',
      excuseDate: '2026-11-19',
      strikeDate: '2026-12-04',
    });
  });

  it('transitions through all escalation stages accurately across days', () => {
    const open = makeContinuous({ startDate: '2026-11-01', endDate: null });

    expect(evaluateContinuousAbsenceStatus(open, '2026-11-01').stage).toBe('active');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-03').stage).toBe('active');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-04').stage).toBe('firstNotice');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-10').stage).toBe('firstNotice');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-11').stage).toBe('secondNotice');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-18').stage).toBe('secondNotice');
    expect(evaluateContinuousAbsenceStatus(open, '2026-11-19').stage).toBe('excuse');
    expect(evaluateContinuousAbsenceStatus(open, '2026-12-03').stage).toBe('excuse');

    const struckStatus = evaluateContinuousAbsenceStatus(open, '2026-12-04');
    expect(struckStatus.stage).toBe('struck');
    expect(struckStatus.struck).toBe(true);
  });

  it('marks returned students as closed and never strikes them off', () => {
    const closed = makeContinuous({ startDate: '2026-11-01', endDate: '2026-11-12' });
    const status = evaluateContinuousAbsenceStatus(closed, '2026-12-10');
    expect(status.stage).toBe('closed');
    expect(status.struck).toBe(false);
    expect(status.firstNoticeReached).toBe(true);
    expect(status.secondNoticeReached).toBe(true);
    expect(status.excuseReached).toBe(false);
  });

  it('caps open-absence period sync at the day before strike-off and skips weekends/holidays', () => {
    const open = makeContinuous({ startDate: '2026-11-01', endDate: null });
    expect(effectiveAbsenceEndForSync(open, '2026-11-10')).toBe('2026-11-10');
    expect(effectiveAbsenceEndForSync(open, '2026-12-20')).toBe('2026-12-03');

    // Sun..Thu working days (0..4), skip Fri (5) & Sat (6) & Nov 1 holiday
    const days = enumerateSchoolDaysInRange('2026-11-01', '2026-11-08', [0, 1, 2, 3, 4], ['2026-11-01']);
    expect(days).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-08',
    ]);
  });

  it('generates Daily Report parent correspondence rows at Day 4, Day 10, Day 18, and Day 33', () => {
    const open = makeContinuous({ startDate: '2026-11-01', endDate: null });
    const absences: StudentAbsence[] = [
      {
        id: 'a1',
        institutionId: 'inst-1',
        classId: 'c1',
        studentId: 's1',
        date: '2026-11-02',
        period: 1,
        subject: 'رياضيات',
        justified: false,
        source: 'continuous',
        continuousAbsenceId: 'ca-1',
        createdAt: '2026-11-02',
        updatedAt: '2026-11-02',
        deletedAt: null,
        updatedBy: 'u1',
      },
      {
        id: 'a2',
        institutionId: 'inst-1',
        classId: 'c1',
        studentId: 's1',
        date: '2026-11-02',
        period: 2,
        subject: 'عربية',
        justified: false,
        source: 'continuous',
        continuousAbsenceId: 'ca-1',
        createdAt: '2026-11-02',
        updatedAt: '2026-11-02',
        deletedAt: null,
        updatedBy: 'u1',
      },
    ];

    // Before Day 4: no parent correspondence row yet
    expect(
      buildContinuousParentRows({
        date: '2026-11-03',
        continuousAbsences: [open],
        students: [STUDENT_1],
        classes: [CLASS_1],
        absences,
        defaultReason: 'غياب متواصل',
      }),
    ).toEqual([]);

    // Day 4: 1st notice populated
    const day4 = buildContinuousParentRows({
      date: '2026-11-04',
      continuousAbsences: [open],
      students: [STUDENT_1],
      classes: [CLASS_1],
      absences,
      defaultReason: 'غياب متواصل',
    });
    expect(day4).toHaveLength(1);
    expect(day4[0]).toMatchObject({
      studentId: 's1',
      name: 'بن علي أحمد',
      className: '1م1',
      hours: '2',
      absenceDate: '2026-11-01',
      reason: 'غياب متواصل',
      firstNotice: '04/11/2026',
      secondNotice: '',
      excuse: '',
      struckDate: '',
    });

    // Day 18: 1st, 2nd, and excuse populated
    const day18 = buildContinuousParentRows({
      date: '2026-11-19',
      continuousAbsences: [open],
      students: [STUDENT_1],
      classes: [CLASS_1],
      absences,
      defaultReason: 'غياب متواصل',
    });
    expect(day18[0]).toMatchObject({
      firstNotice: '04/11/2026',
      secondNotice: '11/11/2026',
      excuse: '19/11/2026',
      struckDate: '',
    });

    // Day 33: struckDate populated
    const day33 = buildContinuousParentRows({
      date: '2026-12-04',
      continuousAbsences: [open],
      students: [STUDENT_1],
      classes: [CLASS_1],
      absences,
      defaultReason: 'غياب متواصل',
    });
    expect(day33[0]).toMatchObject({
      firstNotice: '04/11/2026',
      secondNotice: '11/11/2026',
      excuse: '19/11/2026',
      struckDate: '2026-12-04',
    });
  });

  it('merges manual and auto parent correspondence rows without duplicating the same student', () => {
    const manual = [
      {
        studentId: 's1',
        name: 'بن علي أحمد',
        className: '1م1',
        hours: '10',
        absenceDate: '2026-11-01',
        reason: 'سبب خاص',
        firstNotice: '04/11/2026',
        secondNotice: '',
        excuse: '',
        struckDate: '',
      },
    ];
    const auto = [
      {
        studentId: 's1',
        name: 'بن علي أحمد',
        className: '1م1',
        hours: '12',
        absenceDate: '2026-11-01',
        reason: 'غياب متواصل',
        firstNotice: '04/11/2026',
        secondNotice: '',
        excuse: '',
        struckDate: '',
      },
      {
        studentId: 's2',
        name: 'حداد سارة',
        className: '1م1',
        hours: '8',
        absenceDate: '2026-11-01',
        reason: 'غياب متواصل',
        firstNotice: '04/11/2026',
        secondNotice: '',
        excuse: '',
        struckDate: '',
      },
    ];
    const merged = mergeParentCorrespondenceRows(manual, auto);
    expect(merged).toHaveLength(2);
    expect(merged[0].reason).toBe('سبب خاص');
    expect(merged[1].studentId).toBe('s2');
  });
});

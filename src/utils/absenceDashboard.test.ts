import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  buildAbsenceDashboard,
  determineWeekStartDay,
  shiftYearMonth,
  weekStartForDate,
} from './absenceDashboard';

const WORKING_DAYS = [0, 1, 2, 3, 4]; // Sun-Thu

function makeSlots(classId: string, periodsPerDay = 2) {
  const slots: { classId: string; teacherId: string; day: number; period: number; subject: string }[] = [];
  for (const day of WORKING_DAYS) {
    for (let period = 1; period <= periodsPerDay; period += 1) {
      slots.push({ classId, teacherId: 't1', day, period, subject: 'Math' });
    }
  }
  return slots;
}

describe('absenceDashboard utilities', () => {
  it('computes UTC date arithmetic and week starts accurately', () => {
    expect(addUtcDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftYearMonth('2026-03', -5)).toBe('2025-10');
    expect(determineWeekStartDay([0, 1, 2, 3, 4])).toBe(0);
    expect(determineWeekStartDay([1, 2, 3, 4, 5])).toBe(1);
    // 2026-03-11 is Wednesday (weekday 3); Sunday start is 2026-03-08
    expect(weekStartForDate('2026-03-11', 0)).toBe('2026-03-08');
  });

  it('calculates weekly & monthly rates, deltas, and justified/unjustified splits accurately', () => {
    const classes = [
      { id: 'c1', name: '1AM1', level: 1 },
      { id: 'c2', name: '2AM1', level: 2 },
    ];
    const students = [
      { id: 's1', classId: 'c1', joinDate: null, leaveDate: null },
      { id: 's2', classId: 'c1', joinDate: null, leaveDate: null },
      { id: 's3', classId: 'c2', joinDate: null, leaveDate: null },
      { id: 's4', classId: 'c2', joinDate: null, leaveDate: null },
    ];
    // 2 lessons/day * 2 students = 4 required hours/class/day => 8 required hours/day total
    const slots = [...makeSlots('c1', 2), ...makeSlots('c2', 2)];

    // Reference date: Wednesday 2026-03-11
    // Current week (Sun 2026-03-08 to Wed 2026-03-11): 4 school days => 32 required hours
    // Previous week (Sun 2026-03-01 to Thu 2026-03-05): 5 school days => 40 required hours
    const studentAbsences = [
      // Previous week: 2 absent hours out of 40 => 5%
      { classId: 'c1', date: '2026-03-02', justified: true },
      { classId: 'c1', date: '2026-03-03', justified: false },
      // Current week: 4 absent hours out of 32 => 12.5% (3 unjustified, 1 justified)
      { classId: 'c1', date: '2026-03-08', justified: false },
      { classId: 'c1', date: '2026-03-09', justified: false },
      { classId: 'c2', date: '2026-03-10', justified: false },
      { classId: 'c2', date: '2026-03-11', justified: true },
      // Holiday absence should be excluded
      { classId: 'c1', date: '2026-03-04', justified: false },
    ];

    const summary = buildAbsenceDashboard({
      classes,
      students,
      slots,
      studentAbsences,
      workingDays: WORKING_DAYS,
      holidayDates: ['2026-03-04'],
      referenceDate: '2026-03-11',
      weeksCount: 4,
      monthsCount: 3,
    });

    expect(summary.weekly).toHaveLength(4);
    expect(summary.monthly).toHaveLength(3);

    // Previous week had 2026-03-04 as a holiday => 4 school days => 32 required hours, 2 absences => 6.25%
    expect(summary.previousWeek?.schoolDays).toBe(4);
    expect(summary.previousWeek?.requiredHours).toBe(32);
    expect(summary.previousWeek?.absentHours).toBe(2);
    expect(summary.previousWeek?.rate).toBe(6.25);

    // Current week up to 2026-03-11 => 4 school days => 32 required hours, 4 absences => 12.5%
    expect(summary.currentWeek?.schoolDays).toBe(4);
    expect(summary.currentWeek?.requiredHours).toBe(32);
    expect(summary.currentWeek?.absentHours).toBe(4);
    expect(summary.currentWeek?.justifiedHours).toBe(1);
    expect(summary.currentWeek?.unjustifiedHours).toBe(3);
    expect(summary.currentWeek?.rate).toBe(12.5);
    expect(summary.currentWeek?.unjustifiedRate).toBe(9.38);
    expect(summary.currentWeek?.justifiedRate).toBe(3.13);

    // Week delta = 12.5 - 6.25 = +6.25
    expect(summary.weekDelta).toBe(6.25);

    // Current month (2026-03 up to 2026-03-11 minus holiday 2026-03-04 = 8 school days) => 64 required hours, 6 absences => 9.38%
    expect(summary.currentMonth?.month).toBe('2026-03');
    expect(summary.currentMonth?.schoolDays).toBe(8);
    expect(summary.currentMonth?.requiredHours).toBe(64);
    expect(summary.currentMonth?.absentHours).toBe(6);
    expect(summary.currentMonth?.rate).toBe(9.38);

    // Class ranking: c1 has 4 absences, c2 has 2 absences => c1 first
    expect(summary.byClass[0]?.classId).toBe('c1');
    expect(summary.byClass[0]?.absentHours).toBe(4);
    expect(summary.byClass[1]?.classId).toBe('c2');
    expect(summary.byClass[1]?.absentHours).toBe(2);
  });

  it('filters by academic level and specific class cleanly', () => {
    const classes = [
      { id: 'c1', name: '1AM1', level: 1 },
      { id: 'c2', name: '2AM1', level: 2 },
    ];
    const students = [
      { id: 's1', classId: 'c1', joinDate: null, leaveDate: null },
      { id: 's2', classId: 'c2', joinDate: null, leaveDate: null },
    ];
    const slots = [...makeSlots('c1', 2), ...makeSlots('c2', 2)];
    const studentAbsences = [
      { classId: 'c1', date: '2026-03-09', justified: false },
      { classId: 'c2', date: '2026-03-09', justified: false },
    ];

    const level2Only = buildAbsenceDashboard({
      classes,
      students,
      slots,
      studentAbsences,
      workingDays: WORKING_DAYS,
      holidayDates: [],
      referenceDate: '2026-03-11',
      weeksCount: 2,
      monthsCount: 2,
      levelFilter: 2,
    });

    expect(level2Only.byClass).toHaveLength(1);
    expect(level2Only.byClass[0]?.classId).toBe('c2');
    expect(level2Only.totalAbsentHours).toBe(1);
  });

  it('handles missing timetables gracefully without NaN or division by zero', () => {
    const summary = buildAbsenceDashboard({
      classes: [{ id: 'c1', name: '1AM1', level: 1 }],
      students: [{ id: 's1', classId: 'c1', joinDate: null, leaveDate: null }],
      slots: [],
      studentAbsences: [{ classId: 'c1', date: '2026-03-09', justified: false }],
      workingDays: WORKING_DAYS,
      holidayDates: [],
      referenceDate: '2026-03-11',
    });

    expect(summary.hasTimetable).toBe(false);
    expect(summary.currentWeek?.rate).toBeNull();
    expect(summary.currentMonth?.rate).toBeNull();
    expect(summary.totalAbsentHours).toBe(1);
  });
});

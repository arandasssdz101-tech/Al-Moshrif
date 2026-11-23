import { describe, expect, it } from 'vitest';
import { groupResettableDayAbsences, planGateEntryAbsenceSync } from '@/utils/gateAbsenceSync';

// 2026-03-01 is Sunday (weekday = 0)
const SUNDAY = '2026-03-01';

const slots = [
  { classId: 'c1', day: 0, period: 1, subject: 'رياضيات', teacherId: 't1' },
  { classId: 'c1', day: 0, period: 2, subject: 'فيزياء', teacherId: 't2' },
  { classId: 'c1', day: 0, period: 3, subject: 'عربية', teacherId: 't3' },
];

const students = [
  { id: 's1', firstName: 'أمين', lastName: 'بن علي', classId: 'c1', joinDate: '2025-09-01', leaveDate: null, deletedAt: null },
  { id: 's2', firstName: 'سارة', lastName: 'قاسي', classId: 'c1', joinDate: '2025-09-01', leaveDate: null, deletedAt: null },
  { id: 's3', firstName: 'يوسف', lastName: 'حداد', classId: 'c1', joinDate: '2025-09-01', leaveDate: '2026-02-01', deletedAt: null },
];

describe('planGateEntryAbsenceSync', () => {
  it('marks all scheduled periods absent for enrolled students who did not enter by card', () => {
    const plan = planGateEntryAbsenceSync({
      date: SUNDAY,
      students,
      slots,
      entries: [
        { studentId: 's1', date: SUNDAY, time: '07:55:00', result: 'accepted', late: false, minutesLate: 0, deletedAt: null },
      ],
      existingAbsences: [],
      markLateMissedLessons: false,
    });

    expect(plan.enrolledCount).toBe(2);
    expect(plan.enteredCount).toBe(1);
    expect(plan.notEnteredCount).toBe(1);
    expect(plan.toSoftDeleteIds).toEqual([]);
    expect(plan.toAdd).toHaveLength(3);
    expect(plan.toAdd.every((item) => item.studentId === 's2')).toBe(true);
    expect(plan.toAdd.map((item) => item.period)).toEqual([1, 2, 3]);
    expect(plan.absentStudentsAfterSync).toBe(1);
  });

  it('removes stale gate absences when a student enters on time while preserving manual and continuous absences', () => {
    const plan = planGateEntryAbsenceSync({
      date: SUNDAY,
      students,
      slots,
      entries: [
        { studentId: 's1', date: SUNDAY, time: '07:58:00', result: 'accepted', late: false, minutesLate: 0, deletedAt: null },
      ],
      existingAbsences: [
        { id: 'a1', studentId: 's1', classId: 'c1', date: SUNDAY, period: 1, source: 'gate', deletedAt: null },
        { id: 'a2', studentId: 's1', classId: 'c1', date: SUNDAY, period: 2, source: 'manual', deletedAt: null },
        { id: 'a3', studentId: 's2', classId: 'c1', date: SUNDAY, period: 1, source: 'continuous', deletedAt: null },
      ],
      markLateMissedLessons: false,
    });

    expect(plan.toSoftDeleteIds).toEqual(['a1']);
    // s2 already has period 1 (continuous), so only periods 2 and 3 should be added
    expect(plan.toAdd.map((item) => `${item.studentId}:${item.period}`)).toEqual(['s2:2', 's2:3']);
  });

  it('marks only missed periods for late arrivals when markLateMissedLessons is true', () => {
    // Period 1 ends at 09:00, Period 2 ends at 10:00, Period 3 ends at 11:00
    const plan = planGateEntryAbsenceSync({
      date: SUNDAY,
      students: [students[0]],
      slots,
      entries: [
        { studentId: 's1', date: SUNDAY, time: '09:15:00', result: 'accepted', late: true, minutesLate: 75, deletedAt: null },
      ],
      existingAbsences: [
        { id: 'g1', studentId: 's1', classId: 'c1', date: SUNDAY, period: 1, source: 'gate', deletedAt: null },
        { id: 'g2', studentId: 's1', classId: 'c1', date: SUNDAY, period: 2, source: 'gate', deletedAt: null },
        { id: 'g3', studentId: 's1', classId: 'c1', date: SUNDAY, period: 3, source: 'gate', deletedAt: null },
      ],
      markLateMissedLessons: true,
    });

    expect(plan.lateCount).toBe(1);
    expect(plan.toSoftDeleteIds).toEqual(['g2', 'g3']);
    expect(plan.toAdd).toEqual([]);
  });

  it('is idempotent when run repeatedly with the same state', () => {
    const plan = planGateEntryAbsenceSync({
      date: SUNDAY,
      students: [students[0], students[1]],
      slots,
      entries: [
        { studentId: 's1', date: SUNDAY, time: '07:50:00', result: 'accepted', late: false, minutesLate: 0, deletedAt: null },
      ],
      existingAbsences: [
        { id: 'g1', studentId: 's2', classId: 'c1', date: SUNDAY, period: 1, source: 'gate', deletedAt: null },
        { id: 'g2', studentId: 's2', classId: 'c1', date: SUNDAY, period: 2, source: 'gate', deletedAt: null },
        { id: 'g3', studentId: 's2', classId: 'c1', date: SUNDAY, period: 3, source: 'gate', deletedAt: null },
      ],
      markLateMissedLessons: false,
    });

    expect(plan.toAdd).toEqual([]);
    expect(plan.toSoftDeleteIds).toEqual([]);
  });
});

describe('groupResettableDayAbsences', () => {
  it('groups manual and gate absences by student sorted by class and last name, excluding continuous absences', () => {
    const result = groupResettableDayAbsences({
      date: SUNDAY,
      students,
      classes: [{ id: 'c1', name: '1م1' }],
      absences: [
        { id: 'r1', studentId: 's2', classId: 'c1', date: SUNDAY, period: 2, subject: 'فيزياء', source: 'gate', justified: false, deletedAt: null },
        { id: 'r2', studentId: 's2', classId: 'c1', date: SUNDAY, period: 1, subject: 'رياضيات', source: 'manual', justified: true, deletedAt: null },
        { id: 'r3', studentId: 's1', classId: 'c1', date: SUNDAY, period: 1, subject: 'رياضيات', source: 'continuous', justified: false, deletedAt: null },
      ],
    });

    expect(result.totalResettableRecords).toBe(2);
    expect(result.gateRecordsCount).toBe(1);
    expect(result.manualRecordsCount).toBe(1);
    expect(result.continuousRecordsCount).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].studentName).toBe('قاسي سارة');
    expect(result.groups[0].records.map((r) => r.period)).toEqual([1, 2]);
    expect(result.groups[0].hasGate).toBe(true);
    expect(result.groups[0].hasManual).toBe(true);
  });
});

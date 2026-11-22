import { describe, expect, it } from 'vitest';
import type { GateEntry, Student, TimetableSlot } from '@/db/types';
import {
  computeEntryStats,
  computeLateMissedPeriods,
  computeLateStatus,
  computeTenMinuteBuckets,
  decideGateScan,
  DEFAULT_ENTRY_SETTINGS,
  planAutoAbsencesForStart,
  planStudentGateAbsenceSync,
  resolveExpectedStartTime,
} from '@/utils/entry';
import { buildEntryExport, parseEntryExport, planEntryMerge } from '@/utils/entryMerge';
import { normalizeScannedCode } from '@/utils/studentQr';

const BASE = {
  institutionId: 'inst-1',
  createdAt: '2026-09-01T07:00:00.000Z',
  updatedAt: '2026-09-01T07:00:00.000Z',
  deletedAt: null,
  updatedBy: 'head-1',
};

function makeStudent(overrides: Partial<Student> & { id: string; classId: string }): Student {
  return {
    ...BASE,
    firstName: 'أحمد',
    lastName: 'بن علي',
    gender: 'male',
    dateOfBirth: '2012-05-10',
    placeOfBirth: 'الجزائر',
    repeater: false,
    boardingStatus: 'half-boarder',
    joinDate: '2026-09-01',
    leaveDate: null,
    cardCode: `CARD-${overrides.id}`,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<GateEntry> & { id: string }): GateEntry {
  return {
    ...BASE,
    studentId: 's1',
    scannedCode: 'CARD-s1',
    date: '2026-10-12', // Monday (weekday 1)
    time: '07:55:00',
    result: 'accepted',
    late: false,
    minutesLate: 0,
    source: 'camera',
    supervisorId: 'head-1',
    deviceId: 'dev-1',
    ...overrides,
  };
}

describe('Gate Entry domain logic', () => {
  it('counts distinct accepted students only and never lets duplicates increase entered count', () => {
    const students = [
      makeStudent({ id: 's1', classId: 'c1' }),
      makeStudent({ id: 's2', classId: 'c1' }),
      makeStudent({ id: 's3', classId: 'c1', leaveDate: '2026-10-01' }),
    ];
    const entries: GateEntry[] = [
      makeEntry({ id: 'e1', studentId: 's1', time: '07:50:00', result: 'accepted' }),
      makeEntry({ id: 'e2', studentId: 's1', time: '07:54:00', result: 'duplicate' }),
      makeEntry({ id: 'e3', studentId: 's1', time: '07:55:00', result: 'accepted' }), // even if duplicated accepted row
      makeEntry({ id: 'e4', studentId: null, scannedCode: 'BAD', time: '07:58:00', result: 'unknown' }),
    ];

    const stats = computeEntryStats(students, entries, '2026-10-12');
    expect(stats.enrolled).toBe(2); // s3 left before date
    expect(stats.entered).toBe(1);
    expect(stats.notEntered).toBe(1);
    expect(stats.duplicates).toBe(1);
    expect(stats.unknown).toBe(1);
    expect(stats.rejected).toBe(2);
  });

  it('detects duplicates, left students, and unknown cards accurately', () => {
    const students = [
      makeStudent({ id: 's1', classId: 'c1', cardCode: '123456' }),
      makeStudent({ id: 's2', classId: 'c1', cardCode: '999999', leaveDate: '2026-10-05' }),
    ];
    const existing = [
      makeEntry({ id: 'e1', studentId: 's1', time: '07:52:10', result: 'accepted' }),
    ];

    const dup = decideGateScan({
      rawCode: '123456',
      date: '2026-10-12',
      time: '08:05:00',
      students,
      entriesForDate: existing,
      slots: [],
      settings: DEFAULT_ENTRY_SETTINGS,
    });
    expect(dup.result).toBe('duplicate');
    expect(dup.existingTime).toBe('07:52');

    const left = decideGateScan({
      rawCode: '999999',
      date: '2026-10-12',
      time: '08:05:00',
      students,
      entriesForDate: existing,
      slots: [],
      settings: DEFAULT_ENTRY_SETTINGS,
    });
    expect(left.result).toBe('left');

    const unknown = decideGateScan({
      rawCode: 'NO-SUCH-CARD',
      date: '2026-10-12',
      time: '08:05:00',
      students,
      entriesForDate: existing,
      slots: [],
      settings: DEFAULT_ENTRY_SETTINGS,
    });
    expect(unknown.result).toBe('unknown');
    expect(unknown.student).toBeNull();
  });

  it('computes lateness using fixed start time or first timetable lesson of the class', () => {
    // Fixed start time 08:00, grace 10 min
    expect(computeLateStatus('08:10:00', '08:00', 10)).toEqual({ late: false, minutesLate: 0 });
    expect(computeLateStatus('08:15:00', '08:00', 10)).toEqual({ late: true, minutesLate: 15 });

    // Class c1 starts at period 2 (09:00) on Monday (day 1)
    const slots: TimetableSlot[] = [
      { ...BASE, id: 'sl1', classId: 'c1', day: 1, period: 2, subject: 'رياضيات', teacherId: null, roomId: null },
      { ...BASE, id: 'sl2', classId: 'c1', day: 1, period: 3, subject: 'فيزياء', teacherId: null, roomId: null },
    ];

    const startFixed = resolveExpectedStartTime('c1', '2026-10-12', slots, {
      startTime: '08:00',
      useFirstTimetableLesson: false,
    });
    expect(startFixed).toBe('08:00');

    const startFromTimetable = resolveExpectedStartTime('c1', '2026-10-12', slots, {
      startTime: '08:00',
      useFirstTimetableLesson: true,
    });
    expect(startFromTimetable).toBe('09:00');

    // Arriving at 09:05 is on time when first lesson is 09:00
    expect(computeLateStatus('09:05:00', startFromTimetable, 10)).toEqual({ late: false, minutesLate: 0 });
    // Arriving at 09:20 is 20 min late
    expect(computeLateStatus('09:20:00', startFromTimetable, 10)).toEqual({ late: true, minutesLate: 20 });

    // Arriving at 10:15 misses period 2 (09:00-10:00) which already ended
    const missed = computeLateMissedPeriods('c1', '2026-10-12', '10:15:00', slots);
    expect(missed).toEqual([{ period: 2, subject: 'رياضيات' }]);
  });

  it('normalizes French AZERTY symbols and Arabic-Indic digits from USB readers', () => {
    expect(normalizeScannedCode('&é"\'(-è_çà\r\n', { convertAzertyDigits: true })).toBe('1234567890');
    expect(normalizeScannedCode('  ٠١٢٣٤٥٦٧٨٩ \t', { convertAzertyDigits: true })).toBe('0123456789');
    expect(normalizeScannedCode('&é"', { convertAzertyDigits: false })).toBe('&é"');
  });

  it('merges entries from multiple devices keeping earliest accepted and marking later ones duplicate', () => {
    const localEntries: GateEntry[] = [
      makeEntry({ id: 'local-1', studentId: 's1', date: '2026-10-12', time: '08:05:00', deviceId: 'gate-a' }),
      makeEntry({ id: 'local-2', studentId: 's2', date: '2026-10-12', time: '07:50:00', deviceId: 'gate-a' }),
    ];
    const remoteEntries: GateEntry[] = [
      // Earlier scan for s1 on device B -> should become the kept accepted entry!
      makeEntry({ id: 'remote-1', studentId: 's1', date: '2026-10-12', time: '07:52:00', deviceId: 'gate-b' }),
      // Later scan for s2 on device B -> should be downgraded to duplicate!
      makeEntry({ id: 'remote-2', studentId: 's2', date: '2026-10-12', time: '08:12:00', late: true, minutesLate: 12, deviceId: 'gate-b' }),
      // Brand new student s3 on device B
      makeEntry({ id: 'remote-3', studentId: 's3', date: '2026-10-12', time: '07:59:00', deviceId: 'gate-b' }),
    ];

    const exported = buildEntryExport('inst-1', remoteEntries);
    const parsed = parseEntryExport(exported);
    expect(parsed).toHaveLength(3);

    const plan = planEntryMerge(localEntries, parsed!, 'inst-1');
    expect(plan.addedCount).toBe(3);
    expect(plan.downgradedToDuplicateCount).toBe(2);

    const byId = new Map(plan.toPut.map((item) => [item.id, item]));
    expect(byId.get('remote-1')?.result).toBe('accepted');
    expect(byId.get('local-1')?.result).toBe('duplicate');
    expect(byId.get('remote-2')?.result).toBe('duplicate');
    expect(byId.get('remote-2')?.late).toBe(false);
    expect(byId.get('remote-3')?.result).toBe('accepted');
  });

  it('groups accepted entries into 10-minute interval buckets', () => {
    const entries: GateEntry[] = [
      makeEntry({ id: 'e1', studentId: 's1', time: '07:42:00', late: false }),
      makeEntry({ id: 'e2', studentId: 's2', time: '07:49:30', late: false }),
      makeEntry({ id: 'e3', studentId: 's3', time: '08:14:00', late: true, minutesLate: 14 }),
    ];
    const buckets = computeTenMinuteBuckets(entries, '2026-10-12');
    expect(buckets).toEqual([
      { label: '07:40', count: 2, lateCount: 0 },
      { label: '08:10', count: 1, lateCount: 1 },
    ]);
  });

  it('plans automatic timetable absences for non-entered students when gate scanning starts', () => {
    const students = [
      makeStudent({ id: 's1', classId: 'c1' }),
      makeStudent({ id: 's2', classId: 'c1' }),
      makeStudent({ id: 's3', classId: 'c2' }), // class c2 has no lessons on Monday
    ];
    const slots: TimetableSlot[] = [
      { ...BASE, id: 'sl1', classId: 'c1', day: 1, period: 1, subject: 'رياضيات', teacherId: null, roomId: null },
      { ...BASE, id: 'sl2', classId: 'c1', day: 1, period: 2, subject: 'فرنسية', teacherId: null, roomId: null },
    ];
    const entries: GateEntry[] = [
      makeEntry({ id: 'e1', studentId: 's1', date: '2026-10-12', time: '07:55:00', result: 'accepted' }),
    ];

    const planned = planAutoAbsencesForStart({
      date: '2026-10-12',
      students,
      slots,
      entries,
      existingAbsences: [],
      settings: { markLateMissedLessons: false },
    });

    // Only s2 (not entered, class c1 has periods 1 & 2) should be marked absent
    expect(planned).toEqual([
      { studentId: 's2', classId: 'c1', period: 1, subject: 'رياضيات' },
      { studentId: 's2', classId: 'c1', period: 2, subject: 'فرنسية' },
    ]);
  });

  it('removes gate-generated absences when a student scans in and preserves manual absences', () => {
    const slots: TimetableSlot[] = [
      { ...BASE, id: 'sl1', classId: 'c1', day: 1, period: 1, subject: 'رياضيات', teacherId: null, roomId: null },
      { ...BASE, id: 'sl2', classId: 'c1', day: 1, period: 2, subject: 'فرنسية', teacherId: null, roomId: null },
      { ...BASE, id: 'sl3', classId: 'c1', day: 1, period: 3, subject: 'فيزياء', teacherId: null, roomId: null },
    ];

    // On-time scan clears all gate-generated absences without flagging manual absence
    const onTimePlan = planStudentGateAbsenceSync({
      classId: 'c1',
      date: '2026-10-12',
      entryTime: '07:58:00',
      late: false,
      slots,
      existingStudentAbsences: [
        { id: 'a1', period: 1, source: 'gate', deletedAt: null },
        { id: 'a2', period: 2, source: 'gate', deletedAt: null },
        { id: 'a3', period: 3, source: 'gate', deletedAt: null },
      ],
      markLateMissedLessons: true,
    });
    expect(onTimePlan.toSoftDeleteIds).toEqual(['a1', 'a2', 'a3']);
    expect(onTimePlan.toAdd).toEqual([]);
    expect(onTimePlan.hasManualAbsence).toBe(false);

    // Late arrival at 09:15 with markLateMissedLessons keeps period 1 (08:00-09:00) and clears 2 & 3
    const latePlan = planStudentGateAbsenceSync({
      classId: 'c1',
      date: '2026-10-12',
      entryTime: '09:15:00',
      late: true,
      slots,
      existingStudentAbsences: [
        { id: 'a1', period: 1, source: 'gate', deletedAt: null },
        { id: 'a2', period: 2, source: 'gate', deletedAt: null },
        { id: 'a3', period: 3, source: 'manual', deletedAt: null },
      ],
      markLateMissedLessons: true,
    });
    expect(latePlan.toSoftDeleteIds).toEqual(['a2']);
    expect(latePlan.toAdd).toEqual([]);
    expect(latePlan.hasManualAbsence).toBe(true);
  });
});

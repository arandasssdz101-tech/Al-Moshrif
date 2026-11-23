import { describe, expect, it } from 'vitest';
import type {
  AppNotification,
  Room,
  StudentAbsence,
  TeacherAbsence,
  TimetableSlot,
} from '@/db/types';
import {
  CONSOLIDATED_PACKAGE_FORMAT,
  SUPERVISOR_BACKUP_FORMAT,
  SUPERVISOR_BACKUP_VERSION,
  assignRoomToSlot,
  buildConsolidatedPackageFilename,
  buildSupervisorBackupFilename,
  buildSupervisorScopeLabel,
  clearSpecificRoomFromSlot,
  computeAvailableRooms,
  doPeriodsOverlap,
  mergeRecordsByTimestamp,
  parseConsolidatedPackage,
  parseSupervisorBackupPackage,
  planSupervisorBatchMerge,
  type SupervisorBackupPackage,
} from './supervisorMerge';

const INST = 'inst-1';

function makeBase(id: string, updatedAt: string, deletedAt: string | null = null) {
  return {
    id,
    institutionId: INST,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt,
    deletedAt,
    updatedBy: 'sup-1',
  };
}

function makeAbsence(id: string, updatedAt: string, justified = false): StudentAbsence {
  return {
    ...makeBase(id, updatedAt),
    classId: 'c1',
    studentId: 's1',
    date: '2026-03-10',
    period: 1,
    subject: 'رياضيات',
    justified,
  };
}

function makeRoom(id: string, name: string, updatedAt = '2026-01-01T08:00:00.000Z'): Room {
  return {
    ...makeBase(id, updatedAt),
    name,
  };
}

function makeSlot(
  id: string,
  classId: string,
  day: number,
  period: number,
  roomId: string | null,
  updatedAt: string,
  groups?: TimetableSlot['groups'],
): TimetableSlot {
  return {
    ...makeBase(id, updatedAt),
    classId,
    day,
    period,
    subject: 'فيزياء',
    teacherId: 't1',
    roomId,
    groups,
  };
}

function makePackage(
  supervisorId: string,
  supervisorName: string,
  records: Partial<SupervisorBackupPackage['records']>,
): SupervisorBackupPackage {
  return {
    format: SUPERVISOR_BACKUP_FORMAT,
    version: SUPERVISOR_BACKUP_VERSION,
    exportedAt: '2026-03-10T10:00:00.000Z',
    institutionId: INST,
    institutionName: 'ثانوية الأمير عبد القادر',
    supervisor: {
      id: supervisorId,
      name: supervisorName,
      usernameKey: supervisorId,
      role: 'supervisor',
    },
    scope: {
      role: 'supervisor',
      assignedClassIds: ['c1'],
      assignedClassNames: ['1ع1'],
      searchScope: 'assigned',
      scopeLabel: '1ع1',
      permissions: null,
    },
    records: {
      studentAbsences: records.studentAbsences ?? [],
      continuousAbsences: records.continuousAbsences ?? [],
      teacherAbsences: records.teacherAbsences ?? [],
      timetableSlots: records.timetableSlots ?? [],
      rooms: records.rooms ?? [],
      notifications: records.notifications ?? [],
      entries: records.entries ?? [],
      canteenEntries: records.canteenEntries ?? [],
    },
  };
}

describe('supervisorMerge filenames and parsers', () => {
  it('builds readable filenames with supervisor name, scope, and timestamp', () => {
    const date = new Date(2026, 2, 15, 14, 35);
    const scope = buildSupervisorScopeLabel('supervisor', ['1ع1', '1ع2', '2ع1']);
    expect(scope).toBe('1ع1-1ع2+1');
    const filename = buildSupervisorBackupFilename('أحمد بن علي', scope, date);
    expect(filename).toBe('edutrack-أحمد_بن_علي-1ع1-1ع2+1-2026-03-15_14-35.edutrack');

    const consolidated = buildConsolidatedPackageFilename('ثانوية النجاح', date);
    expect(consolidated).toBe('edutrack-consolidated-ثانوية_النجاح-2026-03-15_14-35.edutrack');
  });

  it('validates and parses supervisor backup and consolidated packages', () => {
    const pkg = makePackage('sup-1', 'سارة', {});
    const parsed = parseSupervisorBackupPackage(JSON.stringify(pkg));
    expect(parsed.supervisor.name).toBe('سارة');

    expect(() => parseSupervisorBackupPackage('not-json')).toThrow('supervisorSync.errors.invalidJson');
    expect(() => parseSupervisorBackupPackage(JSON.stringify({ format: 'wrong' }))).toThrow(
      'supervisorSync.errors.invalidFormat',
    );
    expect(() =>
      parseConsolidatedPackage(
        JSON.stringify({
          format: CONSOLIDATED_PACKAGE_FORMAT,
          version: 99,
          institutionId: INST,
          exportedAt: '2026-03-10T10:00:00.000Z',
          exportedBy: { id: 'h1', name: 'Head', usernameKey: 'head' },
          records: {},
        }),
      ),
    ).toThrow('supervisorSync.errors.unsupportedVersion');
  });
});

describe('mergeRecordsByTimestamp idempotency', () => {
  it('re-importing the exact same file creates zero duplicates and skips all records', () => {
    const existing = [makeAbsence('a1', '2026-03-10T09:00:00.000Z', false)];
    const incoming = [makeAbsence('a1', '2026-03-10T09:00:00.000Z', false)];

    const result = mergeRecordsByTimestamp(existing, [incoming], INST);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.toPut).toHaveLength(0);
  });

  it('never overwrites newer local edits with older incoming records', () => {
    const existing = [makeAbsence('a1', '2026-03-10T12:00:00.000Z', true)];
    const olderIncoming = [makeAbsence('a1', '2026-03-10T08:00:00.000Z', false)];

    const result = mergeRecordsByTimestamp(existing, [olderIncoming], INST);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.finalById.get('a1')?.justified).toBe(true);
  });

  it('updates when incoming is strictly newer and picks newest across multiple files', () => {
    const existing = [makeAbsence('a1', '2026-03-10T08:00:00.000Z', false)];
    const file1 = [
      makeAbsence('a1', '2026-03-10T09:00:00.000Z', false),
      makeAbsence('a2', '2026-03-10T09:00:00.000Z', false),
    ];
    const file2 = [
      makeAbsence('a1', '2026-03-10T11:00:00.000Z', true),
      makeAbsence('a2', '2026-03-10T08:30:00.000Z', true),
    ];

    const result = mergeRecordsByTimestamp(existing, [file1, file2], INST);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(2); // duplicate entries across batches
    expect(result.finalById.get('a1')?.justified).toBe(true);
    expect(result.finalById.get('a2')?.justified).toBe(false); // file1 was newer for a2
  });
});

describe('planSupervisorBatchMerge room conflict detection and resolution', () => {
  it('blocks double-booked rooms on same day & overlapping time across different classes, logs notification, and computes free rooms', () => {
    const rooms = [
      makeRoom('r1', 'قاعة 1'),
      makeRoom('r2', 'قاعة 2'),
      makeRoom('r3', 'مخبر فيزياء'),
    ];
    const existingSlot = makeSlot('slot-c1', 'c1', 0, 2, 'r1', '2026-03-10T08:00:00.000Z');
    const occupiedOtherSlot = makeSlot('slot-c3', 'c3', 0, 2, 'r2', '2026-03-10T08:00:00.000Z');
    const conflictingIncoming = makeSlot('slot-c2', 'c2', 0, 2, 'r1', '2026-03-10T09:00:00.000Z');

    const pkg = makePackage('sup-2', 'كريم', {
      timetableSlots: [conflictingIncoming],
      teacherAbsences: [
        {
          ...makeBase('ta-1', '2026-03-10T09:00:00.000Z'),
          teacherId: 't1',
          date: '2026-03-10',
          lessons: [{ period: 2, classId: 'c2', subject: 'فيزياء' }],
        } satisfies TeacherAbsence,
      ],
    });

    const plan = planSupervisorBatchMerge({
      institutionId: INST,
      actorId: 'head-1',
      existing: {
        rooms,
        studentAbsences: [],
        continuousAbsences: [],
        teacherAbsences: [],
        timetableSlots: [existingSlot, occupiedOtherSlot],
        notifications: [],
        entries: [],
        canteenEntries: [],
      },
      packages: [pkg],
      classNamesById: { c1: '1ع1', c2: '2ع1', c3: '3ع1' },
      nowIso: '2026-03-10T10:30:00.000Z',
    });

    // Conflicting slot MUST be blocked
    expect(plan.toPut.timetableSlots).toHaveLength(0);
    expect(plan.counts.timetableSlots.conflicts).toBe(1);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].roomId).toBe('r1');
    expect(plan.conflicts[0].existingClassName).toBe('1ع1');
    expect(plan.conflicts[0].incomingClassName).toBe('2ع1');
    expect(plan.conflicts[0].availableRoomIds).toEqual(['r3']);

    // Non-conflicting teacher absence still merged
    expect(plan.toPut.teacherAbsences).toHaveLength(1);

    // Deterministic notification logged
    expect(plan.conflictNotifications).toHaveLength(1);
    expect(plan.conflictNotifications[0].kind).toBe('room_conflict');
    expect(plan.conflictNotifications[0].resolved).toBe(false);
    expect(plan.toPut.notifications).toHaveLength(1);
  });

  it('detects room conflicts inside split-group slots and between two incoming files in the same batch', () => {
    const rooms = [makeRoom('r1', 'مخبر 1'), makeRoom('r2', 'مخبر 2')];
    const slotFile1 = makeSlot('slot-a', 'c1', 1, 3, 'r1', '2026-03-10T08:00:00.000Z', [
      { groupNumber: 1, subject: 'علوم', teacherId: 't1', roomId: 'r1' },
      { groupNumber: 2, subject: 'فيزياء', teacherId: 't2', roomId: 'r2' },
    ]);
    const slotFile2 = makeSlot('slot-b', 'c2', 1, 3, 'r2', '2026-03-10T09:00:00.000Z');

    const plan = planSupervisorBatchMerge({
      institutionId: INST,
      actorId: 'head-1',
      existing: {
        rooms,
        studentAbsences: [],
        continuousAbsences: [],
        teacherAbsences: [],
        timetableSlots: [],
        notifications: [] as AppNotification[],
        entries: [],
        canteenEntries: [],
      },
      packages: [
        makePackage('sup-1', 'أمين', { timetableSlots: [slotFile1] }),
        makePackage('sup-2', 'ليلى', { timetableSlots: [slotFile2] }),
      ],
    });

    // First slot accepted, second slot blocked because r2 is used by group 2 of slot-a
    expect(plan.toPut.timetableSlots.map((s) => s.id)).toEqual(['slot-a']);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].roomId).toBe('r2');
    expect(plan.conflicts[0].existingGroupNumber).toBe(2);
    expect(plan.conflicts[0].availableRoomIds).toEqual([]);
  });

  it('allows updating the same class slot without false self-conflict', () => {
    const rooms = [makeRoom('r1', 'قاعة 1')];
    const oldSlot = makeSlot('slot-c1', 'c1', 0, 1, 'r1', '2026-03-10T08:00:00.000Z');
    const updatedSlot = {
      ...makeSlot('slot-c1', 'c1', 0, 1, 'r1', '2026-03-10T10:00:00.000Z'),
      subject: 'رياضيات',
    };

    const plan = planSupervisorBatchMerge({
      institutionId: INST,
      actorId: 'head-1',
      existing: {
        rooms,
        studentAbsences: [],
        continuousAbsences: [],
        teacherAbsences: [],
        timetableSlots: [oldSlot],
        notifications: [],
        entries: [],
        canteenEntries: [],
      },
      packages: [makePackage('sup-1', 'أمين', { timetableSlots: [updatedSlot] })],
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.counts.timetableSlots.updated).toBe(1);
    expect(plan.toPut.timetableSlots[0].subject).toBe('رياضيات');
  });

  it('supports slot room reassignment and clearing helpers cleanly', () => {
    const splitSlot = makeSlot('slot-s', 'c1', 0, 1, 'r1', '2026-03-10T08:00:00.000Z', [
      { groupNumber: 1, subject: 'علوم', teacherId: 't1', roomId: 'r1' },
      { groupNumber: 2, subject: 'فيزياء', teacherId: 't2', roomId: 'r2' },
    ]);

    const reassigned = assignRoomToSlot(splitSlot, 2, 'r3');
    expect(reassigned.groups?.[0].roomId).toBe('r1');
    expect(reassigned.groups?.[1].roomId).toBe('r3');

    const cleared = clearSpecificRoomFromSlot(reassigned, 'r1');
    expect(cleared.groups?.[0].roomId).toBeNull();
    expect(cleared.roomId).toBeNull();
    expect(cleared.groups?.[1].roomId).toBe('r3');

    expect(doPeriodsOverlap(1, 1)).toBe(true);
    expect(doPeriodsOverlap(1, 2)).toBe(false);

    const freeRooms = computeAvailableRooms(
      [makeRoom('r1', 'قاعة 1'), makeRoom('r2', 'قاعة 2'), makeRoom('r3', 'قاعة 3')],
      [cleared],
      0,
      1,
    );
    expect(freeRooms).toEqual(['r1', 'r2']);
  });
});

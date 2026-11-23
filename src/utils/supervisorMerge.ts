import type {
  AppNotification,
  BaseRecord,
  CanteenEntry,
  ContinuousAbsence,
  GateEntry,
  Room,
  SchoolClass,
  Student,
  StudentAbsence,
  SupervisorPermissions,
  Teacher,
  TeacherAbsence,
  TimetableSlot,
  UserRole,
} from '@/db/types';
import { PERIODS } from './schedule';
import { isSplitSlot, slotLessons } from './timetableLessons';

export const SUPERVISOR_BACKUP_FORMAT = 'edutrack-supervisor-backup' as const;
export const CONSOLIDATED_PACKAGE_FORMAT = 'edutrack-consolidated-package' as const;
export const SUPERVISOR_BACKUP_VERSION = 1;

export interface SupervisorScopeInfo {
  role: UserRole;
  assignedClassIds: string[];
  assignedClassNames: string[];
  searchScope: 'assigned' | 'institution';
  scopeLabel: string;
  permissions: SupervisorPermissions | null;
}

export interface SupervisorBackupRecords {
  studentAbsences: StudentAbsence[];
  continuousAbsences: ContinuousAbsence[];
  teacherAbsences: TeacherAbsence[];
  timetableSlots: TimetableSlot[];
  rooms: Room[];
  notifications: AppNotification[];
  entries?: GateEntry[];
  canteenEntries?: CanteenEntry[];
}

export interface SupervisorBackupReferences {
  classNames?: Record<string, string>;
  roomNames?: Record<string, string>;
  teacherNames?: Record<string, string>;
}

export interface SupervisorBackupPackage {
  format: typeof SUPERVISOR_BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  institutionId: string;
  institutionName: string;
  supervisor: {
    id: string;
    name: string;
    usernameKey: string;
    role: UserRole;
  };
  scope: SupervisorScopeInfo;
  records: SupervisorBackupRecords;
  references?: SupervisorBackupReferences;
}

export interface ConsolidatedInstitutionPackage {
  format: typeof CONSOLIDATED_PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  institutionId: string;
  institutionName: string;
  exportedBy: {
    id: string;
    name: string;
    usernameKey: string;
  };
  records: {
    classes: SchoolClass[];
    students: Student[];
    teachers: Teacher[];
    rooms: Room[];
    timetableSlots: TimetableSlot[];
    studentAbsences: StudentAbsence[];
    continuousAbsences: ContinuousAbsence[];
    teacherAbsences: TeacherAbsence[];
    notifications: AppNotification[];
    entries: GateEntry[];
    canteenEntries: CanteenEntry[];
  };
}

export interface RecordMergeCounts {
  added: number;
  updated: number;
  skipped: number;
  conflicts: number;
}

export interface CategoryMergeCounts {
  studentAbsences: RecordMergeCounts;
  continuousAbsences: RecordMergeCounts;
  teacherAbsences: RecordMergeCounts;
  timetableSlots: RecordMergeCounts;
  rooms: RecordMergeCounts;
  notifications: RecordMergeCounts;
  entries: RecordMergeCounts;
  canteenEntries: RecordMergeCounts;
}

export interface RoomBookingConflict {
  id: string;
  notificationId: string;
  roomId: string;
  roomName: string;
  day: number;
  period: number;
  timeRange: string;
  existingSlot: TimetableSlot;
  existingClassName: string;
  incomingSlot: TimetableSlot;
  incomingClassName: string;
  incomingGroupNumber: number | null;
  existingGroupNumber: number | null;
  sourceSupervisorId: string;
  sourceSupervisorName: string;
  availableRoomIds: string[];
}

export interface BatchMergePlan {
  toPut: {
    rooms: Room[];
    studentAbsences: StudentAbsence[];
    continuousAbsences: ContinuousAbsence[];
    teacherAbsences: TeacherAbsence[];
    timetableSlots: TimetableSlot[];
    notifications: AppNotification[];
    entries: GateEntry[];
    canteenEntries: CanteenEntry[];
  };
  conflicts: RoomBookingConflict[];
  conflictNotifications: AppNotification[];
  counts: CategoryMergeCounts;
  totals: RecordMergeCounts;
}

export interface MergeByTimestampResult<T extends BaseRecord> {
  toPut: T[];
  finalById: Map<string, T>;
  added: number;
  updated: number;
  skipped: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatFilenameTimestamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}-${pad2(date.getMinutes())}`;
}

export function sanitizeFilenameSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

export function buildSupervisorScopeLabel(
  role: UserRole,
  assignedClassNames: string[],
  allLabel = 'all',
  unassignedLabel = 'unassigned',
): string {
  if (role === 'head') return allLabel;
  if (assignedClassNames.length === 0) return unassignedLabel;
  if (assignedClassNames.length <= 2) return assignedClassNames.join('-');
  return `${assignedClassNames.slice(0, 2).join('-')}+${assignedClassNames.length - 2}`;
}

export function buildSupervisorBackupFilename(
  supervisorName: string,
  scopeLabel: string,
  date: Date = new Date(),
): string {
  const nameSeg = sanitizeFilenameSegment(supervisorName, 'supervisor');
  const scopeSeg = sanitizeFilenameSegment(scopeLabel, 'scope');
  return `edutrack-${nameSeg}-${scopeSeg}-${formatFilenameTimestamp(date)}.edutrack`;
}

export function buildConsolidatedPackageFilename(
  institutionName: string,
  date: Date = new Date(),
): string {
  const instSeg = sanitizeFilenameSegment(institutionName, 'institution');
  return `edutrack-consolidated-${instSeg}-${formatFilenameTimestamp(date)}.edutrack`;
}

function parseClockMinutes(clock: string): number {
  const [hStr, mStr] = clock.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export interface TimeInterval {
  startMinutes: number;
  endMinutes: number;
  label: string;
}

export function periodInterval(period: number): TimeInterval {
  const found = PERIODS.find((p) => p.number === period);
  if (found) {
    return {
      startMinutes: parseClockMinutes(found.start),
      endMinutes: parseClockMinutes(found.end),
      label: `${found.start}–${found.end}`,
    };
  }
  const startMinutes = (7 + period) * 60;
  return {
    startMinutes,
    endMinutes: startMinutes + 60,
    label: `P${period}`,
  };
}

export function doPeriodsOverlap(periodA: number, periodB: number): boolean {
  if (periodA === periodB) return true;
  const a = periodInterval(periodA);
  const b = periodInterval(periodB);
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function compareTimestamps(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    if (ta > tb) return 1;
    if (ta < tb) return -1;
    return 0;
  }
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

/**
 * Idempotent merge by record `id` and `updatedAt`.
 * - Re-importing the same record (`incoming.updatedAt <= existing.updatedAt`) skips it.
 * - Across multiple incoming files, the newest `updatedAt` wins deterministically.
 */
export function mergeRecordsByTimestamp<T extends BaseRecord>(
  existingRecords: T[],
  incomingBatches: T[][],
  institutionId?: string,
): MergeByTimestampResult<T> {
  const existingById = new Map<string, T>();
  const finalById = new Map<string, T>();

  for (const rec of existingRecords) {
    existingById.set(rec.id, rec);
    finalById.set(rec.id, rec);
  }

  // Deduplicate across all incoming batches keeping newest updatedAt per id
  const bestIncomingById = new Map<string, T>();
  let duplicateIncomingSkipped = 0;

  for (const batch of incomingBatches) {
    for (const raw of batch) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
      if (institutionId && raw.institutionId && raw.institutionId !== institutionId) continue;
      const current = bestIncomingById.get(raw.id);
      if (!current) {
        bestIncomingById.set(raw.id, raw);
      } else {
        duplicateIncomingSkipped += 1;
        if (compareTimestamps(raw.updatedAt, current.updatedAt) > 0) {
          bestIncomingById.set(raw.id, raw);
        }
      }
    }
  }

  const toPut: T[] = [];
  let added = 0;
  let updated = 0;
  let skipped = duplicateIncomingSkipped;

  for (const [id, incoming] of bestIncomingById.entries()) {
    const existing = existingById.get(id);
    if (!existing) {
      toPut.push(incoming);
      finalById.set(id, incoming);
      added += 1;
    } else if (compareTimestamps(incoming.updatedAt, existing.updatedAt) > 0) {
      toPut.push(incoming);
      finalById.set(id, incoming);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { toPut, finalById, added, updated, skipped };
}

export interface RoomUsage {
  roomId: string;
  groupNumber: number | null;
  subject: string;
}

export function extractSlotRooms(slot: TimetableSlot): RoomUsage[] {
  return slotLessons(slot)
    .filter((lesson): lesson is typeof lesson & { roomId: string } => Boolean(lesson.roomId))
    .map((lesson) => ({
      roomId: lesson.roomId,
      groupNumber: lesson.groupNumber,
      subject: lesson.subject,
    }));
}

export function findRoomBookingConflict(
  incomingSlot: TimetableSlot,
  activeSlots: Iterable<TimetableSlot>,
): {
  roomId: string;
  existingSlot: TimetableSlot;
  incomingGroupNumber: number | null;
  existingGroupNumber: number | null;
} | null {
  if (incomingSlot.deletedAt !== null) return null;
  const incomingRooms = extractSlotRooms(incomingSlot);
  if (incomingRooms.length === 0) return null;

  for (const existing of activeSlots) {
    if (existing.deletedAt !== null) continue;
    if (existing.id === incomingSlot.id) continue;
    if (existing.classId === incomingSlot.classId) continue;
    if (existing.day !== incomingSlot.day) continue;
    if (!doPeriodsOverlap(existing.period, incomingSlot.period)) continue;

    const existingRooms = extractSlotRooms(existing);
    for (const inc of incomingRooms) {
      const match = existingRooms.find((ex) => ex.roomId === inc.roomId);
      if (match) {
        return {
          roomId: inc.roomId,
          existingSlot: existing,
          incomingGroupNumber: inc.groupNumber,
          existingGroupNumber: match.groupNumber,
        };
      }
    }
  }

  return null;
}

export function computeAvailableRooms(
  allRooms: Room[],
  activeSlots: Iterable<TimetableSlot>,
  day: number,
  period: number,
  excludeSlotId?: string,
): string[] {
  const occupied = new Set<string>();
  for (const slot of activeSlots) {
    if (slot.deletedAt !== null) continue;
    if (excludeSlotId && slot.id === excludeSlotId) continue;
    if (slot.day !== day) continue;
    if (!doPeriodsOverlap(slot.period, period)) continue;
    for (const usage of extractSlotRooms(slot)) {
      occupied.add(usage.roomId);
    }
  }

  return allRooms
    .filter((room) => room.deletedAt === null && !occupied.has(room.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((room) => room.id);
}

export function assignRoomToSlot(
  slot: TimetableSlot,
  targetGroupNumber: number | null,
  newRoomId: string | null,
): TimetableSlot {
  if (isSplitSlot(slot) && slot.groups) {
    const groups = slot.groups.map((group) =>
      targetGroupNumber === null || group.groupNumber === targetGroupNumber
        ? { ...group, roomId: newRoomId }
        : group,
    );
    return {
      ...slot,
      groups,
      roomId: groups[0]?.roomId ?? null,
    };
  }
  return { ...slot, roomId: newRoomId };
}

export function clearSpecificRoomFromSlot(slot: TimetableSlot, roomId: string): TimetableSlot {
  if (isSplitSlot(slot) && slot.groups) {
    const groups = slot.groups.map((group) =>
      group.roomId === roomId ? { ...group, roomId: null } : group,
    );
    return {
      ...slot,
      groups,
      roomId: groups[0]?.roomId ?? null,
    };
  }
  return slot.roomId === roomId ? { ...slot, roomId: null } : slot;
}

function makeConflictNotificationId(roomId: string, day: number, period: number, existingSlotId: string, incomingSlotId: string): string {
  const pair = [existingSlotId, incomingSlotId].sort().join('__');
  return `conflict:${roomId}:${day}:${period}:${pair}`;
}

export interface PlanBatchMergeInput {
  institutionId: string;
  actorId: string;
  existing: {
    rooms: Room[];
    studentAbsences: StudentAbsence[];
    continuousAbsences: ContinuousAbsence[];
    teacherAbsences: TeacherAbsence[];
    timetableSlots: TimetableSlot[];
    notifications: AppNotification[];
    entries: GateEntry[];
    canteenEntries: CanteenEntry[];
  };
  packages: SupervisorBackupPackage[];
  classNamesById?: Record<string, string>;
  nowIso?: string;
}

export function planSupervisorBatchMerge(input: PlanBatchMergeInput): BatchMergePlan {
  const { institutionId, actorId, existing, packages, classNamesById = {} } = input;
  const nowIso = input.nowIso ?? new Date().toISOString();

  // Merge non-conflicting tables first using id + updatedAt
  const roomsMerge = mergeRecordsByTimestamp(
    existing.rooms,
    packages.map((p) => p.records.rooms ?? []),
    institutionId,
  );
  const studentAbsencesMerge = mergeRecordsByTimestamp(
    existing.studentAbsences,
    packages.map((p) => p.records.studentAbsences ?? []),
    institutionId,
  );
  const continuousAbsencesMerge = mergeRecordsByTimestamp(
    existing.continuousAbsences,
    packages.map((p) => p.records.continuousAbsences ?? []),
    institutionId,
  );
  const teacherAbsencesMerge = mergeRecordsByTimestamp(
    existing.teacherAbsences,
    packages.map((p) => p.records.teacherAbsences ?? []),
    institutionId,
  );
  const notificationsMerge = mergeRecordsByTimestamp(
    existing.notifications,
    packages.map((p) => p.records.notifications ?? []),
    institutionId,
  );
  const entriesMerge = mergeRecordsByTimestamp(
    existing.entries,
    packages.map((p) => p.records.entries ?? []),
    institutionId,
  );
  const canteenEntriesMerge = mergeRecordsByTimestamp(
    existing.canteenEntries,
    packages.map((p) => p.records.canteenEntries ?? []),
    institutionId,
  );

  // Build room & class name maps for human-readable conflict reports
  const roomNameMap = new Map<string, string>();
  for (const room of roomsMerge.finalById.values()) {
    roomNameMap.set(room.id, room.name);
  }
  const classNameMap = new Map<string, string>(Object.entries(classNamesById));
  for (const pkg of packages) {
    if (pkg.references?.roomNames) {
      for (const [id, name] of Object.entries(pkg.references.roomNames)) {
        if (!roomNameMap.has(id)) roomNameMap.set(id, name);
      }
    }
    if (pkg.references?.classNames) {
      for (const [id, name] of Object.entries(pkg.references.classNames)) {
        if (!classNameMap.has(id)) classNameMap.set(id, name);
      }
    }
    pkg.scope.assignedClassIds.forEach((id, idx) => {
      const label = pkg.scope.assignedClassNames[idx];
      if (label && !classNameMap.has(id)) classNameMap.set(id, label);
    });
  }

  // Merge timetableSlots with room booking conflict detection
  const existingSlotsById = new Map<string, TimetableSlot>();
  const acceptedSlotsById = new Map<string, TimetableSlot>();
  for (const slot of existing.timetableSlots) {
    existingSlotsById.set(slot.id, slot);
    acceptedSlotsById.set(slot.id, slot);
  }

  // Deduplicate incoming slots across files keeping newest updatedAt + tracking source supervisor
  const bestIncomingSlotById = new Map<
    string,
    { slot: TimetableSlot; supervisorId: string; supervisorName: string }
  >();
  let slotSkipped = 0;

  for (const pkg of packages) {
    for (const slot of pkg.records.timetableSlots ?? []) {
      if (!slot || typeof slot.id !== 'string' || !slot.id) continue;
      if (slot.institutionId && slot.institutionId !== institutionId) continue;
      const current = bestIncomingSlotById.get(slot.id);
      if (!current) {
        bestIncomingSlotById.set(slot.id, {
          slot,
          supervisorId: pkg.supervisor.id,
          supervisorName: pkg.supervisor.name,
        });
      } else {
        slotSkipped += 1;
        if (compareTimestamps(slot.updatedAt, current.slot.updatedAt) > 0) {
          bestIncomingSlotById.set(slot.id, {
            slot,
            supervisorId: pkg.supervisor.id,
            supervisorName: pkg.supervisor.name,
          });
        }
      }
    }
  }

  // Process deletions/updates chronologically (older first, or deletions before additions) so freed rooms become available
  const candidates = Array.from(bestIncomingSlotById.values()).sort((a, b) => {
    const aDeleted = a.slot.deletedAt !== null ? 0 : 1;
    const bDeleted = b.slot.deletedAt !== null ? 0 : 1;
    if (aDeleted !== bDeleted) return aDeleted - bDeleted;
    return compareTimestamps(a.slot.updatedAt, b.slot.updatedAt);
  });

  const slotsToPut: TimetableSlot[] = [];
  let slotAdded = 0;
  let slotUpdated = 0;
  const conflicts: RoomBookingConflict[] = [];
  const conflictNotifications: AppNotification[] = [];

  for (const candidate of candidates) {
    const { slot, supervisorId, supervisorName } = candidate;
    const existingSlot = existingSlotsById.get(slot.id);

    // Skip if existing record is same or newer
    if (existingSlot && compareTimestamps(slot.updatedAt, existingSlot.updatedAt) <= 0) {
      slotSkipped += 1;
      continue;
    }

    // Check for room booking conflict across different classes
    const conflictHit = findRoomBookingConflict(slot, acceptedSlotsById.values());
    if (conflictHit) {
      const interval = periodInterval(slot.period);
      const roomName = roomNameMap.get(conflictHit.roomId) ?? conflictHit.roomId;
      const existingClassName = classNameMap.get(conflictHit.existingSlot.classId) ?? conflictHit.existingSlot.classId;
      const incomingClassName = classNameMap.get(slot.classId) ?? slot.classId;
      const notificationId = makeConflictNotificationId(
        conflictHit.roomId,
        slot.day,
        slot.period,
        conflictHit.existingSlot.id,
        slot.id,
      );

      conflicts.push({
        id: notificationId,
        notificationId,
        roomId: conflictHit.roomId,
        roomName,
        day: slot.day,
        period: slot.period,
        timeRange: interval.label,
        existingSlot: conflictHit.existingSlot,
        existingClassName,
        incomingSlot: slot,
        incomingClassName,
        incomingGroupNumber: conflictHit.incomingGroupNumber,
        existingGroupNumber: conflictHit.existingGroupNumber,
        sourceSupervisorId: supervisorId,
        sourceSupervisorName: supervisorName,
        availableRoomIds: [],
      });

      const existingNotif = notificationsMerge.finalById.get(notificationId);
      const notification: AppNotification = {
        id: notificationId,
        institutionId,
        createdAt: existingNotif?.createdAt ?? nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        updatedBy: actorId,
        kind: 'room_conflict',
        title: `تعارض حجز قاعة: ${roomName}`,
        message: `القاعة "${roomName}" محجوزة للقسم (${existingClassName}) في نفس التوقيت (${interval.label}) وتعارضت مع القسم (${incomingClassName}) من نسخة المشرف ${supervisorName}. تم منع الحجز المزدوج.`,
        read: false,
        resolved: false,
        relatedSlotId: slot.id,
        relatedRoomId: conflictHit.roomId,
        day: slot.day,
        period: slot.period,
        meta: {
          existingSlotId: conflictHit.existingSlot.id,
          incomingSlotId: slot.id,
          existingClassName,
          incomingClassName,
          roomName,
          timeRange: interval.label,
          supervisorName,
        },
      };
      conflictNotifications.push(notification);
      continue;
    }

    // Safe to accept
    slotsToPut.push(slot);
    acceptedSlotsById.set(slot.id, slot);
    if (!existingSlot) {
      slotAdded += 1;
    } else {
      slotUpdated += 1;
    }
  }

  // Recompute available rooms against final accepted slots
  const finalRooms = Array.from(roomsMerge.finalById.values());
  const finalAcceptedSlots = Array.from(acceptedSlotsById.values());
  for (const conflict of conflicts) {
    conflict.availableRoomIds = computeAvailableRooms(
      finalRooms,
      finalAcceptedSlots,
      conflict.day,
      conflict.period,
    );
  }

  // Combine imported notifications + conflict notifications (deduplicated by id)
  const notificationsToPutMap = new Map<string, AppNotification>();
  for (const n of notificationsMerge.toPut) {
    notificationsToPutMap.set(n.id, n);
  }
  for (const cn of conflictNotifications) {
    notificationsToPutMap.set(cn.id, cn);
  }

  const counts: CategoryMergeCounts = {
    studentAbsences: {
      added: studentAbsencesMerge.added,
      updated: studentAbsencesMerge.updated,
      skipped: studentAbsencesMerge.skipped,
      conflicts: 0,
    },
    continuousAbsences: {
      added: continuousAbsencesMerge.added,
      updated: continuousAbsencesMerge.updated,
      skipped: continuousAbsencesMerge.skipped,
      conflicts: 0,
    },
    teacherAbsences: {
      added: teacherAbsencesMerge.added,
      updated: teacherAbsencesMerge.updated,
      skipped: teacherAbsencesMerge.skipped,
      conflicts: 0,
    },
    timetableSlots: {
      added: slotAdded,
      updated: slotUpdated,
      skipped: slotSkipped,
      conflicts: conflicts.length,
    },
    rooms: {
      added: roomsMerge.added,
      updated: roomsMerge.updated,
      skipped: roomsMerge.skipped,
      conflicts: 0,
    },
    notifications: {
      added: notificationsMerge.added,
      updated: notificationsMerge.updated,
      skipped: notificationsMerge.skipped,
      conflicts: 0,
    },
    entries: {
      added: entriesMerge.added,
      updated: entriesMerge.updated,
      skipped: entriesMerge.skipped,
      conflicts: 0,
    },
    canteenEntries: {
      added: canteenEntriesMerge.added,
      updated: canteenEntriesMerge.updated,
      skipped: canteenEntriesMerge.skipped,
      conflicts: 0,
    },
  };

  const totals: RecordMergeCounts = Object.values(counts).reduce(
    (acc, c) => ({
      added: acc.added + c.added,
      updated: acc.updated + c.updated,
      skipped: acc.skipped + c.skipped,
      conflicts: acc.conflicts + c.conflicts,
    }),
    { added: 0, updated: 0, skipped: 0, conflicts: 0 },
  );

  return {
    toPut: {
      rooms: roomsMerge.toPut,
      studentAbsences: studentAbsencesMerge.toPut,
      continuousAbsences: continuousAbsencesMerge.toPut,
      teacherAbsences: teacherAbsencesMerge.toPut,
      timetableSlots: slotsToPut,
      notifications: Array.from(notificationsToPutMap.values()),
      entries: entriesMerge.toPut,
      canteenEntries: canteenEntriesMerge.toPut,
    },
    conflicts,
    conflictNotifications,
    counts,
    totals,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayField(obj: Record<string, unknown>, key: string): boolean {
  return Array.isArray(obj[key]);
}

export function parseSupervisorBackupPackage(text: string): SupervisorBackupPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('supervisorSync.errors.invalidJson');
  }

  if (!isObject(parsed)) {
    throw new Error('supervisorSync.errors.invalidFormat');
  }
  if (parsed.format !== SUPERVISOR_BACKUP_FORMAT || typeof parsed.version !== 'number') {
    throw new Error('supervisorSync.errors.invalidFormat');
  }
  if (parsed.version > SUPERVISOR_BACKUP_VERSION) {
    throw new Error('supervisorSync.errors.unsupportedVersion');
  }
  if (
    typeof parsed.institutionId !== 'string' ||
    !parsed.institutionId ||
    typeof parsed.exportedAt !== 'string' ||
    !isObject(parsed.supervisor) ||
    typeof parsed.supervisor.id !== 'string' ||
    typeof parsed.supervisor.name !== 'string' ||
    !isObject(parsed.scope) ||
    !isObject(parsed.records)
  ) {
    throw new Error('supervisorSync.errors.invalidFormat');
  }

  const records = parsed.records;
  const requiredArrays = [
    'studentAbsences',
    'continuousAbsences',
    'teacherAbsences',
    'timetableSlots',
    'rooms',
    'notifications',
  ];
  for (const key of requiredArrays) {
    if (!isArrayField(records, key)) {
      throw new Error('supervisorSync.errors.invalidFormat');
    }
  }

  return parsed as unknown as SupervisorBackupPackage;
}

export function parseConsolidatedPackage(text: string): ConsolidatedInstitutionPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('supervisorSync.errors.invalidJson');
  }

  if (!isObject(parsed)) {
    throw new Error('supervisorSync.errors.invalidFormat');
  }
  if (parsed.format !== CONSOLIDATED_PACKAGE_FORMAT || typeof parsed.version !== 'number') {
    throw new Error('supervisorSync.errors.invalidConsolidatedFormat');
  }
  if (parsed.version > SUPERVISOR_BACKUP_VERSION) {
    throw new Error('supervisorSync.errors.unsupportedVersion');
  }
  if (
    typeof parsed.institutionId !== 'string' ||
    !parsed.institutionId ||
    typeof parsed.exportedAt !== 'string' ||
    !isObject(parsed.exportedBy) ||
    !isObject(parsed.records)
  ) {
    throw new Error('supervisorSync.errors.invalidConsolidatedFormat');
  }

  const records = parsed.records;
  const requiredArrays = [
    'classes',
    'students',
    'teachers',
    'rooms',
    'timetableSlots',
    'studentAbsences',
    'continuousAbsences',
    'teacherAbsences',
    'notifications',
    'entries',
    'canteenEntries',
  ];
  for (const key of requiredArrays) {
    if (!isArrayField(records, key)) {
      throw new Error('supervisorSync.errors.invalidConsolidatedFormat');
    }
  }

  return parsed as unknown as ConsolidatedInstitutionPackage;
}

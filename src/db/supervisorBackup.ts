import { DomainError } from '@/utils/errors';
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
  mergeRecordsByTimestamp,
  planSupervisorBatchMerge,
  type BatchMergePlan,
  type ConsolidatedInstitutionPackage,
  type RecordMergeCounts,
  type RoomBookingConflict,
  type SupervisorBackupPackage,
} from '@/utils/supervisorMerge';
import { emitAppDataChanged } from '@/utils/dataEvents';
import { STUDENT_CARD_ISSUANCE_VERSION } from '@/utils/studentQr';
import { db } from './database';
import { touchFields } from './records';
import type { AppNotification, Room } from './types';
import { assertHeadActor, getActiveUser } from './users';

export interface SupervisorExportResult {
  pkg: SupervisorBackupPackage;
  filename: string;
  totalRecords: number;
}

export async function exportSupervisorBackupPackage(
  institutionId: string,
  actorId: string,
  labels?: { allScope?: string; unassignedScope?: string },
): Promise<SupervisorExportResult> {
  const actor = await getActiveUser(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }

  const [
    institution,
    classes,
    teachers,
    rooms,
    timetableSlots,
    studentAbsences,
    continuousAbsences,
    teacherAbsences,
    notifications,
    entries,
    canteenEntries,
  ] = await Promise.all([
    db.institutions.get(institutionId),
    db.classes.where('institutionId').equals(institutionId).toArray(),
    db.teachers.where('institutionId').equals(institutionId).toArray(),
    db.rooms.where('institutionId').equals(institutionId).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
    db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
    db.continuousAbsences.where('institutionId').equals(institutionId).toArray(),
    db.teacherAbsences.where('institutionId').equals(institutionId).toArray(),
    db.notifications.where('institutionId').equals(institutionId).toArray(),
    db.entries.where('institutionId').equals(institutionId).toArray(),
    db.canteenEntries.where('institutionId').equals(institutionId).toArray(),
  ]);

  const activeClasses = classes.filter((c) => c.deletedAt === null);
  const classNameMap = Object.fromEntries(activeClasses.map((c) => [c.id, c.name]));
  const roomNameMap = Object.fromEntries(rooms.filter((r) => r.deletedAt === null).map((r) => [r.id, r.name]));
  const teacherNameMap = Object.fromEntries(
    teachers.filter((t) => t.deletedAt === null).map((t) => [t.id, t.name]),
  );

  const isHead = actor.role === 'head';
  const assignedClassIds = isHead
    ? activeClasses.map((c) => c.id)
    : actor.permissions?.assignedClasses ?? [];
  const assignedClassNames = assignedClassIds.map((id) => classNameMap[id]).filter(Boolean);
  const assignedSet = new Set(assignedClassIds);

  const filterByScope = <T extends { classId?: string; updatedBy: string | null }>(rows: T[]): T[] => {
    if (isHead || assignedSet.size === 0) return rows;
    return rows.filter((row) => (row.classId && assignedSet.has(row.classId)) || row.updatedBy === actor.id);
  };

  const scopedStudentAbsences = filterByScope(studentAbsences);
  const scopedContinuousAbsences = filterByScope(continuousAbsences);
  const scopedTimetableSlots = filterByScope(timetableSlots);

  const scopedTeacherAbsences =
    isHead || assignedSet.size === 0
      ? teacherAbsences
      : teacherAbsences.filter(
          (ta) =>
            ta.updatedBy === actor.id ||
            ta.lessons.length === 0 ||
            ta.lessons.some((lesson) => assignedSet.has(lesson.classId)),
        );

  const scopeLabel = buildSupervisorScopeLabel(
    actor.role,
    assignedClassNames,
    labels?.allScope ?? 'الكل',
    labels?.unassignedScope ?? 'عام',
  );

  const now = new Date();
  const pkg: SupervisorBackupPackage = {
    format: SUPERVISOR_BACKUP_FORMAT,
    version: SUPERVISOR_BACKUP_VERSION,
    cardVersion: STUDENT_CARD_ISSUANCE_VERSION,
    exportedAt: now.toISOString(),
    institutionId,
    institutionName: institution?.name ?? '',
    supervisor: {
      id: actor.id,
      name: actor.name,
      usernameKey: actor.usernameKey,
      role: actor.role,
    },
    scope: {
      role: actor.role,
      assignedClassIds,
      assignedClassNames,
      searchScope: isHead ? 'institution' : actor.permissions?.searchScope ?? 'assigned',
      scopeLabel,
      permissions: actor.permissions,
    },
    records: {
      studentAbsences: scopedStudentAbsences,
      continuousAbsences: scopedContinuousAbsences,
      teacherAbsences: scopedTeacherAbsences,
      timetableSlots: scopedTimetableSlots,
      rooms,
      notifications,
      entries,
      canteenEntries,
    },
    references: {
      classNames: classNameMap,
      roomNames: roomNameMap,
      teacherNames: teacherNameMap,
    },
  };

  const totalRecords =
    scopedStudentAbsences.length +
    scopedContinuousAbsences.length +
    scopedTeacherAbsences.length +
    scopedTimetableSlots.length +
    rooms.length +
    notifications.length +
    entries.length +
    canteenEntries.length;

  return {
    pkg,
    filename: buildSupervisorBackupFilename(actor.name, scopeLabel, now),
    totalRecords,
  };
}

export async function commitSupervisorBatchMerge(
  institutionId: string,
  actorId: string,
  packages: SupervisorBackupPackage[],
): Promise<BatchMergePlan> {
  const actor = await assertHeadActor(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }

  return db.transaction(
    'rw',
    [
      db.classes,
      db.rooms,
      db.studentAbsences,
      db.continuousAbsences,
      db.teacherAbsences,
      db.timetableSlots,
      db.notifications,
      db.entries,
      db.canteenEntries,
    ],
    async () => {
      const [
        classes,
        rooms,
        studentAbsences,
        continuousAbsences,
        teacherAbsences,
        timetableSlots,
        notifications,
        entries,
        canteenEntries,
      ] = await Promise.all([
        db.classes.where('institutionId').equals(institutionId).toArray(),
        db.rooms.where('institutionId').equals(institutionId).toArray(),
        db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
        db.continuousAbsences.where('institutionId').equals(institutionId).toArray(),
        db.teacherAbsences.where('institutionId').equals(institutionId).toArray(),
        db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
        db.notifications.where('institutionId').equals(institutionId).toArray(),
        db.entries.where('institutionId').equals(institutionId).toArray(),
        db.canteenEntries.where('institutionId').equals(institutionId).toArray(),
      ]);

      const classNamesById = Object.fromEntries(classes.map((c) => [c.id, c.name]));
      const plan = planSupervisorBatchMerge({
        institutionId,
        actorId,
        existing: {
          rooms,
          studentAbsences,
          continuousAbsences,
          teacherAbsences,
          timetableSlots,
          notifications,
          entries,
          canteenEntries,
        },
        packages,
        classNamesById,
      });

      if (plan.toPut.rooms.length > 0) await db.rooms.bulkPut(plan.toPut.rooms);
      if (plan.toPut.studentAbsences.length > 0) await db.studentAbsences.bulkPut(plan.toPut.studentAbsences);
      if (plan.toPut.continuousAbsences.length > 0) {
        await db.continuousAbsences.bulkPut(plan.toPut.continuousAbsences);
      }
      if (plan.toPut.teacherAbsences.length > 0) await db.teacherAbsences.bulkPut(plan.toPut.teacherAbsences);
      if (plan.toPut.timetableSlots.length > 0) await db.timetableSlots.bulkPut(plan.toPut.timetableSlots);
      if (plan.toPut.entries.length > 0) await db.entries.bulkPut(plan.toPut.entries);
      if (plan.toPut.canteenEntries.length > 0) await db.canteenEntries.bulkPut(plan.toPut.canteenEntries);
      if (plan.toPut.notifications.length > 0) await db.notifications.bulkPut(plan.toPut.notifications);

      return plan;
    },
  ).then((plan) => {
    emitAppDataChanged(['absences', 'entries', 'sync', 'timetable'], { reason: 'supervisor-batch-merge' });
    return plan;
  });
}

export type ConflictResolutionAction =
  | { action: 'assign_room'; roomId: string }
  | { action: 'accept_incoming' }
  | { action: 'keep_existing' };

export async function resolveRoomBookingConflict(
  institutionId: string,
  actorId: string,
  conflict: RoomBookingConflict,
  resolution: ConflictResolutionAction,
): Promise<void> {
  const actor = await assertHeadActor(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }

  await db.transaction('rw', [db.timetableSlots, db.rooms, db.notifications], async () => {
    const touch = touchFields(actorId);

    if (resolution.action === 'assign_room') {
      const [rooms, slots] = await Promise.all([
        db.rooms.where('institutionId').equals(institutionId).toArray(),
        db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
      ]);
      const freeIds = computeAvailableRooms(rooms, slots, conflict.day, conflict.period, conflict.incomingSlot.id);
      if (!freeIds.includes(resolution.roomId)) {
        throw new DomainError('supervisorSync.errors.roomNoLongerFree');
      }
      const updatedIncoming = {
        ...assignRoomToSlot(conflict.incomingSlot, conflict.incomingGroupNumber, resolution.roomId),
        ...touch,
      };
      await db.timetableSlots.put(updatedIncoming);
    } else if (resolution.action === 'accept_incoming') {
      const currentExisting = await db.timetableSlots.get(conflict.existingSlot.id);
      if (currentExisting && currentExisting.deletedAt === null) {
        const clearedExisting = {
          ...clearSpecificRoomFromSlot(currentExisting, conflict.roomId),
          ...touch,
        };
        await db.timetableSlots.put(clearedExisting);
      }
      await db.timetableSlots.put({ ...conflict.incomingSlot, ...touch });
    }
    // For 'keep_existing', we leave existing slot as-is and simply resolve the alert.

    const notif = await db.notifications.get(conflict.notificationId);
    if (notif) {
      await db.notifications.put({
        ...notif,
        read: true,
        resolved: true,
        ...touch,
      });
    }
  });
  emitAppDataChanged(['timetable', 'sync'], { reason: 'room-conflict-resolved' });
}

export async function getAvailableRoomsForSlot(
  institutionId: string,
  day: number,
  period: number,
  excludeSlotId?: string,
): Promise<Room[]> {
  const [rooms, slots] = await Promise.all([
    db.rooms.where('institutionId').equals(institutionId).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
  ]);
  const freeIds = new Set(computeAvailableRooms(rooms, slots, day, period, excludeSlotId));
  return rooms
    .filter((r) => r.deletedAt === null && freeIds.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface ConsolidatedExportResult {
  pkg: ConsolidatedInstitutionPackage;
  filename: string;
  totalRecords: number;
}

export async function exportConsolidatedInstitutionPackage(
  institutionId: string,
  actorId: string,
): Promise<ConsolidatedExportResult> {
  const actor = await assertHeadActor(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }

  const [
    institution,
    classes,
    students,
    teachers,
    rooms,
    timetableSlots,
    studentAbsences,
    continuousAbsences,
    teacherAbsences,
    notifications,
    entries,
    canteenEntries,
  ] = await Promise.all([
    db.institutions.get(institutionId),
    db.classes.where('institutionId').equals(institutionId).toArray(),
    db.students.where('institutionId').equals(institutionId).toArray(),
    db.teachers.where('institutionId').equals(institutionId).toArray(),
    db.rooms.where('institutionId').equals(institutionId).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
    db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
    db.continuousAbsences.where('institutionId').equals(institutionId).toArray(),
    db.teacherAbsences.where('institutionId').equals(institutionId).toArray(),
    db.notifications.where('institutionId').equals(institutionId).toArray(),
    db.entries.where('institutionId').equals(institutionId).toArray(),
    db.canteenEntries.where('institutionId').equals(institutionId).toArray(),
  ]);

  const now = new Date();
  const pkg: ConsolidatedInstitutionPackage = {
    format: CONSOLIDATED_PACKAGE_FORMAT,
    version: SUPERVISOR_BACKUP_VERSION,
    cardVersion: STUDENT_CARD_ISSUANCE_VERSION,
    exportedAt: now.toISOString(),
    institutionId,
    institutionName: institution?.name ?? '',
    exportedBy: {
      id: actor.id,
      name: actor.name,
      usernameKey: actor.usernameKey,
    },
    records: {
      classes,
      students,
      teachers,
      rooms,
      timetableSlots,
      studentAbsences,
      continuousAbsences,
      teacherAbsences,
      notifications,
      entries,
      canteenEntries,
    },
  };

  const totalRecords =
    classes.length +
    students.length +
    teachers.length +
    rooms.length +
    timetableSlots.length +
    studentAbsences.length +
    continuousAbsences.length +
    teacherAbsences.length +
    notifications.length +
    entries.length +
    canteenEntries.length;

  return {
    pkg,
    filename: buildConsolidatedPackageFilename(institution?.name ?? 'institution', now),
    totalRecords,
  };
}

export async function importConsolidatedInstitutionPackage(
  institutionId: string,
  actorId: string,
  pkg: ConsolidatedInstitutionPackage,
): Promise<RecordMergeCounts> {
  const actor = await getActiveUser(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }
  if (pkg.institutionId !== institutionId) {
    throw new DomainError('supervisorSync.errors.institutionMismatch');
  }

  return db.transaction(
    'rw',
    [
      db.classes,
      db.students,
      db.teachers,
      db.rooms,
      db.timetableSlots,
      db.studentAbsences,
      db.continuousAbsences,
      db.teacherAbsences,
      db.notifications,
      db.entries,
      db.canteenEntries,
    ],
    async () => {
      const [
        classes,
        students,
        teachers,
        rooms,
        timetableSlots,
        studentAbsences,
        continuousAbsences,
        teacherAbsences,
        notifications,
        entries,
        canteenEntries,
      ] = await Promise.all([
        db.classes.where('institutionId').equals(institutionId).toArray(),
        db.students.where('institutionId').equals(institutionId).toArray(),
        db.teachers.where('institutionId').equals(institutionId).toArray(),
        db.rooms.where('institutionId').equals(institutionId).toArray(),
        db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
        db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
        db.continuousAbsences.where('institutionId').equals(institutionId).toArray(),
        db.teacherAbsences.where('institutionId').equals(institutionId).toArray(),
        db.notifications.where('institutionId').equals(institutionId).toArray(),
        db.entries.where('institutionId').equals(institutionId).toArray(),
        db.canteenEntries.where('institutionId').equals(institutionId).toArray(),
      ]);

      const mClasses = mergeRecordsByTimestamp(classes, [pkg.records.classes], institutionId);
      const mStudents = mergeRecordsByTimestamp(students, [pkg.records.students], institutionId);
      const mTeachers = mergeRecordsByTimestamp(teachers, [pkg.records.teachers], institutionId);
      const mRooms = mergeRecordsByTimestamp(rooms, [pkg.records.rooms], institutionId);
      const mSlots = mergeRecordsByTimestamp(timetableSlots, [pkg.records.timetableSlots], institutionId);
      const mStudentAbsences = mergeRecordsByTimestamp(studentAbsences, [pkg.records.studentAbsences], institutionId);
      const mContinuous = mergeRecordsByTimestamp(continuousAbsences, [pkg.records.continuousAbsences], institutionId);
      const mTeacherAbsences = mergeRecordsByTimestamp(teacherAbsences, [pkg.records.teacherAbsences], institutionId);
      const mNotifications = mergeRecordsByTimestamp(notifications, [pkg.records.notifications], institutionId);
      const mEntries = mergeRecordsByTimestamp(entries, [pkg.records.entries], institutionId);
      const mCanteen = mergeRecordsByTimestamp(canteenEntries, [pkg.records.canteenEntries], institutionId);

      const existingStudentsById = new Map(students.map((item) => [item.id, item]));
      const preservedStudentPuts = mStudents.toPut.map((incomingStudent) => {
        const prev = existingStudentsById.get(incomingStudent.id);
        const preservedCode = incomingStudent.cardCode?.trim() || prev?.cardCode?.trim() || null;
        return preservedCode !== (incomingStudent.cardCode ?? null)
          ? { ...incomingStudent, cardCode: preservedCode }
          : incomingStudent;
      });

      if (mClasses.toPut.length) await db.classes.bulkPut(mClasses.toPut);
      if (preservedStudentPuts.length) await db.students.bulkPut(preservedStudentPuts);
      if (mTeachers.toPut.length) await db.teachers.bulkPut(mTeachers.toPut);
      if (mRooms.toPut.length) await db.rooms.bulkPut(mRooms.toPut);
      if (mSlots.toPut.length) await db.timetableSlots.bulkPut(mSlots.toPut);
      if (mStudentAbsences.toPut.length) await db.studentAbsences.bulkPut(mStudentAbsences.toPut);
      if (mContinuous.toPut.length) await db.continuousAbsences.bulkPut(mContinuous.toPut);
      if (mTeacherAbsences.toPut.length) await db.teacherAbsences.bulkPut(mTeacherAbsences.toPut);
      if (mNotifications.toPut.length) await db.notifications.bulkPut(mNotifications.toPut);
      if (mEntries.toPut.length) await db.entries.bulkPut(mEntries.toPut);
      if (mCanteen.toPut.length) await db.canteenEntries.bulkPut(mCanteen.toPut);

      const all = [
        mClasses,
        mStudents,
        mTeachers,
        mRooms,
        mSlots,
        mStudentAbsences,
        mContinuous,
        mTeacherAbsences,
        mNotifications,
        mEntries,
        mCanteen,
      ];

      return all.reduce<RecordMergeCounts>(
        (acc, r) => ({
          added: acc.added + r.added,
          updated: acc.updated + r.updated,
          skipped: acc.skipped + r.skipped,
          conflicts: 0,
        }),
        { added: 0, updated: 0, skipped: 0, conflicts: 0 },
      );
    },
  ).then((counts) => {
    emitAppDataChanged(['absences', 'entries', 'sync', 'students', 'timetable'], {
      reason: 'consolidated-package-import',
    });
    return counts;
  });
}

export async function listNotifications(institutionId: string): Promise<AppNotification[]> {
  const rows = await db.notifications.where('institutionId').equals(institutionId).toArray();
  return rows
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function countUnreadNotifications(institutionId: string): Promise<number> {
  const rows = await db.notifications.where('institutionId').equals(institutionId).toArray();
  return rows.filter((n) => n.deletedAt === null && !n.read).length;
}

export async function markNotificationRead(notificationId: string, actorId: string): Promise<void> {
  const notif = await db.notifications.get(notificationId);
  if (!notif || notif.deletedAt !== null) return;
  await db.notifications.put({ ...notif, read: true, ...touchFields(actorId) });
}

export async function markAllNotificationsRead(institutionId: string, actorId: string): Promise<void> {
  const rows = await db.notifications.where('institutionId').equals(institutionId).toArray();
  const unread = rows.filter((n) => n.deletedAt === null && !n.read);
  if (unread.length === 0) return;
  const touch = touchFields(actorId);
  await db.notifications.bulkPut(unread.map((n) => ({ ...n, read: true, ...touch })));
}

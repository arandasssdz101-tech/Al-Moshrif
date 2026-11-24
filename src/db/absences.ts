import { DomainError } from '@/utils/errors';
import { isSchoolDay } from '@/utils/absenceReports';
import { classLessonsForDay, isIsoDate, slotHasTeacher, teacherLessonsForDay, weekdayOfDate } from '@/utils/absences';
import { todayIso } from '@/utils/dates';
import { emitAppDataChanged } from '@/utils/dataEvents';
import { getEntrySettings } from '@/utils/entry';
import { planGateEntryAbsenceSync } from '@/utils/gateAbsenceSync';
import { assertCanEditClassIn, canAccessClass, getModuleAccess, getStudentAccess, type StudentAccess } from './access';
import { syncContinuousAbsencesUpTo } from './continuousAbsences';
import { db } from './database';
import { closureIdFor, listGateEntriesForDate } from './entries';
import { getInstitution } from './institutions';
import { newBaseFields, touchFields } from './records';
import { assertHeadActor } from './users';
import type {
  ContinuousAbsence,
  EntryDayClosure,
  SchoolClass,
  Student,
  StudentAbsence,
  Teacher,
  TeacherAbsence,
  TeacherAbsenceReason,
  TimetableSlot,
  User,
} from './types';

export interface AbsenceWorkspace {
  access: StudentAccess;
  studentAccess?: StudentAccess;
  workingDays: number[];
  holidayDates: string[];
  classes: SchoolClass[];
  students: Student[];
  slots: TimetableSlot[];
  studentAbsences: StudentAbsence[];
  continuousAbsences: ContinuousAbsence[];
  teachers: Teacher[];
  teacherAbsences: TeacherAbsence[];
  supervisors: User[];
}

export async function loadAbsenceWorkspace(institutionId: string, actorId: string): Promise<AbsenceWorkspace> {
  const [access, studentAccess] = await Promise.all([
    getModuleAccess(actorId, 'attendance'),
    getStudentAccess(actorId),
  ]);
  if (access.canEdit) {
    await syncContinuousAbsencesUpTo(institutionId, actorId, todayIso());
  }
  const institution = await getInstitution(institutionId);
  const [classes, students, slots, studentAbsences, continuousAbsences, teachers, teacherAbsences, users] =
    await Promise.all([
      db.classes.where('institutionId').equals(institutionId).toArray(),
      db.students.where('institutionId').equals(institutionId).toArray(),
      db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
      db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
      db.continuousAbsences.where('institutionId').equals(institutionId).toArray(),
      access.isHead ? db.teachers.where('institutionId').equals(institutionId).toArray() : Promise.resolve([]),
      access.isHead ? db.teacherAbsences.where('institutionId').equals(institutionId).toArray() : Promise.resolve([]),
      access.isHead ? db.users.where('institutionId').equals(institutionId).toArray() : Promise.resolve([]),
    ]);
  const visibleClasses = classes
    .filter((schoolClass) => schoolClass.deletedAt == null && canAccessClass(access, schoolClass.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const visibleClassIds = new Set(visibleClasses.map((item) => item.id));
  const visibleStudents = students.filter(
    (student) => student.deletedAt == null && visibleClassIds.has(student.classId),
  );
  const visibleStudentIds = new Set(visibleStudents.map((student) => student.id));
  return {
    access,
    studentAccess,
    workingDays: institution.workingDays,
    holidayDates: institution.holidays.map((holiday) => holiday.date),
    classes: visibleClasses,
    students: visibleStudents,
    slots: slots.filter((slot) => slot.deletedAt == null && visibleClassIds.has(slot.classId)),
    studentAbsences: studentAbsences.filter(
      (record) =>
        record.deletedAt == null &&
        (visibleClassIds.has(record.classId) || visibleStudentIds.has(record.studentId)),
    ),
    continuousAbsences: continuousAbsences
      .filter(
        (record) =>
          record.deletedAt == null &&
          (visibleClassIds.has(record.classId) || visibleStudentIds.has(record.studentId)),
      )
      .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    teachers: teachers.filter((teacher) => teacher.deletedAt == null).sort((a, b) => a.name.localeCompare(b.name)),
    teacherAbsences: teacherAbsences.filter((record) => record.deletedAt == null),
    supervisors: users
      .filter((user) => user.role === 'supervisor' && user.status === 'approved' && user.deletedAt == null)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface StudentAbsenceEntry {
  studentId: string;
  period: number;
  justified: boolean;
}

function assertValidDate(date: string, workingDays: number[]): void {
  if (!isIsoDate(date)) throw new DomainError('validation.invalidDate');
  if (!workingDays.includes(weekdayOfDate(date))) throw new DomainError('validation.dayNotWorking');
}

export async function saveClassDayAbsences(
  institutionId: string,
  actorId: string,
  classId: string,
  date: string,
  entries: StudentAbsenceEntry[],
): Promise<void> {
  assertCanEditClassIn(await getModuleAccess(actorId, 'attendance'), classId);
  const schoolClass = await db.classes.get(classId);
  if (!schoolClass || schoolClass.deletedAt != null) throw new DomainError('validation.classNotFound');
  const institution = await getInstitution(institutionId);
  assertValidDate(date, institution.workingDays);

  const day = weekdayOfDate(date);
  const slots = await db.timetableSlots.where('classId').equals(classId).filter((slot) => slot.deletedAt == null).toArray();
  const lessons = classLessonsForDay(slots, classId, day);
  const lessonByPeriod = new Map(lessons.map((lesson) => [lesson.period, lesson]));

  const students = await db.students.where('classId').equals(classId).filter((student) => student.deletedAt == null).toArray();
  const studentIds = new Set(students.map((student) => student.id));

  const unique = new Map<string, StudentAbsenceEntry>();
  for (const entry of entries) {
    if (!lessonByPeriod.has(entry.period)) throw new DomainError('validation.invalidSlot');
    if (!studentIds.has(entry.studentId)) throw new DomainError('errors.notFound');
    unique.set(`${entry.studentId}|${entry.period}`, entry);
  }

  await db.transaction('rw', db.studentAbsences, async () => {
    const existing = await db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter(
        (record) =>
          record.deletedAt == null &&
          record.date === date &&
          record.status !== 'late' &&
          (record.classId === classId || studentIds.has(record.studentId)),
      )
      .toArray();
    const existingByKey = new Map(existing.map((record) => [`${record.studentId}|${record.period}`, record]));
    const now = new Date().toISOString();
    for (const record of existing) {
      await db.studentAbsences.put({ ...record, deletedAt: now, ...touchFields(actorId) });
    }
    for (const entry of unique.values()) {
      const lesson = lessonByPeriod.get(entry.period);
      if (!lesson) continue;
      const prev = existingByKey.get(`${entry.studentId}|${entry.period}`);
      const keepGateSource = prev?.source === 'gate' && prev.justified === entry.justified;
      const keepContinuousSource = prev?.source === 'continuous' && prev.justified === entry.justified;
      await db.studentAbsences.add({
        ...newBaseFields(institutionId, actorId),
        classId,
        studentId: entry.studentId,
        date,
        period: entry.period,
        subject: lesson.subject,
        justified: entry.justified,
        ...(keepGateSource ? { source: 'gate' as const } : {}),
        ...(keepContinuousSource
          ? {
              source: 'continuous' as const,
              ...(prev.continuousAbsenceId ? { continuousAbsenceId: prev.continuousAbsenceId } : {}),
            }
          : {}),
      });
    }
  });
  emitAppDataChanged(['absences'], { date, reason: 'save-class-absences' });
}

export async function recordQuickStudentAttendance(
  institutionId: string,
  actorId: string,
  input: {
    classId: string;
    studentId: string;
    date: string;
    period: number;
    subject: string;
    status: 'absent' | 'late';
  },
): Promise<StudentAbsence> {
  assertCanEditClassIn(await getModuleAccess(actorId, 'attendance'), input.classId);
  const institution = await getInstitution(institutionId);
  if (institution.cardAbsenceEnabled === false) {
    throw new DomainError('absences.errors.cardAbsenceDisabled');
  }
  if (!isIsoDate(input.date)) throw new DomainError('validation.invalidDate');
  const student = await db.students.get(input.studentId);
  if (!student || student.deletedAt != null) throw new DomainError('errors.notFound');

  const existing = await db.studentAbsences
    .where('classId')
    .equals(input.classId)
    .filter(
      (record) =>
        record.deletedAt == null &&
        record.studentId === input.studentId &&
        record.date === input.date &&
        record.period === input.period,
    )
    .first();

  const justified = input.status === 'late';
  if (existing) {
    const updated: StudentAbsence = {
      ...existing,
      subject: input.subject || existing.subject,
      justified,
      status: input.status,
      ...touchFields(actorId),
    };
    await db.studentAbsences.put(updated);
    emitAppDataChanged(['absences'], { date: input.date, reason: 'quick-attendance' });
    return updated;
  }

  const created: StudentAbsence = {
    ...newBaseFields(institutionId, actorId),
    classId: input.classId,
    studentId: input.studentId,
    date: input.date,
    period: input.period,
    subject: input.subject || '—',
    justified,
    status: input.status,
  };
  await db.studentAbsences.add(created);
  emitAppDataChanged(['absences'], { date: input.date, reason: 'quick-attendance' });
  return created;
}

export interface GateSyncResult {
  enrolledCount: number;
  enteredCount: number;
  notEnteredCount: number;
  lateCount: number;
  addedCount: number;
  removedCount: number;
  absentStudentsAfterSync: number;
}

export async function syncAbsencesWithGateEntries(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<GateSyncResult> {
  const access = await getModuleAccess(actorId, 'attendance');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');
  if (!isIsoDate(date)) throw new DomainError('validation.invalidDate');

  const institution = await getInstitution(institutionId);
  const holidaySet = new Set(institution.holidays.map((item) => item.date));
  if (!isSchoolDay(date, institution.workingDays, holidaySet)) {
    throw new DomainError('validation.dayNotWorking');
  }

  const settings = getEntrySettings(institution);
  const [allStudents, allSlots, entries, existingAbsences] = await Promise.all([
    db.students.where('institutionId').equals(institutionId).filter((s) => s.deletedAt == null).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).filter((t) => t.deletedAt == null).toArray(),
    listGateEntriesForDate(institutionId, date),
    db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter((record) => record.deletedAt == null && record.date === date)
      .toArray(),
  ]);

  const accessibleStudents = allStudents.filter((student) => canAccessClass(access, student.classId));
  const accessibleStudentIds = new Set(accessibleStudents.map((s) => s.id));
  const accessibleSlots = allSlots.filter((slot) => canAccessClass(access, slot.classId));
  const accessibleAbsences = existingAbsences.filter(
    (record) => canAccessClass(access, record.classId) || accessibleStudentIds.has(record.studentId),
  );

  const plan = planGateEntryAbsenceSync({
    date,
    students: accessibleStudents,
    slots: accessibleSlots,
    entries,
    existingAbsences: accessibleAbsences,
    markLateMissedLessons: settings.markLateMissedLessons,
    eveningStartTime: settings.eveningStartTime,
  });

  const now = new Date().toISOString();
  const deleteIdSet = new Set(plan.toSoftDeleteIds);
  const toInsert: StudentAbsence[] = plan.toAdd.map((item) => ({
    ...newBaseFields(institutionId, actorId),
    classId: item.classId,
    studentId: item.studentId,
    date,
    period: item.period,
    subject: item.subject,
    justified: false,
    status: 'absent',
    source: 'gate',
  }));

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    for (const record of accessibleAbsences) {
      if (!deleteIdSet.has(record.id)) continue;
      await db.studentAbsences.put({
        ...record,
        deletedAt: now,
        ...touchFields(actorId),
      });
    }
    if (toInsert.length > 0) {
      await db.studentAbsences.bulkAdd(toInsert);
    }

    const closureId = closureIdFor(institutionId, date);
    const existingClosure = await db.entryClosures.get(closureId);
    const remainingIds = (existingClosure?.createdAbsenceIds ?? []).filter((id) => !deleteIdSet.has(id));
    const nextClosure: EntryDayClosure = {
      id: closureId,
      institutionId,
      date,
      closed: existingClosure?.closed ?? false,
      closedAt: existingClosure?.closedAt ?? null,
      closedBy: existingClosure?.closedBy ?? null,
      createdAbsenceIds: [...remainingIds, ...toInsert.map((item) => item.id)],
      autoAbsencesSyncedAt: now,
      updatedAt: now,
    };
    await db.entryClosures.put(nextClosure);
  });

  emitAppDataChanged(['absences', 'sync'], { date, reason: 'gate-sync' });

  return {
    enrolledCount: plan.enrolledCount,
    enteredCount: plan.enteredCount,
    notEnteredCount: plan.notEnteredCount,
    lateCount: plan.lateCount,
    addedCount: toInsert.length,
    removedCount: plan.toSoftDeleteIds.length,
    absentStudentsAfterSync: plan.absentStudentsAfterSync,
  };
}

export type ResetDayAbsencesOptions =
  | {
      mode: 'all';
      classId?: string | null;
      onlyGate?: boolean;
    }
  | {
      mode: 'manual';
      absenceIds: string[];
    };

export interface ResetDayAbsencesResult {
  removedCount: number;
  affectedStudentsCount: number;
}

export async function resetDayAbsences(
  institutionId: string,
  actorId: string,
  date: string,
  options: ResetDayAbsencesOptions,
): Promise<ResetDayAbsencesResult> {
  const access = await getModuleAccess(actorId, 'attendance');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');
  if (!isIsoDate(date)) throw new DomainError('validation.invalidDate');

  if (options.mode === 'all' && options.classId) {
    assertCanEditClassIn(access, options.classId);
  }

  const now = new Date().toISOString();
  const targetIdSet = options.mode === 'manual' ? new Set(options.absenceIds) : null;
  let removedCount = 0;
  const affectedStudents = new Set<string>();

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    const records = await db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter(
        (record) =>
          record.deletedAt == null &&
          record.date === date &&
          record.status !== 'late' &&
          record.source !== 'continuous' &&
          canAccessClass(access, record.classId),
      )
      .toArray();

    const toDelete = records.filter((record) => {
      if (options.mode === 'manual') {
        return targetIdSet !== null && targetIdSet.has(record.id);
      }
      if (options.classId && record.classId !== options.classId) return false;
      if (options.onlyGate && record.source !== 'gate') return false;
      return true;
    });

    const deletedIdSet = new Set<string>();
    for (const record of toDelete) {
      await db.studentAbsences.put({
        ...record,
        deletedAt: now,
        ...touchFields(actorId),
      });
      deletedIdSet.add(record.id);
      affectedStudents.add(record.studentId);
      removedCount += 1;
    }

    const closureId = closureIdFor(institutionId, date);
    const existingClosure = await db.entryClosures.get(closureId);
    if (existingClosure) {
      const remainingGateCount = await db.studentAbsences
        .where('institutionId')
        .equals(institutionId)
        .filter((item) => item.deletedAt == null && item.date === date && item.source === 'gate')
        .count();
      const clearedAllDay =
        options.mode === 'all' && !options.classId;
      await db.entryClosures.put({
        ...existingClosure,
        createdAbsenceIds: existingClosure.createdAbsenceIds.filter((id) => !deletedIdSet.has(id)),
        autoAbsencesSyncedAt:
          clearedAllDay || remainingGateCount === 0 ? null : existingClosure.autoAbsencesSyncedAt,
        updatedAt: now,
      });
    }
  });

  emitAppDataChanged(['absences', 'sync'], { date, reason: 'reset-absences' });

  return {
    removedCount,
    affectedStudentsCount: affectedStudents.size,
  };
}

export async function saveTeacherAbsence(
  institutionId: string,
  actorId: string,
  teacherId: string,
  date: string,
  periods: number[],
  reason: { reason?: TeacherAbsenceReason; reasonNote: string },
): Promise<void> {
  await assertHeadActor(actorId);
  const teacher = await db.teachers.get(teacherId);
  if (!teacher || teacher.deletedAt !== null) throw new DomainError('teachers.errors.notFound');
  const institution = await getInstitution(institutionId);
  assertValidDate(date, institution.workingDays);

  const [classes, allTeacherSlots] = await Promise.all([
    db.classes
      .where('institutionId')
      .equals(institutionId)
      .filter((schoolClass) => schoolClass.deletedAt === null)
      .toArray(),
    db.timetableSlots
      .where('institutionId')
      .equals(institutionId)
      .filter((slot) => slot.deletedAt === null && slotHasTeacher(slot, teacherId))
      .toArray(),
  ]);
  const activeClassIds = new Set(classes.map((schoolClass) => schoolClass.id));
  const slots = allTeacherSlots.filter((slot) => activeClassIds.has(slot.classId));
  const teacherLessons = teacherLessonsForDay(slots, teacherId, weekdayOfDate(date));
  const selected = teacherLessons.filter((lesson) => periods.includes(lesson.period));
  if (selected.length !== new Set(periods).size) throw new DomainError('validation.invalidSlot');

  await db.transaction('rw', db.teacherAbsences, async () => {
    const existing = await db.teacherAbsences
      .where('teacherId')
      .equals(teacherId)
      .filter((record) => record.deletedAt === null && record.date === date)
      .toArray();
    for (const record of existing) {
      await db.teacherAbsences.put({ ...record, deletedAt: new Date().toISOString(), ...touchFields(actorId) });
    }
    if (selected.length > 0) {
      await db.teacherAbsences.add({
        ...newBaseFields(institutionId, actorId),
        teacherId,
        date,
        lessons: selected,
        reason: reason.reason,
        reasonNote: reason.reasonNote.trim(),
      });
    }
  });
  emitAppDataChanged(['absences'], { date, reason: 'teacher-absence' });
}

export async function deleteTeacherAbsence(absenceId: string, actorId: string): Promise<void> {
  await assertHeadActor(actorId);
  const record = await db.teacherAbsences.get(absenceId);
  if (!record || record.deletedAt !== null) throw new DomainError('errors.notFound');
  await db.teacherAbsences.put({ ...record, deletedAt: new Date().toISOString(), ...touchFields(actorId) });
  emitAppDataChanged(['absences'], { date: record.date, reason: 'teacher-absence' });
}

export async function restoreTeacherAbsence(absenceId: string, actorId: string): Promise<void> {
  await assertHeadActor(actorId);
  const record = await db.teacherAbsences.get(absenceId);
  if (!record) throw new DomainError('errors.notFound');
  const clash = await db.teacherAbsences
    .where('teacherId')
    .equals(record.teacherId)
    .filter((item) => item.deletedAt === null && item.date === record.date)
    .count();
  if (clash > 0) throw new DomainError('absences.errors.alreadyRecorded');
  await db.teacherAbsences.put({ ...record, deletedAt: null, ...touchFields(actorId) });
  emitAppDataChanged(['absences'], { date: record.date, reason: 'teacher-absence' });
}

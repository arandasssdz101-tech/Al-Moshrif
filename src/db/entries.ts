import { DomainError } from '@/utils/errors';
import { isEnrolledOn, isSchoolDay } from '@/utils/absenceReports';
import { classLessonsForDay, weekdayOfDate } from '@/utils/absences';
import {
  acceptedEntryByStudent,
  computeLateMissedPeriods,
  getEntrySettings,
  getOrCreateDeviceId,
  planAutoAbsencesForStart,
  planStudentGateAbsenceSync,
} from '@/utils/entry';
import { planEntryMerge, type EntryMergePlan } from '@/utils/entryMerge';
import { canAccessClass, getModuleAccess, type StudentAccess } from './access';
import { db } from './database';
import { getInstitution, isCardAbsenceEnabled } from './institutions';
import { newBaseFields, touchFields } from './records';
import type {
  EntryDayClosure,
  EntryResult,
  EntrySource,
  GateEntry,
  Institution,
  SchoolClass,
  Student,
  StudentAbsence,
  TimetableSlot,
} from './types';

export interface EntryWorkspace {
  access: StudentAccess;
  institution: Institution;
  classes: SchoolClass[];
  students: Student[];
  slots: TimetableSlot[];
}

export function closureIdFor(institutionId: string, date: string): string {
  return `${institutionId}|${date}`;
}

export async function loadEntryWorkspace(institutionId: string, actorId: string): Promise<EntryWorkspace> {
  const access = await getModuleAccess(actorId, 'entry');
  const institution = await getInstitution(institutionId);
  const [classes, students, slots] = await Promise.all([
    db.classes.where('institutionId').equals(institutionId).toArray(),
    db.students.where('institutionId').equals(institutionId).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).toArray(),
  ]);

  // At the school gate, scanning may receive any student in the institution; supervisors can view/filter classes according to access.
  const activeClasses = classes
    .filter((item) => item.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const visibleClasses = access.isHead
    ? activeClasses
    : activeClasses.filter((item) => canAccessClass(access, item.id) || access.searchScope === 'institution');
  const classIds = new Set((visibleClasses.length > 0 ? visibleClasses : activeClasses).map((item) => item.id));

  return {
    access,
    institution,
    classes: visibleClasses.length > 0 ? visibleClasses : activeClasses,
    students: students
      .filter((item) => item.deletedAt === null && classIds.has(item.classId))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    slots: slots.filter((item) => item.deletedAt === null && classIds.has(item.classId)),
  };
}

export async function listGateEntriesForDate(institutionId: string, date: string): Promise<GateEntry[]> {
  const rows = await db.entries
    .where('date')
    .equals(date)
    .filter((entry) => entry.institutionId === institutionId && entry.deletedAt === null)
    .toArray();
  return rows.sort((a, b) => b.time.localeCompare(a.time) || b.createdAt.localeCompare(a.createdAt));
}

export async function listAllGateEntries(institutionId: string, date?: string): Promise<GateEntry[]> {
  if (date) {
    return listGateEntriesForDate(institutionId, date);
  }
  const rows = await db.entries
    .where('institutionId')
    .equals(institutionId)
    .filter((entry) => entry.deletedAt === null)
    .toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
}

export async function getEntryDayClosure(institutionId: string, date: string): Promise<EntryDayClosure | null> {
  return (await db.entryClosures.get(closureIdFor(institutionId, date))) ?? null;
}

export async function listStudentAbsencesForDate(
  institutionId: string,
  date: string,
): Promise<StudentAbsence[]> {
  return db.studentAbsences
    .where('institutionId')
    .equals(institutionId)
    .filter((record) => record.deletedAt === null && record.date === date)
    .toArray();
}

export interface RecordGateEntryInput {
  studentId: string | null;
  scannedCode: string;
  date: string;
  time: string;
  result: EntryResult;
  late: boolean;
  minutesLate: number;
  source: EntrySource;
}

export async function recordGateEntry(
  institutionId: string,
  actorId: string,
  input: RecordGateEntryInput,
): Promise<GateEntry> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const entry: GateEntry = {
    ...newBaseFields(institutionId, actorId),
    studentId: input.studentId,
    scannedCode: input.scannedCode,
    date: input.date,
    time: input.time,
    result: input.result,
    late: input.late,
    minutesLate: input.minutesLate,
    source: input.source,
    supervisorId: actorId,
    deviceId: getOrCreateDeviceId(),
  };

  await db.entries.add(entry);
  return entry;
}

export async function softDeleteGateEntry(entryId: string, actorId: string): Promise<void> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');
  const existing = await db.entries.get(entryId);
  if (!existing || existing.deletedAt !== null) throw new DomainError('errors.notFound');
  await db.entries.put({
    ...existing,
    deletedAt: new Date().toISOString(),
    ...touchFields(actorId),
  });
}

export async function removeStudentDayAbsences(
  institutionId: string,
  actorId: string,
  studentId: string,
  date: string,
): Promise<number> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const records = await db.studentAbsences
    .where('institutionId')
    .equals(institutionId)
    .filter((item) => item.deletedAt === null && item.studentId === studentId && item.date === date)
    .toArray();

  if (records.length === 0) return 0;
  const now = new Date().toISOString();
  await db.transaction('rw', db.studentAbsences, async () => {
    for (const record of records) {
      await db.studentAbsences.put({
        ...record,
        deletedAt: now,
        ...touchFields(actorId),
      });
    }
  });
  return records.length;
}

export async function ensureGateAutoAbsencesStarted(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<{ started: boolean; createdCount: number }> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) return { started: false, createdCount: 0 };

  const institution = await getInstitution(institutionId);
  if (!isCardAbsenceEnabled(institution)) return { started: false, createdCount: 0 };

  const holidaySet = new Set(institution.holidays.map((item) => item.date));
  if (!isSchoolDay(date, institution.workingDays, holidaySet)) {
    return { started: false, createdCount: 0 };
  }

  const trackingStart = institution.canteenTrackingStart ?? null;
  if (trackingStart && date < trackingStart) {
    return { started: false, createdCount: 0 };
  }

  const closureId = closureIdFor(institutionId, date);
  const existingClosure = await db.entryClosures.get(closureId);
  if (existingClosure?.autoAbsencesSyncedAt) {
    return { started: false, createdCount: 0 };
  }

  const settings = getEntrySettings(institution);
  const [students, slots, entries, existingAbsences] = await Promise.all([
    db.students.where('institutionId').equals(institutionId).filter((s) => s.deletedAt === null).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).filter((t) => t.deletedAt === null).toArray(),
    listGateEntriesForDate(institutionId, date),
    listStudentAbsencesForDate(institutionId, date),
  ]);

  const planned = planAutoAbsencesForStart({
    date,
    students,
    slots,
    entries,
    existingAbsences,
    settings,
  });

  const now = new Date().toISOString();
  let createdCount = 0;

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    const latestClosure = await db.entryClosures.get(closureId);
    if (latestClosure?.autoAbsencesSyncedAt) return;

    const toInsert: StudentAbsence[] = planned.map((item) => ({
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

    if (toInsert.length > 0) {
      await db.studentAbsences.bulkAdd(toInsert);
      createdCount = toInsert.length;
    }

    const prevIds = latestClosure?.createdAbsenceIds ?? [];
    const nextClosure: EntryDayClosure = {
      id: closureId,
      institutionId,
      date,
      closed: latestClosure?.closed ?? false,
      closedAt: latestClosure?.closedAt ?? null,
      closedBy: latestClosure?.closedBy ?? null,
      createdAbsenceIds: [...prevIds, ...toInsert.map((item) => item.id)],
      autoAbsencesSyncedAt: now,
      updatedAt: now,
    };
    await db.entryClosures.put(nextClosure);
  });

  return { started: true, createdCount };
}

export async function syncStudentGateAbsenceOnAcceptedScan(
  institutionId: string,
  actorId: string,
  student: Pick<Student, 'id' | 'classId'>,
  date: string,
  entryTime: string,
  late: boolean,
): Promise<{ removedCount: number; addedCount: number; hasManualAbsence: boolean }> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) {
    return { removedCount: 0, addedCount: 0, hasManualAbsence: false };
  }

  const institution = await getInstitution(institutionId);
  const existingAbsences = await db.studentAbsences
    .where('institutionId')
    .equals(institutionId)
    .filter((item) => item.deletedAt === null && item.studentId === student.id && item.date === date)
    .toArray();

  if (!isCardAbsenceEnabled(institution)) {
    return {
      removedCount: 0,
      addedCount: 0,
      hasManualAbsence: existingAbsences.length > 0,
    };
  }

  const settings = getEntrySettings(institution);
  const slots = await db.timetableSlots
    .where('classId')
    .equals(student.classId)
    .filter((item) => item.deletedAt === null)
    .toArray();

  const plan = planStudentGateAbsenceSync({
    classId: student.classId,
    date,
    entryTime,
    late,
    slots,
    existingStudentAbsences: existingAbsences,
    markLateMissedLessons: settings.markLateMissedLessons,
  });

  const now = new Date().toISOString();
  if (plan.toSoftDeleteIds.length > 0 || plan.toAdd.length > 0) {
    const deleteSet = new Set(plan.toSoftDeleteIds);
    await db.transaction('rw', db.studentAbsences, async () => {
      for (const record of existingAbsences) {
        if (!deleteSet.has(record.id)) continue;
        await db.studentAbsences.put({
          ...record,
          deletedAt: now,
          ...touchFields(actorId),
        });
      }
      for (const item of plan.toAdd) {
        await db.studentAbsences.add({
          ...newBaseFields(institutionId, actorId),
          classId: student.classId,
          studentId: student.id,
          date,
          period: item.period,
          subject: item.subject || '—',
          justified: false,
          status: 'absent',
          source: 'gate',
        });
      }
    });
  }

  return {
    removedCount: plan.toSoftDeleteIds.length,
    addedCount: plan.toAdd.length,
    hasManualAbsence: plan.hasManualAbsence,
  };
}

export async function restoreStudentGateAbsencesAfterUndo(
  institutionId: string,
  actorId: string,
  studentId: string,
  date: string,
): Promise<number> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) return 0;

  const institution = await getInstitution(institutionId);
  if (!isCardAbsenceEnabled(institution)) return 0;

  const closure = await db.entryClosures.get(closureIdFor(institutionId, date));
  if (!closure?.autoAbsencesSyncedAt) return 0;

  const holidaySet = new Set(institution.holidays.map((item) => item.date));
  if (!isSchoolDay(date, institution.workingDays, holidaySet)) return 0;

  const trackingStart = institution.canteenTrackingStart ?? null;
  if (trackingStart && date < trackingStart) return 0;

  const [student, entries, existingAbsences] = await Promise.all([
    db.students.get(studentId),
    listGateEntriesForDate(institutionId, date),
    db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter((item) => item.deletedAt === null && item.studentId === studentId && item.date === date)
      .toArray(),
  ]);

  if (!student || student.deletedAt !== null || !isEnrolledOn(student, date)) return 0;

  const acceptedMap = acceptedEntryByStudent(entries, date);
  if (acceptedMap.has(studentId)) return 0;

  const slots = await db.timetableSlots
    .where('classId')
    .equals(student.classId)
    .filter((item) => item.deletedAt === null)
    .toArray();
  const lessons = classLessonsForDay(slots, student.classId, weekdayOfDate(date));
  if (lessons.length === 0) return 0;

  const existingPeriods = new Set(existingAbsences.map((item) => item.period));
  const toInsert: StudentAbsence[] = lessons
    .filter((lesson) => !existingPeriods.has(lesson.period))
    .map((lesson) => ({
      ...newBaseFields(institutionId, actorId),
      classId: student.classId,
      studentId: student.id,
      date,
      period: lesson.period,
      subject: lesson.subject || '—',
      justified: false,
      status: 'absent',
      source: 'gate',
    }));

  if (toInsert.length === 0) return 0;
  await db.transaction('rw', db.studentAbsences, async () => {
    await db.studentAbsences.bulkAdd(toInsert);
  });
  return toInsert.length;
}

export async function clearGateAutoAbsencesForDay(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<number> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const now = new Date().toISOString();
  let removed = 0;

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    const records = await db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter((item) => item.deletedAt === null && item.date === date && item.source === 'gate')
      .toArray();

    for (const record of records) {
      await db.studentAbsences.put({
        ...record,
        deletedAt: now,
        ...touchFields(actorId),
      });
      removed += 1;
    }

    const closureId = closureIdFor(institutionId, date);
    const existing = await db.entryClosures.get(closureId);
    if (existing) {
      await db.entryClosures.put({
        ...existing,
        autoAbsencesSyncedAt: null,
        createdAbsenceIds: [],
        updatedAt: now,
      });
    }
  });

  return removed;
}

export interface PlannedAbsenceItem {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  kind: 'notEntered' | 'lateMissed';
  periods: { period: number; subject: string }[];
}

export interface CloseEntryDayPreview {
  date: string;
  cardAbsenceEnabled: boolean;
  beforeTrackingStart: boolean;
  trackingStart: string | null;
  markLateMissedLessons: boolean;
  absentStudents: PlannedAbsenceItem[];
  lateMissedStudents: PlannedAbsenceItem[];
  totalNewAbsenceRecords: number;
}

export async function previewCloseEntryDay(
  institutionId: string,
  date: string,
): Promise<CloseEntryDayPreview> {
  const institution = await getInstitution(institutionId);
  const cardAbsenceEnabled = isCardAbsenceEnabled(institution);
  const settings = getEntrySettings(institution);
  const trackingStart = institution.canteenTrackingStart ?? null;
  const beforeTrackingStart = Boolean(trackingStart && date < trackingStart);

  if (!cardAbsenceEnabled || beforeTrackingStart) {
    return {
      date,
      cardAbsenceEnabled,
      beforeTrackingStart,
      trackingStart,
      markLateMissedLessons: settings.markLateMissedLessons,
      absentStudents: [],
      lateMissedStudents: [],
      totalNewAbsenceRecords: 0,
    };
  }

  const [classes, students, slots, entries, existingAbsences] = await Promise.all([
    db.classes.where('institutionId').equals(institutionId).filter((c) => c.deletedAt === null).toArray(),
    db.students.where('institutionId').equals(institutionId).filter((s) => s.deletedAt === null).toArray(),
    db.timetableSlots.where('institutionId').equals(institutionId).filter((t) => t.deletedAt === null).toArray(),
    listGateEntriesForDate(institutionId, date),
    listStudentAbsencesForDate(institutionId, date),
  ]);

  const classById = new Map(classes.map((item) => [item.id, item.name]));
  const acceptedMap = acceptedEntryByStudent(entries, date);
  const existingKeySet = new Set(existingAbsences.map((item) => `${item.studentId}|${item.period}`));
  const day = weekdayOfDate(date);

  const absentStudents: PlannedAbsenceItem[] = [];
  const lateMissedStudents: PlannedAbsenceItem[] = [];
  let totalNewAbsenceRecords = 0;

  const enrolled = students
    .filter((student) => isEnrolledOn(student, date))
    .sort((a, b) => {
      const ca = classById.get(a.classId) ?? '';
      const cb = classById.get(b.classId) ?? '';
      return ca.localeCompare(cb, undefined, { numeric: true }) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });

  for (const student of enrolled) {
    const accepted = acceptedMap.get(student.id);
    const className = classById.get(student.classId) ?? '';
    const studentName = `${student.firstName} ${student.lastName}`.trim();

    if (!accepted) {
      const lessons = classLessonsForDay(slots, student.classId, day);
      const targetLessons = lessons.length > 0 ? lessons : [{ period: 1, subject: '—' }];
      const newPeriods = targetLessons
        .filter((lesson) => !existingKeySet.has(`${student.id}|${lesson.period}`))
        .map((lesson) => ({ period: lesson.period, subject: lesson.subject }));

      if (newPeriods.length > 0) {
        absentStudents.push({
          studentId: student.id,
          studentName,
          classId: student.classId,
          className,
          kind: 'notEntered',
          periods: newPeriods,
        });
        totalNewAbsenceRecords += newPeriods.length;
      }
    } else if (settings.markLateMissedLessons && accepted.late) {
      const missed = computeLateMissedPeriods(student.classId, date, accepted.time, slots).filter(
        (lesson) => !existingKeySet.has(`${student.id}|${lesson.period}`),
      );
      if (missed.length > 0) {
        lateMissedStudents.push({
          studentId: student.id,
          studentName,
          classId: student.classId,
          className,
          kind: 'lateMissed',
          periods: missed,
        });
        totalNewAbsenceRecords += missed.length;
      }
    }
  }

  return {
    date,
    cardAbsenceEnabled,
    beforeTrackingStart,
    trackingStart,
    markLateMissedLessons: settings.markLateMissedLessons,
    absentStudents,
    lateMissedStudents,
    totalNewAbsenceRecords,
  };
}

export async function closeEntryDay(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<{ closure: EntryDayClosure; createdAbsencesCount: number }> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const preview = await previewCloseEntryDay(institutionId, date);
  const now = new Date().toISOString();
  const createdIds: string[] = [];

  const toInsert: StudentAbsence[] = [];
  if (preview.cardAbsenceEnabled && !preview.beforeTrackingStart) {
    const allPlanned = [...preview.absentStudents, ...preview.lateMissedStudents];
    for (const item of allPlanned) {
      for (const periodInfo of item.periods) {
        const record: StudentAbsence = {
          ...newBaseFields(institutionId, actorId),
          classId: item.classId,
          studentId: item.studentId,
          date,
          period: periodInfo.period,
          subject: periodInfo.subject || '—',
          justified: false,
          status: 'absent',
          source: 'gate',
        };
        toInsert.push(record);
        createdIds.push(record.id);
      }
    }
  }

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    const existingClosure = await db.entryClosures.get(closureIdFor(institutionId, date));
    if (toInsert.length > 0) {
      await db.studentAbsences.bulkAdd(toInsert);
    }
    const prevIds = existingClosure?.createdAbsenceIds ?? [];
    const closure: EntryDayClosure = {
      id: closureIdFor(institutionId, date),
      institutionId,
      date,
      closed: true,
      closedAt: now,
      closedBy: actorId,
      createdAbsenceIds: [...prevIds, ...createdIds],
      autoAbsencesSyncedAt: existingClosure?.autoAbsencesSyncedAt ?? now,
      updatedAt: now,
    };
    await db.entryClosures.put(closure);
  });

  const savedClosure = (await db.entryClosures.get(closureIdFor(institutionId, date)))!;
  return { closure: savedClosure, createdAbsencesCount: createdIds.length };
}

export async function undoCloseEntryDay(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<number> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const id = closureIdFor(institutionId, date);
  const existing = await db.entryClosures.get(id);
  if (!existing) return 0;

  const now = new Date().toISOString();
  let removed = 0;

  await db.transaction('rw', [db.studentAbsences, db.entryClosures], async () => {
    const handledIds = new Set<string>();
    for (const absenceId of existing.createdAbsenceIds) {
      const record = await db.studentAbsences.get(absenceId);
      if (record && record.deletedAt === null) {
        await db.studentAbsences.put({
          ...record,
          deletedAt: now,
          ...touchFields(actorId),
        });
        handledIds.add(record.id);
        removed += 1;
      }
    }
    const remainingGateRecords = await db.studentAbsences
      .where('institutionId')
      .equals(institutionId)
      .filter((item) => item.deletedAt === null && item.date === date && item.source === 'gate' && !handledIds.has(item.id))
      .toArray();
    for (const record of remainingGateRecords) {
      await db.studentAbsences.put({
        ...record,
        deletedAt: now,
        ...touchFields(actorId),
      });
      removed += 1;
    }
    await db.entryClosures.put({
      ...existing,
      closed: false,
      closedAt: null,
      autoAbsencesSyncedAt: null,
      createdAbsenceIds: [],
      updatedAt: now,
    });
  });

  return removed;
}

export async function reopenEntryDay(
  institutionId: string,
  actorId: string,
  date: string,
): Promise<void> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const id = closureIdFor(institutionId, date);
  const existing = await db.entryClosures.get(id);
  if (!existing) return;

  await db.entryClosures.put({
    ...existing,
    closed: false,
    updatedAt: new Date().toISOString(),
  });
}

export async function importGateEntries(
  institutionId: string,
  actorId: string,
  incoming: GateEntry[],
): Promise<EntryMergePlan> {
  const access = await getModuleAccess(actorId, 'entry');
  if (!access.canEdit) throw new DomainError('errors.notAuthorized');

  const existing = await db.entries.where('institutionId').equals(institutionId).toArray();
  const plan = planEntryMerge(existing, incoming, institutionId);

  if (plan.toPut.length > 0) {
    await db.transaction('rw', db.entries, async () => {
      await db.entries.bulkPut(plan.toPut);
    });

    const institution = await getInstitution(institutionId);
    if (isCardAbsenceEnabled(institution)) {
      const acceptedByDate = new Map<string, GateEntry[]>();
      for (const entry of plan.toPut) {
        if (entry.deletedAt !== null || entry.result !== 'accepted' || !entry.studentId) continue;
        const list = acceptedByDate.get(entry.date) ?? [];
        list.push(entry);
        acceptedByDate.set(entry.date, list);
      }

      for (const [date, dateEntries] of acceptedByDate.entries()) {
        const closure = await db.entryClosures.get(closureIdFor(institutionId, date));
        if (!closure?.autoAbsencesSyncedAt) continue;
        for (const entry of dateEntries) {
          if (!entry.studentId) continue;
          const student = await db.students.get(entry.studentId);
          if (!student || student.deletedAt !== null) continue;
          await syncStudentGateAbsenceOnAcceptedScan(
            institutionId,
            actorId,
            student,
            date,
            entry.time,
            entry.late,
          );
        }
      }
    }
  }

  return plan;
}

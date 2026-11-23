import { DomainError } from '@/utils/errors';
import { classLessonsForDay, isIsoDate, weekdayOfDate } from '@/utils/absences';
import {
  computeNoticeSchedule,
  effectiveAbsenceEndForSync,
  enumerateSchoolDaysInRange,
} from '@/utils/continuousAbsences';
import { todayIso } from '@/utils/dates';
import { assertCanEditClassIn, canAccessClass, getModuleAccess } from './access';
import { db } from './database';
import { getInstitution } from './institutions';
import { newBaseFields, touchFields } from './records';
import type { ContinuousAbsence, Student, StudentAbsence, TimetableSlot } from './types';

export interface SaveContinuousAbsenceInput {
  id?: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  reason: string;
  justified?: boolean;
}

function desiredPeriodsForRecord(
  record: ContinuousAbsence,
  syncUpToDate: string,
  workingDays: number[],
  holidayDates: string[],
  classSlots: TimetableSlot[],
): Map<string, { date: string; period: number; subject: string }> {
  const desired = new Map<string, { date: string; period: number; subject: string }>();
  const syncEnd = effectiveAbsenceEndForSync(record, syncUpToDate);
  if (!syncEnd) return desired;

  const schoolDays = enumerateSchoolDaysInRange(record.startDate, syncEnd, workingDays, holidayDates);
  for (const day of schoolDays) {
    const lessons = classLessonsForDay(classSlots, record.classId, weekdayOfDate(day));
    const entries = lessons.length > 0 ? lessons : [{ period: 1, subject: '—' }];
    for (const lesson of entries) {
      desired.set(`${day}|${lesson.period}`, {
        date: day,
        period: lesson.period,
        subject: lesson.subject || '—',
      });
    }
  }
  return desired;
}

async function syncSingleContinuousAbsenceInTx(
  record: ContinuousAbsence,
  student: Student,
  actorId: string,
  today: string,
  syncUpToDate: string,
  workingDays: number[],
  holidayDates: string[],
  classSlots: TimetableSlot[],
  studentExistingAbsences: StudentAbsence[],
): Promise<ContinuousAbsence> {
  const schedule = computeNoticeSchedule(record.startDate);
  const shouldStrikeNow = record.endDate === null && today >= schedule.strikeDate;
  let updatedRecord = record;

  // Apply or revert automatic Day 33 strike-off on the student's leaveDate
  if (shouldStrikeNow) {
    if (record.struckAt !== schedule.strikeDate) {
      updatedRecord = { ...record, struckAt: schedule.strikeDate, ...touchFields(actorId) };
      await db.continuousAbsences.put(updatedRecord);
    }
    if (student.leaveDate === null || student.leaveDate === record.struckAt) {
      if (student.leaveDate !== schedule.strikeDate) {
        await db.students.put({ ...student, leaveDate: schedule.strikeDate, ...touchFields(actorId) });
      }
    }
  } else if (record.struckAt) {
    updatedRecord = { ...record, struckAt: null, ...touchFields(actorId) };
    await db.continuousAbsences.put(updatedRecord);
    if (student.leaveDate === record.struckAt) {
      await db.students.put({ ...student, leaveDate: null, ...touchFields(actorId) });
    }
  }

  const desired = desiredPeriodsForRecord(
    updatedRecord,
    syncUpToDate,
    workingDays,
    holidayDates,
    classSlots,
  );

  const now = new Date().toISOString();
  const occupiedKeys = new Set<string>();

  for (const existing of studentExistingAbsences) {
    if (existing.deletedAt !== null) continue;
    if (existing.status === 'late') continue;
    const key = `${existing.date}|${existing.period}`;

    if (existing.continuousAbsenceId === updatedRecord.id) {
      if (!desired.has(key)) {
        await db.studentAbsences.put({ ...existing, deletedAt: now, ...touchFields(actorId) });
      } else {
        occupiedKeys.add(key);
        if (existing.justified !== updatedRecord.justified) {
          await db.studentAbsences.put({
            ...existing,
            justified: updatedRecord.justified,
            ...touchFields(actorId),
          });
        }
      }
    } else {
      occupiedKeys.add(key);
    }
  }

  for (const [key, slot] of desired.entries()) {
    if (occupiedKeys.has(key)) continue;
    await db.studentAbsences.add({
      ...newBaseFields(updatedRecord.institutionId, actorId),
      classId: updatedRecord.classId,
      studentId: updatedRecord.studentId,
      date: slot.date,
      period: slot.period,
      subject: slot.subject,
      justified: updatedRecord.justified,
      source: 'continuous',
      continuousAbsenceId: updatedRecord.id,
    });
  }

  return updatedRecord;
}

export async function syncContinuousAbsencesUpTo(
  institutionId: string,
  actorId: string,
  targetDate: string = todayIso(),
): Promise<void> {
  if (!isIsoDate(targetDate)) return;
  const access = await getModuleAccess(actorId, 'attendance');
  if (!access.canEdit) return;

  const activeRecords = await db.continuousAbsences
    .where('institutionId')
    .equals(institutionId)
    .filter((item) => item.deletedAt === null && canAccessClass(access, item.classId))
    .toArray();

  if (activeRecords.length === 0) return;

  const institution = await getInstitution(institutionId);
  const holidayDates = institution.holidays.map((item) => item.date);
  const today = todayIso();

  await db.transaction(
    'rw',
    [db.continuousAbsences, db.studentAbsences, db.students, db.timetableSlots],
    async () => {
      const [allSlots, allAbsences] = await Promise.all([
        db.timetableSlots
          .where('institutionId')
          .equals(institutionId)
          .filter((slot) => slot.deletedAt === null)
          .toArray(),
        db.studentAbsences
          .where('institutionId')
          .equals(institutionId)
          .filter((item) => item.deletedAt === null)
          .toArray(),
      ]);

      const slotsByClass = new Map<string, TimetableSlot[]>();
      for (const slot of allSlots) {
        const list = slotsByClass.get(slot.classId);
        if (list) list.push(slot);
        else slotsByClass.set(slot.classId, [slot]);
      }

      const absencesByStudent = new Map<string, StudentAbsence[]>();
      for (const item of allAbsences) {
        const list = absencesByStudent.get(item.studentId);
        if (list) list.push(item);
        else absencesByStudent.set(item.studentId, [item]);
      }

      for (const record of activeRecords) {
        const student = await db.students.get(record.studentId);
        if (!student || student.deletedAt !== null) continue;
        const syncEndTarget =
          record.endDate !== null && record.endDate > targetDate ? record.endDate : targetDate;
        await syncSingleContinuousAbsenceInTx(
          record,
          student,
          actorId,
          today,
          syncEndTarget,
          institution.workingDays,
          holidayDates,
          slotsByClass.get(record.classId) ?? [],
          absencesByStudent.get(record.studentId) ?? [],
        );
      }
    },
  );
}

export async function saveContinuousAbsence(
  institutionId: string,
  actorId: string,
  input: SaveContinuousAbsenceInput,
): Promise<ContinuousAbsence> {
  if (!isIsoDate(input.startDate)) throw new DomainError('validation.invalidDate');
  if (input.endDate !== null) {
    if (!isIsoDate(input.endDate)) throw new DomainError('validation.invalidDate');
    if (input.endDate < input.startDate) {
      throw new DomainError('absences.continuous.errors.endBeforeStart');
    }
  }

  const student = await db.students.get(input.studentId);
  if (!student || student.deletedAt !== null || student.institutionId !== institutionId) {
    throw new DomainError('errors.notFound');
  }

  assertCanEditClassIn(await getModuleAccess(actorId, 'attendance'), student.classId);
  const institution = await getInstitution(institutionId);
  const holidayDates = institution.holidays.map((item) => item.date);
  const today = todayIso();
  const syncUpToDate =
    input.endDate !== null && input.endDate > today ? input.endDate : today;

  return db.transaction(
    'rw',
    [db.continuousAbsences, db.studentAbsences, db.students, db.timetableSlots],
    async () => {
      const existingForStudent = await db.continuousAbsences
        .where('studentId')
        .equals(student.id)
        .filter((item) => item.deletedAt === null)
        .toArray();

      let baseRecord: ContinuousAbsence;
      if (input.id) {
        const current = existingForStudent.find((item) => item.id === input.id);
        if (!current) throw new DomainError('errors.notFound');
        if (
          input.endDate === null &&
          existingForStudent.some((item) => item.id !== current.id && item.endDate === null)
        ) {
          throw new DomainError('absences.continuous.errors.alreadyOpen');
        }
        baseRecord = {
          ...current,
          classId: student.classId,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason.trim(),
          justified: input.justified ?? current.justified,
          ...touchFields(actorId),
        };
        await db.continuousAbsences.put(baseRecord);
      } else {
        if (input.endDate === null && existingForStudent.some((item) => item.endDate === null)) {
          throw new DomainError('absences.continuous.errors.alreadyOpen');
        }
        baseRecord = {
          ...newBaseFields(institutionId, actorId),
          studentId: student.id,
          classId: student.classId,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason.trim(),
          justified: input.justified ?? false,
          struckAt: null,
        };
        await db.continuousAbsences.add(baseRecord);
      }

      const [classSlots, studentAbsences] = await Promise.all([
        db.timetableSlots
          .where('classId')
          .equals(student.classId)
          .filter((slot) => slot.deletedAt === null)
          .toArray(),
        db.studentAbsences
          .where('institutionId')
          .equals(institutionId)
          .filter((item) => item.deletedAt === null && item.studentId === student.id)
          .toArray(),
      ]);

      return syncSingleContinuousAbsenceInTx(
        baseRecord,
        student,
        actorId,
        today,
        syncUpToDate,
        institution.workingDays,
        holidayDates,
        classSlots,
        studentAbsences,
      );
    },
  );
}

export async function deleteContinuousAbsence(
  continuousAbsenceId: string,
  actorId: string,
): Promise<void> {
  const record = await db.continuousAbsences.get(continuousAbsenceId);
  if (!record || record.deletedAt !== null) throw new DomainError('errors.notFound');
  assertCanEditClassIn(await getModuleAccess(actorId, 'attendance'), record.classId);

  const now = new Date().toISOString();
  await db.transaction(
    'rw',
    [db.continuousAbsences, db.studentAbsences, db.students],
    async () => {
      await db.continuousAbsences.put({ ...record, deletedAt: now, ...touchFields(actorId) });

      const generatedAbsences = await db.studentAbsences
        .where('institutionId')
        .equals(record.institutionId)
        .filter(
          (item) => item.deletedAt === null && item.continuousAbsenceId === record.id,
        )
        .toArray();

      for (const absence of generatedAbsences) {
        await db.studentAbsences.put({ ...absence, deletedAt: now, ...touchFields(actorId) });
      }

      if (record.struckAt) {
        const student = await db.students.get(record.studentId);
        if (student && student.deletedAt === null && student.leaveDate === record.struckAt) {
          await db.students.put({ ...student, leaveDate: null, ...touchFields(actorId) });
        }
      }
    },
  );
}

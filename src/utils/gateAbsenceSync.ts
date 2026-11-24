import type { GateEntry, SchoolClass, Student, StudentAbsence } from '@/db/types';
import { isEnrolledOn } from '@/utils/absenceReports';
import { classLessonsForDay, weekdayOfDate, type LessonSlot } from '@/utils/absences';
import {
  acceptedEntryByStudent,
  computeLateMissedPeriods,
  isPeriodInSession,
  resolveEntrySession,
} from '@/utils/entry';

export interface GateSyncAddition {
  studentId: string;
  classId: string;
  period: number;
  subject: string;
}

export interface GateEntryAbsenceSyncPlan {
  enrolledCount: number;
  enteredCount: number;
  notEnteredCount: number;
  lateCount: number;
  toAdd: GateSyncAddition[];
  toSoftDeleteIds: string[];
  absentStudentsAfterSync: number;
}

export function planGateEntryAbsenceSync(input: {
  date: string;
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>[];
  slots: LessonSlot[];
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'session' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[];
  existingAbsences: Pick<StudentAbsence, 'id' | 'studentId' | 'classId' | 'date' | 'period' | 'source' | 'status' | 'deletedAt'>[];
  markLateMissedLessons: boolean;
  eveningStartTime?: string;
}): GateEntryAbsenceSyncPlan {
  const acceptedMap = acceptedEntryByStudent(input.entries, input.date, undefined, input.eveningStartTime);
  const morningAcceptedMap = acceptedEntryByStudent(input.entries, input.date, 'morning', input.eveningStartTime);
  const eveningAcceptedMap = acceptedEntryByStudent(input.entries, input.date, 'evening', input.eveningStartTime);
  const hasEveningSessionActivity = input.entries.some(
    (entry) =>
      entry.deletedAt == null &&
      entry.date === input.date &&
      entry.result === 'accepted' &&
      resolveEntrySession(entry, input.eveningStartTime) === 'evening',
  );

  const enrolledStudents = input.students.filter(
    (student) => student.deletedAt == null && isEnrolledOn(student, input.date),
  );
  const day = weekdayOfDate(input.date);

  const lessonsByClass = new Map<string, { period: number; subject: string }[]>();
  const getLessons = (classId: string) => {
    let cached = lessonsByClass.get(classId);
    if (!cached) {
      cached = classLessonsForDay(input.slots, classId, day).map((lesson) => ({
        period: lesson.period,
        subject: lesson.subject || '—',
      }));
      lessonsByClass.set(classId, cached);
    }
    return cached;
  };

  const activeByStudent = new Map<
    string,
    Pick<StudentAbsence, 'id' | 'studentId' | 'classId' | 'date' | 'period' | 'source' | 'status' | 'deletedAt'>[]
  >();
  for (const record of input.existingAbsences) {
    if (record.deletedAt != null || record.date !== input.date || record.status === 'late') continue;
    const list = activeByStudent.get(record.studentId);
    if (list) list.push(record);
    else activeByStudent.set(record.studentId, [record]);
  }

  let enteredCount = 0;
  let lateCount = 0;
  const toAdd: GateSyncAddition[] = [];
  const toSoftDeleteIds: string[] = [];
  let absentStudentsAfterSync = 0;

  for (const student of enrolledStudents) {
    const accepted = acceptedMap.get(student.id);
    const lessons = getLessons(student.classId);

    let desiredPeriods: { period: number; subject: string }[] = [];
    if (hasEveningSessionActivity) {
      const morningEntry = morningAcceptedMap.get(student.id);
      const eveningEntry = eveningAcceptedMap.get(student.id);
      if (morningEntry || eveningEntry) {
        enteredCount += 1;
        if (morningEntry?.late || eveningEntry?.late) {
          lateCount += 1;
        }
      }
      const morningLessons = lessons.filter((lesson) =>
        isPeriodInSession(lesson.period, 'morning', input.eveningStartTime),
      );
      const eveningLessons = lessons.filter((lesson) =>
        isPeriodInSession(lesson.period, 'evening', input.eveningStartTime),
      );
      if (!morningEntry) {
        desiredPeriods.push(...morningLessons);
      } else if (input.markLateMissedLessons && morningEntry.late) {
        desiredPeriods.push(
          ...computeLateMissedPeriods(
            student.classId,
            input.date,
            morningEntry.time,
            input.slots,
            'morning',
            input.eveningStartTime,
          ).map((item) => ({ period: item.period, subject: item.subject || '—' })),
        );
      }
      if (!eveningEntry) {
        desiredPeriods.push(...eveningLessons);
      } else if (input.markLateMissedLessons && eveningEntry.late) {
        desiredPeriods.push(
          ...computeLateMissedPeriods(
            student.classId,
            input.date,
            eveningEntry.time,
            input.slots,
            'evening',
            input.eveningStartTime,
          ).map((item) => ({ period: item.period, subject: item.subject || '—' })),
        );
      }
    } else if (!accepted) {
      desiredPeriods = lessons;
    } else {
      enteredCount += 1;
      if (accepted.late) {
        lateCount += 1;
        if (input.markLateMissedLessons) {
          desiredPeriods = computeLateMissedPeriods(student.classId, input.date, accepted.time, input.slots).map(
            (item) => ({ period: item.period, subject: item.subject || '—' }),
          );
        }
      }
    }

    const desiredPeriodSet = new Set(desiredPeriods.map((item) => item.period));
    const studentAbsences = activeByStudent.get(student.id) ?? [];
    const remainingPeriods = new Set<number>();

    for (const record of studentAbsences) {
      if (record.source === 'gate' && !desiredPeriodSet.has(record.period)) {
        toSoftDeleteIds.push(record.id);
      } else {
        remainingPeriods.add(record.period);
      }
    }

    let addedForStudent = 0;
    for (const lesson of desiredPeriods) {
      if (remainingPeriods.has(lesson.period)) continue;
      remainingPeriods.add(lesson.period);
      toAdd.push({
        studentId: student.id,
        classId: student.classId,
        period: lesson.period,
        subject: lesson.subject || '—',
      });
      addedForStudent += 1;
    }

    if (remainingPeriods.size > 0 || addedForStudent > 0) {
      absentStudentsAfterSync += 1;
    }
  }

  const enrolledCount = enrolledStudents.length;
  const notEnteredCount = Math.max(0, enrolledCount - enteredCount);

  return {
    enrolledCount,
    enteredCount,
    notEnteredCount,
    lateCount,
    toAdd,
    toSoftDeleteIds,
    absentStudentsAfterSync,
  };
}

export interface ResettableStudentGroup {
  studentId: string;
  studentName: string;
  lastName: string;
  firstName: string;
  classId: string;
  className: string;
  records: {
    id: string;
    period: number;
    subject: string;
    source: 'manual' | 'gate';
    justified: boolean;
  }[];
  hasGate: boolean;
  hasManual: boolean;
}

export function groupResettableDayAbsences(input: {
  date: string;
  absences: Pick<StudentAbsence, 'id' | 'studentId' | 'classId' | 'date' | 'period' | 'subject' | 'source' | 'status' | 'justified' | 'deletedAt'>[];
  students: Pick<Student, 'id' | 'firstName' | 'lastName' | 'classId'>[];
  classes: Pick<SchoolClass, 'id' | 'name'>[];
}): {
  groups: ResettableStudentGroup[];
  totalResettableRecords: number;
  gateRecordsCount: number;
  manualRecordsCount: number;
  continuousRecordsCount: number;
} {
  const studentById = new Map(input.students.map((s) => [s.id, s]));
  const classById = new Map(input.classes.map((c) => [c.id, c.name]));

  const groupMap = new Map<string, ResettableStudentGroup>();
  let totalResettableRecords = 0;
  let gateRecordsCount = 0;
  let manualRecordsCount = 0;
  let continuousRecordsCount = 0;

  for (const record of input.absences) {
    if (record.deletedAt != null || record.date !== input.date || record.status === 'late') continue;
    if (record.source === 'continuous') {
      continuousRecordsCount += 1;
      continue;
    }

    const student = studentById.get(record.studentId);
    if (!student) continue;

    const normalizedSource: 'manual' | 'gate' = record.source === 'gate' ? 'gate' : 'manual';
    if (normalizedSource === 'gate') gateRecordsCount += 1;
    else manualRecordsCount += 1;
    totalResettableRecords += 1;

    let group = groupMap.get(student.id);
    if (!group) {
      group = {
        studentId: student.id,
        studentName: `${student.lastName} ${student.firstName}`.trim(),
        lastName: student.lastName,
        firstName: student.firstName,
        classId: student.classId,
        className: classById.get(student.classId) ?? '',
        records: [],
        hasGate: false,
        hasManual: false,
      };
      groupMap.set(student.id, group);
    }

    group.records.push({
      id: record.id,
      period: record.period,
      subject: record.subject,
      source: normalizedSource,
      justified: record.justified,
    });
    if (normalizedSource === 'gate') group.hasGate = true;
    else group.hasManual = true;
  }

  const groups = Array.from(groupMap.values())
    .map((group) => ({
      ...group,
      records: [...group.records].sort((a, b) => a.period - b.period),
    }))
    .sort(
      (a, b) =>
        (a.className ?? '').localeCompare(b.className ?? '', undefined, { numeric: true }) ||
        (a.lastName ?? '').localeCompare(b.lastName ?? '') ||
        (a.firstName ?? '').localeCompare(b.firstName ?? ''),
    );

  return {
    groups,
    totalResettableRecords,
    gateRecordsCount,
    manualRecordsCount,
    continuousRecordsCount,
  };
}

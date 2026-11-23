import type { BoardingStatus, SchoolClass, Student, StudentAbsence } from '@/db/types';
import { isEnrolledOn, isSchoolDay } from '@/utils/absenceReports';
import { shiftIsoDate } from '@/utils/dailyReportStats';
import { classLessonsForDay, weekdayOfDate, type ClassLesson, type LessonSlot, type StudentAbsenceTotals } from '@/utils/absences';

const MAX_STREAK_LOOKBACK_DAYS = 366;

export interface StudentDayAbsence {
  studentId: string;
  name: string;
  className: string;
  boarding: BoardingStatus;
  hours: number;
  wholeDay: boolean;
  absentUntilEndOfDay?: boolean;
  since: string;
  periods: number[];
}

export interface DailyAbsenceInput {
  date: string;
  students: Student[];
  classes: SchoolClass[];
  absences: StudentAbsence[];
  slots: LessonSlot[];
  workingDays: number[];
  holidayDates: string[];
}

export interface StudentDayAbsenceIndexEntry {
  periods: Set<number>;
  justifiedPeriods: Set<number>;
  hasGateAbsence: boolean;
  hasContinuousAbsence: boolean;
}

export interface StudentDayEvaluation {
  totals: StudentAbsenceTotals;
  periods: number[];
  wholeDay: boolean;
  absentLastPeriod: boolean;
  absentUntilEndOfDay: boolean;
}

export function indexActiveAbsencesForDate(
  absences: Pick<StudentAbsence, 'studentId' | 'date' | 'period' | 'justified' | 'status' | 'source' | 'deletedAt'>[],
  date: string,
): Map<string, StudentDayAbsenceIndexEntry> {
  const byStudent = new Map<string, StudentDayAbsenceIndexEntry>();
  for (const record of absences) {
    if (record.date !== date) continue;
    if (record.deletedAt !== null && record.deletedAt !== undefined) continue;
    if (record.status === 'late') continue;
    const period = Number(record.period);
    if (!Number.isFinite(period)) continue;

    let entry = byStudent.get(record.studentId);
    if (!entry) {
      entry = {
        periods: new Set<number>(),
        justifiedPeriods: new Set<number>(),
        hasGateAbsence: false,
        hasContinuousAbsence: false,
      };
      byStudent.set(record.studentId, entry);
    }
    entry.periods.add(period);
    if (record.justified) entry.justifiedPeriods.add(period);
    if (record.source === 'gate') entry.hasGateAbsence = true;
    if (record.source === 'continuous') entry.hasContinuousAbsence = true;
  }
  return byStudent;
}

export function evaluateStudentDayAbsence(
  entry: StudentDayAbsenceIndexEntry | undefined,
  lessons: readonly ClassLesson[],
): StudentDayEvaluation | null {
  if (!entry || entry.periods.size === 0) return null;

  const periods = [...entry.periods].sort((a, b) => a - b);
  const justifiedHours = [...entry.periods].filter((period) => entry.justifiedPeriods.has(period)).length;
  const hours = periods.length;
  const totals: StudentAbsenceTotals = {
    hours,
    justifiedHours,
    unjustifiedHours: hours - justifiedHours,
  };

  if (lessons.length > 0) {
    const wholeDay = lessons.every((lesson) => entry.periods.has(lesson.period));
    const lastPeriod = lessons[lessons.length - 1].period;
    const absentLastPeriod = entry.periods.has(lastPeriod);
    return {
      totals,
      periods,
      wholeDay,
      absentLastPeriod,
      absentUntilEndOfDay: wholeDay || absentLastPeriod,
    };
  }

  // Fallback when a class has no timetable entered for the weekday, yet Gate Entry or Continuous Absence recorded a full-day absence
  const wholeDay = entry.hasGateAbsence || entry.hasContinuousAbsence;
  return {
    totals,
    periods,
    wholeDay,
    absentLastPeriod: false,
    absentUntilEndOfDay: wholeDay,
  };
}

export function studentDayAbsences(input: DailyAbsenceInput): StudentDayAbsence[] {
  const classById = new Map(input.classes.map((item) => [item.id, item]));
  const holidays = new Set(input.holidayDates);
  const indexCache = new Map<string, Map<string, StudentDayAbsenceIndexEntry>>();
  const lessonsCache = new Map<string, ClassLesson[]>();

  const indexOn = (day: string) => {
    let index = indexCache.get(day);
    if (!index) {
      index = indexActiveAbsencesForDate(input.absences, day);
      indexCache.set(day, index);
    }
    return index;
  };

  const lessonsForClassWeekday = (classId: string, weekday: number) => {
    const key = `${classId}|${weekday}`;
    let lessons = lessonsCache.get(key);
    if (!lessons) {
      lessons = classLessonsForDay(input.slots, classId, weekday);
      lessonsCache.set(key, lessons);
    }
    return lessons;
  };

  const evaluateOn = (student: Student, day: string) =>
    evaluateStudentDayAbsence(
      indexOn(day).get(student.id),
      lessonsForClassWeekday(student.classId, weekdayOfDate(day)),
    );

  const streakStartFor = (student: Student, date: string, wholeDayToday: boolean): string => {
    if (!wholeDayToday) return date;
    let start = date;
    let cursor = shiftIsoDate(date, -1);
    for (let step = 0; step < MAX_STREAK_LOOKBACK_DAYS; step += 1) {
      if (isSchoolDay(cursor, input.workingDays, holidays)) {
        const evalCursor = evaluateOn(student, cursor);
        if (evalCursor?.wholeDay) {
          start = cursor;
        } else if (evalCursor?.absentLastPeriod) {
          start = cursor;
          break;
        } else {
          break;
        }
      }
      cursor = shiftIsoDate(cursor, -1);
    }
    return start;
  };

  const result: StudentDayAbsence[] = [];
  for (const student of input.students) {
    if (student.deletedAt !== null && student.deletedAt !== undefined) continue;
    if (!isEnrolledOn(student, input.date)) continue;
    const evaluation = evaluateOn(student, input.date);
    if (!evaluation) continue;
    result.push({
      studentId: student.id,
      name: `${student.firstName} ${student.lastName}`,
      className: classById.get(student.classId)?.name ?? '',
      boarding: student.boardingStatus,
      hours: evaluation.totals.hours,
      wholeDay: evaluation.wholeDay,
      absentUntilEndOfDay: evaluation.absentUntilEndOfDay,
      since: evaluation.absentUntilEndOfDay ? streakStartFor(student, input.date, evaluation.wholeDay) : input.date,
      periods: evaluation.periods,
    });
  }
  return result.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

export function formatPeriods(periods: number[]): string {
  return periods.join(', ');
}

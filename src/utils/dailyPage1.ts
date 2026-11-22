import type { BoardingStatus, SchoolClass, Student, StudentAbsence } from '@/db/types';
import { isAbsentAllDay, isEnrolledOn, isSchoolDay } from '@/utils/absenceReports';
import { shiftIsoDate } from '@/utils/dailyReportStats';
import { classLessonsForDay, summarizeStudentAbsences, weekdayOfDate, type LessonSlot, type StudentAbsenceTotals } from '@/utils/absences';

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

export function studentDayAbsences(input: DailyAbsenceInput): StudentDayAbsence[] {
  const classById = new Map(input.classes.map((item) => [item.id, item]));
  const holidays = new Set(input.holidayDates);
  const totalsCache = new Map<string, Map<string, StudentAbsenceTotals>>();
  const periodsCache = new Map<string, Map<string, Set<number>>>();

  const totalsOn = (day: string) => {
    let totals = totalsCache.get(day);
    if (!totals) {
      totals = summarizeStudentAbsences(input.absences, day);
      totalsCache.set(day, totals);
    }
    return totals;
  };

  const periodsOn = (day: string) => {
    let byStudent = periodsCache.get(day);
    if (!byStudent) {
      byStudent = new Map<string, Set<number>>();
      for (const record of input.absences) {
        if (record.date !== day) continue;
        let set = byStudent.get(record.studentId);
        if (!set) {
          set = new Set<number>();
          byStudent.set(record.studentId, set);
        }
        set.add(record.period);
      }
      periodsCache.set(day, byStudent);
    }
    return byStudent;
  };

  const classDayInfo = (classId: string, day: string) => {
    const lessons = classLessonsForDay(input.slots, classId, weekdayOfDate(day));
    return {
      count: lessons.length,
      lastPeriod: lessons.length > 0 ? lessons[lessons.length - 1].period : null,
    };
  };

  const wholeDayOn = (student: Student, day: string) =>
    isAbsentAllDay(totalsOn(day).get(student.id), classDayInfo(student.classId, day).count);

  const absentLastPeriodOn = (student: Student, day: string) => {
    const { lastPeriod } = classDayInfo(student.classId, day);
    if (lastPeriod === null) return false;
    return periodsOn(day).get(student.id)?.has(lastPeriod) === true;
  };

  const streakStartFor = (student: Student, date: string, wholeDayToday: boolean): string => {
    if (!wholeDayToday) return date;
    let start = date;
    let cursor = shiftIsoDate(date, -1);
    for (let step = 0; step < MAX_STREAK_LOOKBACK_DAYS; step += 1) {
      if (isSchoolDay(cursor, input.workingDays, holidays)) {
        if (wholeDayOn(student, cursor)) {
          start = cursor;
        } else if (absentLastPeriodOn(student, cursor)) {
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
    if (!isEnrolledOn(student, input.date)) continue;
    const totals = totalsOn(input.date).get(student.id);
    if (!totals || totals.hours === 0) continue;
    const wholeDay = wholeDayOn(student, input.date);
    const absentUntilEndOfDay = wholeDay || absentLastPeriodOn(student, input.date);
    const periods = [...(periodsOn(input.date).get(student.id) ?? [])].sort((a, b) => a - b);
    result.push({
      studentId: student.id,
      name: `${student.firstName} ${student.lastName}`,
      className: classById.get(student.classId)?.name ?? '',
      boarding: student.boardingStatus,
      hours: totals.hours,
      wholeDay,
      absentUntilEndOfDay,
      since: absentUntilEndOfDay ? streakStartFor(student, input.date, wholeDay) : input.date,
      periods,
    });
  }
  return result.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

export function formatPeriods(periods: number[]): string {
  return periods.join(', ');
}

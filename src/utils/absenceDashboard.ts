import type { SchoolClass, Student, StudentAbsence } from '@/db/types';
import { classLessonsForDay, weekdayOfDate, type LessonSlot } from '@/utils/absences';
import { isEnrolledOn, isSchoolDay, schoolDaysInMonth } from '@/utils/absenceReports';
import { classLevelOf } from '@/utils/classLevel';

export interface WeeklyAbsencePoint {
  key: string;
  startDate: string;
  endDate: string;
  schoolDays: number;
  requiredHours: number;
  absentHours: number;
  justifiedHours: number;
  unjustifiedHours: number;
  rate: number | null;
  justifiedRate: number | null;
  unjustifiedRate: number | null;
  isCurrent: boolean;
}

export interface MonthlyAbsencePoint {
  month: string;
  schoolDays: number;
  requiredHours: number;
  absentHours: number;
  justifiedHours: number;
  unjustifiedHours: number;
  rate: number | null;
  justifiedRate: number | null;
  unjustifiedRate: number | null;
  isCurrent: boolean;
}

export interface ClassAbsencePoint {
  classId: string;
  className: string;
  level: number | null;
  studentCount: number;
  requiredHours: number;
  absentHours: number;
  justifiedHours: number;
  unjustifiedHours: number;
  rate: number | null;
}

export interface AbsenceDashboardInput {
  classes: Pick<SchoolClass, 'id' | 'name' | 'level'>[];
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate'>[];
  slots: LessonSlot[];
  studentAbsences: Pick<StudentAbsence, 'classId' | 'date' | 'justified'>[];
  workingDays: number[];
  holidayDates: string[];
  referenceDate: string;
  weeksCount?: number;
  monthsCount?: number;
  levelFilter?: 'all' | 1 | 2 | 3 | 4;
  classId?: 'all' | string;
}

export interface AbsenceDashboardSummary {
  weekly: WeeklyAbsencePoint[];
  monthly: MonthlyAbsencePoint[];
  byClass: ClassAbsencePoint[];
  currentWeek: WeeklyAbsencePoint | null;
  previousWeek: WeeklyAbsencePoint | null;
  weekDelta: number | null;
  currentMonth: MonthlyAbsencePoint | null;
  previousMonth: MonthlyAbsencePoint | null;
  monthDelta: number | null;
  weeklyAverageRate: number | null;
  monthlyAverageRate: number | null;
  totalAbsentHours: number;
  totalJustifiedHours: number;
  totalUnjustifiedHours: number;
  totalRequiredHours: number;
  unjustifiedShare: number | null;
  hasTimetable: boolean;
  hasAnyAbsences: boolean;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function rateOf(hours: number, requiredHours: number): number | null {
  return requiredHours > 0 ? roundTwo((hours * 100) / requiredHours) : null;
}

export function addUtcDays(isoDate: string, offsetDays: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftYearMonth(month: string, offsetMonths: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + offsetMonths, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function determineWeekStartDay(workingDays: number[]): number {
  if (workingDays.includes(0)) return 0;
  if (workingDays.length === 0) return 0;
  return Math.min(...workingDays);
}

export function weekStartForDate(isoDate: string, weekStartDay: number): string {
  const weekday = weekdayOfDate(isoDate);
  const diff = (weekday - weekStartDay + 7) % 7;
  return addUtcDays(isoDate, -diff);
}

interface DayAbsenceBucket {
  absent: number;
  justified: number;
  unjustified: number;
}

function buildAbsenceIndex(
  absences: Pick<StudentAbsence, 'classId' | 'date' | 'justified'>[],
  allowedClassIds: ReadonlySet<string>,
): {
  byDate: Map<string, DayAbsenceBucket>;
  byClassAndDate: Map<string, Map<string, DayAbsenceBucket>>;
} {
  const byDate = new Map<string, DayAbsenceBucket>();
  const byClassAndDate = new Map<string, Map<string, DayAbsenceBucket>>();

  for (const record of absences) {
    if (!allowedClassIds.has(record.classId)) continue;

    let dayBucket = byDate.get(record.date);
    if (!dayBucket) {
      dayBucket = { absent: 0, justified: 0, unjustified: 0 };
      byDate.set(record.date, dayBucket);
    }
    dayBucket.absent += 1;
    if (record.justified) dayBucket.justified += 1;
    else dayBucket.unjustified += 1;

    let classMap = byClassAndDate.get(record.classId);
    if (!classMap) {
      classMap = new Map<string, DayAbsenceBucket>();
      byClassAndDate.set(record.classId, classMap);
    }
    let classDayBucket = classMap.get(record.date);
    if (!classDayBucket) {
      classDayBucket = { absent: 0, justified: 0, unjustified: 0 };
      classMap.set(record.date, classDayBucket);
    }
    classDayBucket.absent += 1;
    if (record.justified) classDayBucket.justified += 1;
    else classDayBucket.unjustified += 1;
  }

  return { byDate, byClassAndDate };
}

function buildLessonsCountByClassWeekday(
  slots: LessonSlot[],
  classIds: string[],
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const classId of classIds) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let day = 0; day < 7; day += 1) {
      counts[day] = classLessonsForDay(slots, classId, day).length;
    }
    map.set(classId, counts);
  }
  return map;
}

function computeRequiredHoursForClassDay(
  students: Pick<Student, 'joinDate' | 'leaveDate'>[],
  lessonsOnWeekday: number,
  date: string,
): number {
  if (lessonsOnWeekday === 0 || students.length === 0) return 0;
  let enrolled = 0;
  for (const student of students) {
    if (isEnrolledOn(student, date)) enrolled += 1;
  }
  return enrolled * lessonsOnWeekday;
}

export function buildAbsenceDashboard(input: AbsenceDashboardInput): AbsenceDashboardSummary {
  const weeksCount = Math.max(1, input.weeksCount ?? 8);
  const monthsCount = Math.max(1, input.monthsCount ?? 6);
  const levelFilter = input.levelFilter ?? 'all';
  const classFilter = input.classId ?? 'all';
  const holidaySet = new Set(input.holidayDates);
  const referenceDate = input.referenceDate;
  const currentMonthKey = referenceDate.slice(0, 7);

  const filteredClasses = input.classes.filter((schoolClass) => {
    if (classFilter !== 'all' && schoolClass.id !== classFilter) return false;
    if (levelFilter !== 'all' && classLevelOf(schoolClass) !== levelFilter) return false;
    return true;
  });

  const filteredClassIds = filteredClasses.map((c) => c.id);
  const filteredClassIdSet = new Set(filteredClassIds);

  const studentsByClass = new Map<string, Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate'>[]>();
  for (const classId of filteredClassIds) {
    studentsByClass.set(classId, []);
  }
  for (const student of input.students) {
    const list = studentsByClass.get(student.classId);
    if (list) list.push(student);
  }

  const lessonsByClassWeekday = buildLessonsCountByClassWeekday(input.slots, filteredClassIds);
  const { byDate, byClassAndDate } = buildAbsenceIndex(input.studentAbsences, filteredClassIdSet);

  let hasTimetable = false;
  for (const counts of lessonsByClassWeekday.values()) {
    if (counts.some((count) => count > 0)) {
      hasTimetable = true;
      break;
    }
  }

  const requiredHoursForDate = (date: string): number => {
    const weekday = weekdayOfDate(date);
    let total = 0;
    for (const classId of filteredClassIds) {
      const lessons = lessonsByClassWeekday.get(classId)?.[weekday] ?? 0;
      if (lessons === 0) continue;
      const classStudents = studentsByClass.get(classId) ?? [];
      total += computeRequiredHoursForClassDay(classStudents, lessons, date);
    }
    return total;
  };

  // 1. Weekly series (last `weeksCount` weeks ending on the week containing `referenceDate`)
  const weekStartDay = determineWeekStartDay(input.workingDays);
  const currentWeekStart = weekStartForDate(referenceDate, weekStartDay);
  const weekly: WeeklyAbsencePoint[] = [];

  for (let i = weeksCount - 1; i >= 0; i -= 1) {
    const startDate = addUtcDays(currentWeekStart, -i * 7);
    const endDate = addUtcDays(startDate, 6);
    const isCurrent = i === 0;
    const effectiveEnd = isCurrent ? referenceDate : endDate;

    const schoolDays: string[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const d = addUtcDays(startDate, offset);
      if (d > effectiveEnd) break;
      if (isSchoolDay(d, input.workingDays, holidaySet)) {
        schoolDays.push(d);
      }
    }

    let requiredHours = 0;
    let absentHours = 0;
    let justifiedHours = 0;
    let unjustifiedHours = 0;

    for (const date of schoolDays) {
      requiredHours += requiredHoursForDate(date);
      const bucket = byDate.get(date);
      if (bucket) {
        absentHours += bucket.absent;
        justifiedHours += bucket.justified;
        unjustifiedHours += bucket.unjustified;
      }
    }

    weekly.push({
      key: startDate,
      startDate,
      endDate,
      schoolDays: schoolDays.length,
      requiredHours,
      absentHours,
      justifiedHours,
      unjustifiedHours,
      rate: rateOf(absentHours, requiredHours),
      justifiedRate: rateOf(justifiedHours, requiredHours),
      unjustifiedRate: rateOf(unjustifiedHours, requiredHours),
      isCurrent,
    });
  }

  // 2. Monthly series (last `monthsCount` months ending on `currentMonthKey`)
  const monthly: MonthlyAbsencePoint[] = [];
  const allMonthSchoolDays: string[] = [];

  for (let i = monthsCount - 1; i >= 0; i -= 1) {
    const month = shiftYearMonth(currentMonthKey, -i);
    const isCurrent = i === 0;
    const rawDays = schoolDaysInMonth(month, input.workingDays, holidaySet);
    const schoolDays = isCurrent ? rawDays.filter((d) => d <= referenceDate) : rawDays;

    for (const d of schoolDays) allMonthSchoolDays.push(d);

    let requiredHours = 0;
    let absentHours = 0;
    let justifiedHours = 0;
    let unjustifiedHours = 0;

    for (const date of schoolDays) {
      requiredHours += requiredHoursForDate(date);
      const bucket = byDate.get(date);
      if (bucket) {
        absentHours += bucket.absent;
        justifiedHours += bucket.justified;
        unjustifiedHours += bucket.unjustified;
      }
    }

    monthly.push({
      month,
      schoolDays: schoolDays.length,
      requiredHours,
      absentHours,
      justifiedHours,
      unjustifiedHours,
      rate: rateOf(absentHours, requiredHours),
      justifiedRate: rateOf(justifiedHours, requiredHours),
      unjustifiedRate: rateOf(unjustifiedHours, requiredHours),
      isCurrent,
    });
  }

  // 3. Class comparison over the selected monthly window
  const byClass: ClassAbsencePoint[] = filteredClasses
    .map((schoolClass) => {
      const classStudents = studentsByClass.get(schoolClass.id) ?? [];
      const weekdayLessons = lessonsByClassWeekday.get(schoolClass.id) ?? [0, 0, 0, 0, 0, 0, 0];
      const classAbsencesByDate = byClassAndDate.get(schoolClass.id);

      let requiredHours = 0;
      let absentHours = 0;
      let justifiedHours = 0;
      let unjustifiedHours = 0;

      for (const date of allMonthSchoolDays) {
        const lessons = weekdayLessons[weekdayOfDate(date)] ?? 0;
        requiredHours += computeRequiredHoursForClassDay(classStudents, lessons, date);
        const bucket = classAbsencesByDate?.get(date);
        if (bucket) {
          absentHours += bucket.absent;
          justifiedHours += bucket.justified;
          unjustifiedHours += bucket.unjustified;
        }
      }

      const activeStudentCount = classStudents.filter((s) => isEnrolledOn(s, referenceDate)).length;

      return {
        classId: schoolClass.id,
        className: schoolClass.name,
        level: classLevelOf(schoolClass),
        studentCount: activeStudentCount,
        requiredHours,
        absentHours,
        justifiedHours,
        unjustifiedHours,
        rate: rateOf(absentHours, requiredHours),
      };
    })
    .sort((a, b) => {
      const rateDiff = (b.rate ?? -1) - (a.rate ?? -1);
      if (rateDiff !== 0) return rateDiff;
      return b.absentHours - a.absentHours || a.className.localeCompare(b.className, undefined, { numeric: true });
    });

  // 4. Summary KPIs
  const currentWeek = weekly[weekly.length - 1] ?? null;
  const previousWeek = weekly.length >= 2 ? weekly[weekly.length - 2] : null;
  const weekDelta =
    currentWeek?.rate !== null && currentWeek?.rate !== undefined && previousWeek?.rate !== null && previousWeek?.rate !== undefined
      ? roundTwo(currentWeek.rate - previousWeek.rate)
      : null;

  const currentMonth = monthly[monthly.length - 1] ?? null;
  const previousMonth = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const monthDelta =
    currentMonth?.rate !== null && currentMonth?.rate !== undefined && previousMonth?.rate !== null && previousMonth?.rate !== undefined
      ? roundTwo(currentMonth.rate - previousMonth.rate)
      : null;

  const weeklyRequiredSum = weekly.reduce((acc, item) => acc + item.requiredHours, 0);
  const weeklyAbsentSum = weekly.reduce((acc, item) => acc + item.absentHours, 0);
  const weeklyAverageRate = rateOf(weeklyAbsentSum, weeklyRequiredSum);

  const totalRequiredHours = monthly.reduce((acc, item) => acc + item.requiredHours, 0);
  const totalAbsentHours = monthly.reduce((acc, item) => acc + item.absentHours, 0);
  const totalJustifiedHours = monthly.reduce((acc, item) => acc + item.justifiedHours, 0);
  const totalUnjustifiedHours = monthly.reduce((acc, item) => acc + item.unjustifiedHours, 0);
  const monthlyAverageRate = rateOf(totalAbsentHours, totalRequiredHours);
  const unjustifiedShare = totalAbsentHours > 0 ? roundTwo((totalUnjustifiedHours * 100) / totalAbsentHours) : null;

  const hasAnyAbsences =
    monthly.some((m) => m.absentHours > 0) || weekly.some((w) => w.absentHours > 0);

  return {
    weekly,
    monthly,
    byClass,
    currentWeek,
    previousWeek,
    weekDelta,
    currentMonth,
    previousMonth,
    monthDelta,
    weeklyAverageRate,
    monthlyAverageRate,
    totalAbsentHours,
    totalJustifiedHours,
    totalUnjustifiedHours,
    totalRequiredHours,
    unjustifiedShare,
    hasTimetable,
    hasAnyAbsences,
  };
}

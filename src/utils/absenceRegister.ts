import type { SchoolClass, Student, StudentAbsence } from '@/db/types';
import { isSchoolDay, schoolDaysInMonth } from '@/utils/absenceReports';
import { weekdayOfDate } from '@/utils/absences';
import { DEFAULT_ENTRY_SETTINGS, isPeriodInSession } from '@/utils/entry';

export interface RegisterDayInfo {
  day: number;
  date: string;
  weekday: number;
  isWorkingDay: boolean;
  isHoliday: boolean;
  isSchoolDay: boolean;
}

export interface RegisterDayCell {
  day: number;
  date: string;
  morningHours: number;
  eveningHours: number;
  morningJustified: number;
  eveningJustified: number;
  morningPeriods: number[];
  eveningPeriods: number[];
  records: StudentAbsence[];
}

export interface RegisterStudentRow {
  index: number;
  student: Student;
  fullName: string;
  hasLeft: boolean;
  days: RegisterDayCell[];
  morningTotal: number;
  eveningTotal: number;
  totalHours: number;
  justifiedHours: number;
  unjustifiedHours: number;
}

export interface RegisterDailyTotal {
  day: number;
  date: string;
  morningHours: number;
  eveningHours: number;
}

export interface ClassAbsenceRegister {
  classId: string;
  className: string;
  month: string;
  days: RegisterDayInfo[];
  schoolDayCount: number;
  rows: RegisterStudentRow[];
  dailyTotals: RegisterDailyTotal[];
  totals: {
    studentCount: number;
    absentStudentCount: number;
    morningHours: number;
    eveningHours: number;
    totalHours: number;
    justifiedHours: number;
    unjustifiedHours: number;
  };
}

export interface BuildClassAbsenceRegisterInput {
  schoolClass: SchoolClass;
  students: Student[];
  studentAbsences: StudentAbsence[];
  month: string;
  workingDays: number[];
  holidayDates: Iterable<string>;
  eveningStartTime?: string;
  lang?: string;
}

export function daysInMonthCount(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return 0;
  }
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function normalizeDateIso(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(trimmed);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

export function isStudentInClassForMonth(
  student: Pick<Student, 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>,
  classId: string,
  _month: string,
  dayCount: number,
): boolean {
  if (student.deletedAt != null) return false;
  if (student.classId !== classId) return false;
  if (dayCount <= 0) return false;
  return true;
}

export function formatMonthTitle(month: string, lang: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return month;
  const locale = lang.startsWith('ar') ? 'ar-DZ' : 'en-US';
  try {
    const label = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
    return `${label} (${month})`;
  } catch {
    return month;
  }
}

export function buildClassAbsenceRegister({
  schoolClass,
  students,
  studentAbsences,
  month,
  workingDays,
  holidayDates,
  eveningStartTime = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
  lang = 'ar',
}: BuildClassAbsenceRegisterInput): ClassAbsenceRegister {
  const dayCount = daysInMonthCount(month);
  const holidaySet = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const locale = lang.startsWith('ar') ? 'ar' : 'en';

  const days: RegisterDayInfo[] = Array.from({ length: dayCount }, (_, idx) => {
    const day = idx + 1;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const weekday = weekdayOfDate(date);
    const isWorkingDay = workingDays.includes(weekday);
    const isHoliday = holidaySet.has(date);
    return {
      day,
      date,
      weekday,
      isWorkingDay,
      isHoliday,
      isSchoolDay: isSchoolDay(date, workingDays, holidaySet),
    };
  });

  const schoolDayCount = schoolDaysInMonth(month, workingDays, holidaySet).length;

  const classStudents = students
    .filter((student) => isStudentInClassForMonth(student, schoolClass.id, month, dayCount))
    .sort((a, b) => {
      const lastA = (a.lastName ?? '').trim();
      const lastB = (b.lastName ?? '').trim();
      const byLast = lastA.localeCompare(lastB, locale, { sensitivity: 'base' });
      if (byLast !== 0) return byLast;
      const firstA = (a.firstName ?? '').trim();
      const firstB = (b.firstName ?? '').trim();
      return firstA.localeCompare(firstB, locale, { sensitivity: 'base' });
    });

  const classStudentIds = new Set(classStudents.map((student) => student.id));
  const monthPrefix = `${month}-`;

  // Index and deduplicate absences per (studentId, date, period)
  const recordsByStudentDay = new Map<string, Map<number, StudentAbsence>>();
  for (const record of studentAbsences) {
    if (record.deletedAt !== null && record.deletedAt !== undefined) continue;
    if (record.status === 'late') continue;
    if (!record.date.startsWith(monthPrefix)) continue;
    if (!classStudentIds.has(record.studentId)) continue;
    const period = Number(record.period);
    if (!Number.isFinite(period)) continue;

    const key = `${record.studentId}|${record.date}`;
    let byPeriod = recordsByStudentDay.get(key);
    if (!byPeriod) {
      byPeriod = new Map<number, StudentAbsence>();
      recordsByStudentDay.set(key, byPeriod);
    }
    const existing = byPeriod.get(period);
    if (!existing || record.updatedAt > existing.updatedAt) {
      byPeriod.set(period, record);
    }
  }

  const dailyTotals: RegisterDailyTotal[] = days.map((info) => ({
    day: info.day,
    date: info.date,
    morningHours: 0,
    eveningHours: 0,
  }));

  let totalMorningHours = 0;
  let totalEveningHours = 0;
  let totalJustifiedHours = 0;
  let totalUnjustifiedHours = 0;
  let absentStudentCount = 0;

  const monthEnd = `${month}-${String(dayCount).padStart(2, '0')}`;

  const rows: RegisterStudentRow[] = classStudents.map((student, idx) => {
    let morningTotal = 0;
    let eveningTotal = 0;
    let justifiedHours = 0;
    let unjustifiedHours = 0;

    const studentDays: RegisterDayCell[] = days.map((dayInfo, dayIdx) => {
      const byPeriod = recordsByStudentDay.get(`${student.id}|${dayInfo.date}`);
      const sortedRecords = byPeriod
        ? [...byPeriod.values()].sort((a, b) => Number(a.period) - Number(b.period))
        : [];

      const morningPeriods: number[] = [];
      const eveningPeriods: number[] = [];
      let morningJustified = 0;
      let eveningJustified = 0;

      for (const record of sortedRecords) {
        const period = Number(record.period);
        const isEvening = isPeriodInSession(period, 'evening', eveningStartTime);
        if (isEvening) {
          eveningPeriods.push(period);
          if (record.justified) eveningJustified += 1;
        } else {
          morningPeriods.push(period);
          if (record.justified) morningJustified += 1;
        }
        if (record.justified) justifiedHours += 1;
        else unjustifiedHours += 1;
      }

      const morningHours = morningPeriods.length;
      const eveningHours = eveningPeriods.length;

      morningTotal += morningHours;
      eveningTotal += eveningHours;
      dailyTotals[dayIdx].morningHours += morningHours;
      dailyTotals[dayIdx].eveningHours += eveningHours;

      return {
        day: dayInfo.day,
        date: dayInfo.date,
        morningHours,
        eveningHours,
        morningJustified,
        eveningJustified,
        morningPeriods,
        eveningPeriods,
        records: sortedRecords,
      };
    });

    const totalHours = morningTotal + eveningTotal;
    if (totalHours > 0) absentStudentCount += 1;
    totalMorningHours += morningTotal;
    totalEveningHours += eveningTotal;
    totalJustifiedHours += justifiedHours;
    totalUnjustifiedHours += unjustifiedHours;

    const leaveDate = normalizeDateIso(student.leaveDate);
    const fullName = `${student.lastName ?? ''} ${student.firstName ?? ''}`.trim();

    return {
      index: idx + 1,
      student,
      fullName,
      hasLeft: leaveDate !== null && leaveDate <= monthEnd,
      days: studentDays,
      morningTotal,
      eveningTotal,
      totalHours,
      justifiedHours,
      unjustifiedHours,
    };
  });

  return {
    classId: schoolClass.id,
    className: schoolClass.name,
    month,
    days,
    schoolDayCount,
    rows,
    dailyTotals,
    totals: {
      studentCount: rows.length,
      absentStudentCount,
      morningHours: totalMorningHours,
      eveningHours: totalEveningHours,
      totalHours: totalMorningHours + totalEveningHours,
      justifiedHours: totalJustifiedHours,
      unjustifiedHours: totalUnjustifiedHours,
    },
  };
}

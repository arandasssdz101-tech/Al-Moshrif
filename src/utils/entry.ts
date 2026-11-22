import type {
  CanteenMatchField,
  EntryResult,
  GateEntry,
  Institution,
  SchoolClass,
  Student,
} from '@/db/types';
import { isEnrolledOn, isSchoolDay } from '@/utils/absenceReports';
import { classLessonsForDay, weekdayOfDate, type LessonSlot } from '@/utils/absences';
import { PERIODS } from '@/utils/schedule';
import { matchStudentFromScan, normalizeScannedCode } from '@/utils/studentQr';

export interface EntrySettings {
  startTime: string;
  lateAfterMinutes: number;
  useFirstTimetableLesson: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  cooldownSeconds: number;
  markLateMissedLessons: boolean;
}

export const DEFAULT_ENTRY_SETTINGS: EntrySettings = {
  startTime: '08:00',
  lateAfterMinutes: 10,
  useFirstTimetableLesson: false,
  soundEnabled: true,
  vibrationEnabled: true,
  cooldownSeconds: 3,
  markLateMissedLessons: false,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DEVICE_ID_STORAGE_KEY = 'edutrack_gate_device_id';

export function getEntrySettings(
  institution: Partial<
    Pick<
      Institution,
      | 'entryStartTime'
      | 'entryLateAfterMinutes'
      | 'entryUseFirstTimetableLesson'
      | 'entrySoundEnabled'
      | 'entryVibrationEnabled'
      | 'entryCooldownSeconds'
      | 'entryMarkLateMissedLessons'
    >
  >,
): EntrySettings {
  const startTime =
    institution.entryStartTime && TIME_PATTERN.test(institution.entryStartTime.trim())
      ? institution.entryStartTime.trim().slice(0, 5)
      : DEFAULT_ENTRY_SETTINGS.startTime;
  const lateAfterMinutes =
    typeof institution.entryLateAfterMinutes === 'number' && Number.isFinite(institution.entryLateAfterMinutes)
      ? Math.max(0, Math.min(240, Math.floor(institution.entryLateAfterMinutes)))
      : DEFAULT_ENTRY_SETTINGS.lateAfterMinutes;
  const cooldownSeconds =
    typeof institution.entryCooldownSeconds === 'number' && Number.isFinite(institution.entryCooldownSeconds)
      ? Math.max(0, Math.min(60, Math.floor(institution.entryCooldownSeconds)))
      : DEFAULT_ENTRY_SETTINGS.cooldownSeconds;

  return {
    startTime,
    lateAfterMinutes,
    useFirstTimetableLesson: institution.entryUseFirstTimetableLesson === true,
    soundEnabled: institution.entrySoundEnabled !== false,
    vibrationEnabled: institution.entryVibrationEnabled !== false,
    cooldownSeconds,
    markLateMissedLessons: institution.entryMarkLateMissedLessons === true,
  };
}

export function getOrCreateDeviceId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.trim()) return existing.trim();
      const generated =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
      return generated;
    }
  } catch {
    // Ignore storage restriction in private/restricted contexts
  }
  return 'device-local';
}

export function nowTimeHms(now: Date = new Date()): string {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function parseTimeToMinutes(time: string): number | null {
  const match = TIME_PATTERN.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function resolveExpectedStartTime(
  classId: string,
  date: string,
  slots: LessonSlot[],
  settings: Pick<EntrySettings, 'startTime' | 'useFirstTimetableLesson'>,
): string {
  if (!settings.useFirstTimetableLesson) return settings.startTime;
  const day = weekdayOfDate(date);
  const lessons = classLessonsForDay(slots, classId, day);
  if (lessons.length === 0) return settings.startTime;
  const firstPeriodNumber = lessons[0].period;
  const periodMeta = PERIODS.find((item) => item.number === firstPeriodNumber);
  return periodMeta ? periodMeta.start : settings.startTime;
}

export function computeLateStatus(
  entryTime: string,
  expectedStartTime: string,
  lateAfterMinutes: number,
): { late: boolean; minutesLate: number } {
  const actual = parseTimeToMinutes(entryTime);
  const expected = parseTimeToMinutes(expectedStartTime);
  if (actual === null || expected === null) return { late: false, minutesLate: 0 };
  const diff = actual - expected;
  if (diff > Math.max(0, lateAfterMinutes)) {
    return { late: true, minutesLate: diff };
  }
  return { late: false, minutesLate: 0 };
}

export interface GateScanDecision {
  result: EntryResult;
  student: Student | null;
  scannedCode: string;
  late: boolean;
  minutesLate: number;
  existingTime: string | null;
}

export interface DecideGateScanInput {
  rawCode: string;
  date: string;
  time: string;
  students: Student[];
  entriesForDate: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'deletedAt'>[];
  slots: LessonSlot[];
  settings: Pick<EntrySettings, 'startTime' | 'lateAfterMinutes' | 'useFirstTimetableLesson'>;
  preferredField?: CanteenMatchField;
  convertAzertyDigits?: boolean;
}

export function decideGateScan(input: DecideGateScanInput): GateScanDecision {
  const scannedCode = normalizeScannedCode(input.rawCode, {
    convertAzertyDigits: input.convertAzertyDigits ?? true,
  });
  if (!scannedCode) {
    return { result: 'unknown', student: null, scannedCode: '', late: false, minutesLate: 0, existingTime: null };
  }

  const student = matchStudentFromScan(input.students, scannedCode, input.preferredField);
  if (!student) {
    return { result: 'unknown', student: null, scannedCode, late: false, minutesLate: 0, existingTime: null };
  }

  if (student.leaveDate !== null && student.leaveDate <= input.date) {
    return { result: 'left', student, scannedCode, late: false, minutesLate: 0, existingTime: null };
  }

  const existingAccepted = input.entriesForDate
    .filter(
      (entry) =>
        entry.deletedAt === null &&
        entry.date === input.date &&
        entry.studentId === student.id &&
        entry.result === 'accepted',
    )
    .sort((a, b) => a.time.localeCompare(b.time))[0];

  if (existingAccepted) {
    return {
      result: 'duplicate',
      student,
      scannedCode,
      late: false,
      minutesLate: 0,
      existingTime: existingAccepted.time.slice(0, 5),
    };
  }

  const expectedStart = resolveExpectedStartTime(student.classId, input.date, input.slots, input.settings);
  const { late, minutesLate } = computeLateStatus(input.time, expectedStart, input.settings.lateAfterMinutes);
  return {
    result: 'accepted',
    student,
    scannedCode,
    late,
    minutesLate,
    existingTime: null,
  };
}

export function isInstitutionHolidayOrClosed(
  date: string,
  institution: Pick<Institution, 'workingDays' | 'holidays'>,
): { closed: boolean; holidayName: string | null } {
  const holiday = institution.holidays.find((item) => item.date === date);
  if (holiday) return { closed: true, holidayName: holiday.name };
  const holidaySet = new Set(institution.holidays.map((item) => item.date));
  const open = isSchoolDay(date, institution.workingDays, holidaySet);
  return { closed: !open, holidayName: null };
}

export interface DailyEntryStats {
  enrolled: number;
  entered: number;
  notEntered: number;
  late: number;
  duplicates: number;
  unknown: number;
  left: number;
  rejected: number;
  percentage: number;
}

export function acceptedEntryByStudent(
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[],
  date: string,
): Map<string, Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>> {
  const map = new Map<
    string,
    Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>
  >();
  for (const entry of entries) {
    if (entry.deletedAt !== null || entry.date !== date || entry.result !== 'accepted' || !entry.studentId) {
      continue;
    }
    const prev = map.get(entry.studentId);
    if (!prev || entry.time.localeCompare(prev.time) < 0) {
      map.set(entry.studentId, entry);
    }
  }
  return map;
}

export function computeEntryStats(
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>[],
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[],
  date: string,
): DailyEntryStats {
  const enrolledStudents = students.filter((student) => student.deletedAt === null && isEnrolledOn(student, date));
  const enrolledIds = new Set(enrolledStudents.map((student) => student.id));
  const acceptedMap = acceptedEntryByStudent(entries, date);

  let entered = 0;
  let late = 0;
  for (const [studentId, entry] of acceptedMap.entries()) {
    if (!enrolledIds.has(studentId)) continue;
    entered += 1;
    if (entry.late) late += 1;
  }

  let duplicates = 0;
  let unknown = 0;
  let left = 0;
  for (const entry of entries) {
    if (entry.deletedAt !== null || entry.date !== date) continue;
    if (entry.result === 'duplicate') duplicates += 1;
    else if (entry.result === 'unknown') unknown += 1;
    else if (entry.result === 'left') left += 1;
  }

  const enrolled = enrolledStudents.length;
  const notEntered = Math.max(0, enrolled - entered);
  const rejected = duplicates + unknown + left;
  const percentage = enrolled > 0 ? Math.round((entered / enrolled) * 100) : 0;

  return {
    enrolled,
    entered,
    notEntered,
    late,
    duplicates,
    unknown,
    left,
    rejected,
    percentage,
  };
}

export interface ClassEntryRow {
  classId: string;
  className: string;
  level: number | null;
  enrolled: number;
  entered: number;
  notEntered: number;
  late: number;
  percentage: number;
}

export interface LevelEntryGroup {
  level: number | null;
  rows: ClassEntryRow[];
  subtotal: {
    enrolled: number;
    entered: number;
    notEntered: number;
    late: number;
    percentage: number;
  };
}

export interface ClassEntryBreakdown {
  groups: LevelEntryGroup[];
  total: {
    enrolled: number;
    entered: number;
    notEntered: number;
    late: number;
    percentage: number;
  };
}

export function inferClassLevel(schoolClass: Pick<SchoolClass, 'name' | 'level'>): number | null {
  if (typeof schoolClass.level === 'number' && Number.isFinite(schoolClass.level)) {
    return schoolClass.level;
  }
  const match = /^\s*([1-4])/.exec(schoolClass.name);
  return match ? Number(match[1]) : null;
}

export function computeClassEntryBreakdown(
  classes: Pick<SchoolClass, 'id' | 'name' | 'level' | 'deletedAt'>[],
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>[],
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[],
  date: string,
): ClassEntryBreakdown {
  const activeClasses = classes
    .filter((item) => item.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const acceptedMap = acceptedEntryByStudent(entries, date);

  const enrolledByClass = new Map<string, string[]>();
  for (const student of students) {
    if (student.deletedAt !== null || !isEnrolledOn(student, date)) continue;
    const list = enrolledByClass.get(student.classId) ?? [];
    list.push(student.id);
    enrolledByClass.set(student.classId, list);
  }

  const rows: ClassEntryRow[] = activeClasses.map((schoolClass) => {
    const ids = enrolledByClass.get(schoolClass.id) ?? [];
    let entered = 0;
    let late = 0;
    for (const id of ids) {
      const entry = acceptedMap.get(id);
      if (entry) {
        entered += 1;
        if (entry.late) late += 1;
      }
    }
    const enrolled = ids.length;
    const notEntered = Math.max(0, enrolled - entered);
    return {
      classId: schoolClass.id,
      className: schoolClass.name,
      level: inferClassLevel(schoolClass),
      enrolled,
      entered,
      notEntered,
      late,
      percentage: enrolled > 0 ? Math.round((entered / enrolled) * 100) : 0,
    };
  });

  const groupMap = new Map<number | null, ClassEntryRow[]>();
  for (const row of rows) {
    const list = groupMap.get(row.level) ?? [];
    list.push(row);
    groupMap.set(row.level, list);
  }

  const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  const groups: LevelEntryGroup[] = sortedKeys.map((level) => {
    const levelRows = groupMap.get(level) ?? [];
    const enrolled = levelRows.reduce((sum, item) => sum + item.enrolled, 0);
    const entered = levelRows.reduce((sum, item) => sum + item.entered, 0);
    const late = levelRows.reduce((sum, item) => sum + item.late, 0);
    const notEntered = Math.max(0, enrolled - entered);
    return {
      level,
      rows: levelRows,
      subtotal: {
        enrolled,
        entered,
        notEntered,
        late,
        percentage: enrolled > 0 ? Math.round((entered / enrolled) * 100) : 0,
      },
    };
  });

  const totalEnrolled = rows.reduce((sum, item) => sum + item.enrolled, 0);
  const totalEntered = rows.reduce((sum, item) => sum + item.entered, 0);
  const totalLate = rows.reduce((sum, item) => sum + item.late, 0);
  const totalNotEntered = Math.max(0, totalEnrolled - totalEntered);

  return {
    groups,
    total: {
      enrolled: totalEnrolled,
      entered: totalEntered,
      notEntered: totalNotEntered,
      late: totalLate,
      percentage: totalEnrolled > 0 ? Math.round((totalEntered / totalEnrolled) * 100) : 0,
    },
  };
}

export interface TenMinuteBucket {
  label: string;
  count: number;
  lateCount: number;
}

export function computeTenMinuteBuckets(
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[],
  date: string,
): TenMinuteBucket[] {
  const accepted = Array.from(acceptedEntryByStudent(entries, date).values());
  const bucketMap = new Map<number, { count: number; lateCount: number }>();

  for (const entry of accepted) {
    const mins = parseTimeToMinutes(entry.time);
    if (mins === null) continue;
    const slotStart = Math.floor(mins / 10) * 10;
    const prev = bucketMap.get(slotStart) ?? { count: 0, lateCount: 0 };
    prev.count += 1;
    if (entry.late) prev.lateCount += 1;
    bucketMap.set(slotStart, prev);
  }

  return Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([slotStart, stats]) => {
      const h = String(Math.floor(slotStart / 60)).padStart(2, '0');
      const m = String(slotStart % 60).padStart(2, '0');
      return {
        label: `${h}:${m}`,
        count: stats.count,
        lateCount: stats.lateCount,
      };
    });
}

export function computeLateMissedPeriods(
  classId: string,
  date: string,
  entryTime: string,
  slots: LessonSlot[],
): { period: number; subject: string }[] {
  const entryMinutes = parseTimeToMinutes(entryTime);
  if (entryMinutes === null) return [];
  const lessons = classLessonsForDay(slots, classId, weekdayOfDate(date));
  const missed: { period: number; subject: string }[] = [];

  for (const lesson of lessons) {
    const periodInfo = PERIODS.find((item) => item.number === lesson.period);
    if (!periodInfo) continue;
    const endMinutes = parseTimeToMinutes(periodInfo.end);
    if (endMinutes !== null && endMinutes <= entryMinutes) {
      missed.push({ period: lesson.period, subject: lesson.subject });
    }
  }

  return missed;
}

export interface AutoAbsencePlanItem {
  studentId: string;
  classId: string;
  period: number;
  subject: string;
}

export function planAutoAbsencesForStart(input: {
  date: string;
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>[];
  slots: LessonSlot[];
  entries: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'result' | 'late' | 'minutesLate' | 'deletedAt'>[];
  existingAbsences: { studentId: string; period: number; deletedAt: string | null }[];
  settings: Pick<EntrySettings, 'markLateMissedLessons'>;
}): AutoAbsencePlanItem[] {
  const acceptedMap = acceptedEntryByStudent(input.entries, input.date);
  const existingKeys = new Set(
    input.existingAbsences
      .filter((item) => item.deletedAt === null)
      .map((item) => `${item.studentId}|${item.period}`),
  );
  const day = weekdayOfDate(input.date);
  const lessonsByClass = new Map<string, { period: number; subject: string }[]>();
  const getLessons = (classId: string) => {
    let cached = lessonsByClass.get(classId);
    if (!cached) {
      cached = classLessonsForDay(input.slots, classId, day).map((lesson) => ({
        period: lesson.period,
        subject: lesson.subject,
      }));
      lessonsByClass.set(classId, cached);
    }
    return cached;
  };

  const planned: AutoAbsencePlanItem[] = [];
  for (const student of input.students) {
    if (student.deletedAt !== null || !isEnrolledOn(student, input.date)) continue;
    const lessons = getLessons(student.classId);
    if (lessons.length === 0) continue;

    const accepted = acceptedMap.get(student.id);
    if (!accepted) {
      for (const lesson of lessons) {
        const key = `${student.id}|${lesson.period}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        planned.push({
          studentId: student.id,
          classId: student.classId,
          period: lesson.period,
          subject: lesson.subject || '—',
        });
      }
    } else if (input.settings.markLateMissedLessons && accepted.late) {
      const missed = computeLateMissedPeriods(student.classId, input.date, accepted.time, input.slots);
      for (const lesson of missed) {
        const key = `${student.id}|${lesson.period}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        planned.push({
          studentId: student.id,
          classId: student.classId,
          period: lesson.period,
          subject: lesson.subject || '—',
        });
      }
    }
  }

  return planned;
}

export interface StudentGateAbsenceSyncPlan {
  toSoftDeleteIds: string[];
  toAdd: { period: number; subject: string }[];
  hasManualAbsence: boolean;
}

export function planStudentGateAbsenceSync(input: {
  classId: string;
  date: string;
  entryTime: string;
  late: boolean;
  slots: LessonSlot[];
  existingStudentAbsences: { id: string; period: number; source?: 'manual' | 'gate'; deletedAt: string | null }[];
  markLateMissedLessons: boolean;
}): StudentGateAbsenceSyncPlan {
  const active = input.existingStudentAbsences.filter((item) => item.deletedAt === null);
  const missed =
    input.late && input.markLateMissedLessons
      ? computeLateMissedPeriods(input.classId, input.date, input.entryTime, input.slots)
      : [];
  const keepPeriods = new Set(missed.map((item) => item.period));

  const toSoftDeleteIds: string[] = [];
  const remainingPeriods = new Set<number>();
  let hasManualAbsence = false;

  for (const record of active) {
    if (record.source === 'gate' && !keepPeriods.has(record.period)) {
      toSoftDeleteIds.push(record.id);
    } else {
      remainingPeriods.add(record.period);
      if (record.source !== 'gate') {
        hasManualAbsence = true;
      }
    }
  }

  const toAdd = missed.filter((item) => !remainingPeriods.has(item.period));
  return { toSoftDeleteIds, toAdd, hasManualAbsence };
}


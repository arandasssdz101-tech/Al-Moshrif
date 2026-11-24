import type {
  CanteenMatchField,
  EntryResult,
  EntrySession,
  GateEntry,
  Institution,
  SchoolClass,
  Student,
  StudentAbsence,
} from '@/db/types';
import { isEnrolledOn, isSchoolDay } from '@/utils/absenceReports';
import { classLessonsForDay, weekdayOfDate, type LessonSlot } from '@/utils/absences';
import { LUNCH_BREAK, PERIODS } from '@/utils/schedule';
import { matchStudentFromScan, normalizeScannedCode } from '@/utils/studentQr';

export interface EntrySettings {
  startTime: string;
  eveningStartTime: string;
  lateAfterMinutes: number;
  useFirstTimetableLesson: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  cooldownSeconds: number;
  markLateMissedLessons: boolean;
}

export const DEFAULT_ENTRY_SETTINGS: EntrySettings = {
  startTime: '08:00',
  eveningStartTime: '13:00',
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
      | 'entryEveningStartTime'
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
  const eveningStartTime =
    institution.entryEveningStartTime && TIME_PATTERN.test(institution.entryEveningStartTime.trim())
      ? institution.entryEveningStartTime.trim().slice(0, 5)
      : DEFAULT_ENTRY_SETTINGS.eveningStartTime;
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
    eveningStartTime,
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

export function eveningCutoffMinutes(eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime): number {
  const startMins = parseTimeToMinutes(eveningStartTime) ?? 13 * 60;
  // Gate opens up to 30 minutes before the official evening start time (e.g. 12:30 for 13:00), never before 12:00.
  return Math.max(12 * 60, startMins - 30);
}

export function defaultEntrySession(
  now: Date = new Date(),
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): EntrySession {
  const currentMins = now.getHours() * 60 + now.getMinutes();
  return currentMins >= eveningCutoffMinutes(eveningStartTime) ? 'evening' : 'morning';
}

export function resolveEntrySession(
  entry: Pick<GateEntry, 'time' | 'session'>,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): EntrySession {
  if (entry.session === 'morning' || entry.session === 'evening') {
    return entry.session;
  }
  const mins = parseTimeToMinutes(entry.time);
  if (mins !== null && mins >= eveningCutoffMinutes(eveningStartTime)) {
    return 'evening';
  }
  return 'morning';
}

export function isPeriodInSession(
  periodNumber: number,
  session: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): boolean {
  const periodMeta = PERIODS.find((item) => item.number === periodNumber);
  if (!periodMeta) return true;
  const periodStartMins = parseTimeToMinutes(periodMeta.start);
  if (periodStartMins === null) return true;
  const lunchEndMins = parseTimeToMinutes(LUNCH_BREAK.end) ?? 13 * 60;
  const configuredEveningMins = parseTimeToMinutes(eveningStartTime) ?? lunchEndMins;
  const boundaryMins = Math.min(lunchEndMins, configuredEveningMins);
  return session === 'evening' ? periodStartMins >= boundaryMins : periodStartMins < boundaryMins;
}

export function resolveExpectedStartTime(
  classId: string,
  date: string,
  slots: LessonSlot[],
  settings: Pick<EntrySettings, 'startTime' | 'useFirstTimetableLesson'> & { eveningStartTime?: string },
  session: EntrySession = 'morning',
): string {
  const baseStart =
    session === 'evening'
      ? settings.eveningStartTime || DEFAULT_ENTRY_SETTINGS.eveningStartTime
      : settings.startTime;

  if (!settings.useFirstTimetableLesson) return baseStart;
  const day = weekdayOfDate(date);
  const lessons = classLessonsForDay(slots, classId, day).filter((lesson) =>
    isPeriodInSession(lesson.period, session, settings.eveningStartTime),
  );
  if (lessons.length === 0) return baseStart;
  const firstPeriodNumber = lessons[0].period;
  const periodMeta = PERIODS.find((item) => item.number === firstPeriodNumber);
  return periodMeta ? periodMeta.start : baseStart;
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
  session: EntrySession;
  late: boolean;
  minutesLate: number;
  existingTime: string | null;
}

export interface DecideGateScanInput {
  rawCode: string;
  date: string;
  time: string;
  session?: EntrySession;
  students: Student[];
  entriesForDate: Pick<GateEntry, 'studentId' | 'date' | 'time' | 'session' | 'result' | 'deletedAt'>[];
  slots: LessonSlot[];
  settings: Pick<EntrySettings, 'startTime' | 'lateAfterMinutes' | 'useFirstTimetableLesson'> & {
    eveningStartTime?: string;
  };
  preferredField?: CanteenMatchField;
  convertAzertyDigits?: boolean;
}

export function decideGateScan(input: DecideGateScanInput): GateScanDecision {
  const eveningStart = input.settings.eveningStartTime ?? DEFAULT_ENTRY_SETTINGS.eveningStartTime;
  const session = input.session ?? resolveEntrySession({ time: input.time }, eveningStart);
  const scannedCode = normalizeScannedCode(input.rawCode, {
    convertAzertyDigits: input.convertAzertyDigits ?? true,
  });
  if (!scannedCode) {
    return {
      result: 'unknown',
      student: null,
      scannedCode: '',
      session,
      late: false,
      minutesLate: 0,
      existingTime: null,
    };
  }

  const student = matchStudentFromScan(input.students, scannedCode, input.preferredField);
  if (!student) {
    return {
      result: 'unknown',
      student: null,
      scannedCode,
      session,
      late: false,
      minutesLate: 0,
      existingTime: null,
    };
  }

  if (student.leaveDate !== null && student.leaveDate <= input.date) {
    return {
      result: 'left',
      student,
      scannedCode,
      session,
      late: false,
      minutesLate: 0,
      existingTime: null,
    };
  }

  const existingAccepted = input.entriesForDate
    .filter(
      (entry) =>
        entry.deletedAt == null &&
        entry.date === input.date &&
        entry.studentId === student.id &&
        entry.result === 'accepted' &&
        resolveEntrySession(entry, eveningStart) === session,
    )
    .sort((a, b) => a.time.localeCompare(b.time))[0];

  if (existingAccepted) {
    return {
      result: 'duplicate',
      student,
      scannedCode,
      session,
      late: false,
      minutesLate: 0,
      existingTime: existingAccepted.time.slice(0, 5),
    };
  }

  const expectedStart = resolveExpectedStartTime(
    student.classId,
    input.date,
    input.slots,
    input.settings,
    session,
  );
  const { late, minutesLate } = computeLateStatus(input.time, expectedStart, input.settings.lateAfterMinutes);
  return {
    result: 'accepted',
    student,
    scannedCode,
    session,
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

type EntrySummaryFields = Pick<
  GateEntry,
  'studentId' | 'date' | 'time' | 'session' | 'result' | 'late' | 'minutesLate' | 'deletedAt'
>;

export function filterEntriesBySession<T extends Pick<GateEntry, 'time' | 'session'>>(
  entries: T[],
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): T[] {
  if (!session) return entries;
  return entries.filter((entry) => resolveEntrySession(entry, eveningStartTime) === session);
}

export function acceptedEntryByStudent(
  entries: EntrySummaryFields[],
  date: string,
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): Map<string, EntrySummaryFields> {
  const map = new Map<string, EntrySummaryFields>();
  for (const entry of entries) {
    if (entry.deletedAt != null || entry.date !== date || entry.result !== 'accepted' || !entry.studentId) {
      continue;
    }
    if (session && resolveEntrySession(entry, eveningStartTime) !== session) {
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
  entries: EntrySummaryFields[],
  date: string,
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): DailyEntryStats {
  const enrolledStudents = students.filter((student) => student.deletedAt == null && isEnrolledOn(student, date));
  const enrolledIds = new Set(enrolledStudents.map((student) => student.id));
  const scopedEntries = filterEntriesBySession(entries, session, eveningStartTime);
  const acceptedMap = acceptedEntryByStudent(scopedEntries, date, session, eveningStartTime);

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
  for (const entry of scopedEntries) {
    if (entry.deletedAt != null || entry.date !== date) continue;
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
  entries: EntrySummaryFields[],
  date: string,
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): ClassEntryBreakdown {
  const activeClasses = classes
    .filter((item) => item.deletedAt == null)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }));
  const acceptedMap = acceptedEntryByStudent(entries, date, session, eveningStartTime);

  const enrolledByClass = new Map<string, string[]>();
  for (const student of students) {
    if (student.deletedAt != null || !isEnrolledOn(student, date)) continue;
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
  entries: EntrySummaryFields[],
  date: string,
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): TenMinuteBucket[] {
  const accepted = Array.from(acceptedEntryByStudent(entries, date, session, eveningStartTime).values());
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
  session?: EntrySession,
  eveningStartTime: string = DEFAULT_ENTRY_SETTINGS.eveningStartTime,
): { period: number; subject: string }[] {
  const entryMinutes = parseTimeToMinutes(entryTime);
  if (entryMinutes === null) return [];
  const lessons = classLessonsForDay(slots, classId, weekdayOfDate(date)).filter((lesson) =>
    session ? isPeriodInSession(lesson.period, session, eveningStartTime) : true,
  );
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
  session?: EntrySession;
  eveningStartTime?: string;
  students: Pick<Student, 'id' | 'classId' | 'joinDate' | 'leaveDate' | 'deletedAt'>[];
  slots: LessonSlot[];
  entries: EntrySummaryFields[];
  existingAbsences: { studentId: string; period: number; deletedAt: string | null }[];
  settings: Pick<EntrySettings, 'markLateMissedLessons'>;
}): AutoAbsencePlanItem[] {
  const eveningStart = input.eveningStartTime ?? DEFAULT_ENTRY_SETTINGS.eveningStartTime;
  const acceptedMap = acceptedEntryByStudent(input.entries, input.date, input.session, eveningStart);
  const existingKeys = new Set(
    input.existingAbsences
      .filter((item) => item.deletedAt == null)
      .map((item) => `${item.studentId}|${item.period}`),
  );
  const day = weekdayOfDate(input.date);
  const lessonsByClass = new Map<string, { period: number; subject: string }[]>();
  const getLessons = (classId: string) => {
    let cached = lessonsByClass.get(classId);
    if (!cached) {
      cached = classLessonsForDay(input.slots, classId, day)
        .filter((lesson) => (input.session ? isPeriodInSession(lesson.period, input.session, eveningStart) : true))
        .map((lesson) => ({
          period: lesson.period,
          subject: lesson.subject,
        }));
      lessonsByClass.set(classId, cached);
    }
    return cached;
  };

  const planned: AutoAbsencePlanItem[] = [];
  for (const student of input.students) {
    if (student.deletedAt != null || !isEnrolledOn(student, input.date)) continue;
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
      const missed = computeLateMissedPeriods(
        student.classId,
        input.date,
        accepted.time,
        input.slots,
        input.session,
        eveningStart,
      );
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
  session?: EntrySession;
  eveningStartTime?: string;
  slots: LessonSlot[];
  existingStudentAbsences: { id: string; period: number; source?: StudentAbsence['source']; deletedAt?: string | null }[];
  markLateMissedLessons: boolean;
}): StudentGateAbsenceSyncPlan {
  const eveningStart = input.eveningStartTime ?? DEFAULT_ENTRY_SETTINGS.eveningStartTime;
  const active = input.existingStudentAbsences.filter((item) => item.deletedAt == null);
  const missed =
    input.late && input.markLateMissedLessons
      ? computeLateMissedPeriods(
          input.classId,
          input.date,
          input.entryTime,
          input.slots,
          input.session,
          eveningStart,
        )
      : [];
  const keepPeriods = new Set(missed.map((item) => item.period));

  const toSoftDeleteIds: string[] = [];
  const remainingPeriods = new Set<number>();
  let hasManualAbsence = false;

  for (const record of active) {
    const inTargetSession = input.session
      ? isPeriodInSession(record.period, input.session, eveningStart)
      : true;
    if (record.source === 'gate' && inTargetSession && !keepPeriods.has(record.period)) {
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



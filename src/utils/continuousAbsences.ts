import type {
  ContinuousAbsence,
  ParentCorrespondenceRow,
  SchoolClass,
  Student,
  StudentAbsence,
} from '@/db/types';
import { isSchoolDay } from '@/utils/absenceReports';
import { formatDate } from '@/utils/dailyReportHtml';
import { shiftIsoDate } from '@/utils/dailyReportStats';

// Official continuous absence escalation schedule:
// Day 4 (+3d): First Notice | After 10d (+10d): Second Notice | After 18d (+18d): Excuse | Day 33 (+33d): Strike-off
export const FIRST_NOTICE_OFFSET_DAYS = 3;
export const SECOND_NOTICE_OFFSET_DAYS = 10;
export const EXCUSE_OFFSET_DAYS = 18;
export const STRIKE_OFFSET_DAYS = 33;

const MAX_SYNC_SPAN_DAYS = 366;

export interface NoticeSchedule {
  startDate: string;
  firstNoticeDate: string;
  secondNoticeDate: string;
  excuseDate: string;
  strikeDate: string;
}

export type ContinuousAbsenceStage =
  | 'upcoming'
  | 'active'
  | 'firstNotice'
  | 'secondNotice'
  | 'excuse'
  | 'struck'
  | 'closed';

export interface ContinuousAbsenceStatus {
  schedule: NoticeSchedule;
  stage: ContinuousAbsenceStage;
  daysElapsed: number;
  dayNumber: number;
  firstNoticeReached: boolean;
  secondNoticeReached: boolean;
  excuseReached: boolean;
  struck: boolean;
}

export function diffIsoDays(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso}T00:00:00Z`);
  const toMs = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function computeNoticeSchedule(startDate: string): NoticeSchedule {
  return {
    startDate,
    firstNoticeDate: shiftIsoDate(startDate, FIRST_NOTICE_OFFSET_DAYS),
    secondNoticeDate: shiftIsoDate(startDate, SECOND_NOTICE_OFFSET_DAYS),
    excuseDate: shiftIsoDate(startDate, EXCUSE_OFFSET_DAYS),
    strikeDate: shiftIsoDate(startDate, STRIKE_OFFSET_DAYS),
  };
}

export function evaluateContinuousAbsenceStatus(
  record: Pick<ContinuousAbsence, 'startDate' | 'endDate' | 'struckAt'>,
  referenceDate: string,
): ContinuousAbsenceStatus {
  const schedule = computeNoticeSchedule(record.startDate);
  const isClosed = record.endDate != null;
  const effectiveDate = record.endDate != null ? minIsoDate(referenceDate, record.endDate) : referenceDate;
  const rawElapsed = diffIsoDays(record.startDate, effectiveDate);
  const daysElapsed = Math.max(0, rawElapsed);
  const dayNumber = rawElapsed < 0 ? 0 : daysElapsed + 1;

  const firstNoticeReached = effectiveDate >= schedule.firstNoticeDate;
  const secondNoticeReached = effectiveDate >= schedule.secondNoticeDate;
  const excuseReached = effectiveDate >= schedule.excuseDate;
  const struck = !isClosed && (Boolean(record.struckAt) || referenceDate >= schedule.strikeDate);

  let stage: ContinuousAbsenceStage;
  if (rawElapsed < 0 && !isClosed) {
    stage = 'upcoming';
  } else if (isClosed) {
    stage = 'closed';
  } else if (struck) {
    stage = 'struck';
  } else if (excuseReached) {
    stage = 'excuse';
  } else if (secondNoticeReached) {
    stage = 'secondNotice';
  } else if (firstNoticeReached) {
    stage = 'firstNotice';
  } else {
    stage = 'active';
  }

  return {
    schedule,
    stage,
    daysElapsed,
    dayNumber,
    firstNoticeReached,
    secondNoticeReached,
    excuseReached,
    struck,
  };
}

export function effectiveAbsenceEndForSync(
  record: Pick<ContinuousAbsence, 'startDate' | 'endDate'>,
  upToDate: string,
): string | null {
  const schedule = computeNoticeSchedule(record.startDate);
  const lastDayBeforeStrike = shiftIsoDate(schedule.strikeDate, -1);

  if (record.endDate !== null) {
    if (record.endDate < record.startDate) return null;
    return record.endDate;
  }

  const end = minIsoDate(upToDate, lastDayBeforeStrike);
  if (end < record.startDate) return null;
  return end;
}

export function enumerateSchoolDaysInRange(
  startDate: string,
  endDate: string,
  workingDays: number[],
  holidayDates: readonly string[],
): string[] {
  if (endDate < startDate) return [];
  const holidaySet = new Set(holidayDates);
  const days: string[] = [];
  let cursor = startDate;
  for (let step = 0; step < MAX_SYNC_SPAN_DAYS && cursor <= endDate; step += 1) {
    if (isSchoolDay(cursor, workingDays, holidaySet)) {
      days.push(cursor);
    }
    cursor = shiftIsoDate(cursor, 1);
  }
  return days;
}

export interface BuildContinuousParentRowsInput {
  date: string;
  continuousAbsences: ContinuousAbsence[];
  students: Student[];
  classes: SchoolClass[];
  absences: StudentAbsence[];
  defaultReason: string;
}

export function buildContinuousParentRows({
  date,
  continuousAbsences,
  students,
  classes,
  absences,
  defaultReason,
}: BuildContinuousParentRowsInput): ParentCorrespondenceRow[] {
  const studentById = new Map(students.filter((s) => s.deletedAt == null).map((s) => [s.id, s]));
  const classNameById = new Map(classes.filter((c) => c.deletedAt == null).map((c) => [c.id, c.name]));

  const rows: ParentCorrespondenceRow[] = [];
  const seenStudents = new Set<string>();

  const sorted = [...continuousAbsences]
    .filter((item) => item.deletedAt == null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (const record of sorted) {
    if (date < record.startDate) continue;
    const schedule = computeNoticeSchedule(record.startDate);

    // Parent correspondence begins from Day 4 (first notice date)
    if (date < schedule.firstNoticeDate) continue;

    // Closed absence: only show in parent correspondence through its end date
    if (record.endDate !== null && date > record.endDate) continue;

    // Open absence: show up through the strike-off day (Day 33)
    if (record.endDate === null && date > schedule.strikeDate) continue;

    const student = studentById.get(record.studentId);
    if (!student || seenStudents.has(student.id)) continue;
    seenStudents.add(student.id);

    const cumulativeHours = absences.filter(
      (item) =>
        item.deletedAt == null &&
        item.status !== 'late' &&
        item.studentId === student.id &&
        item.date >= record.startDate &&
        item.date <= date,
    ).length;

    const reachedSecond = date >= schedule.secondNoticeDate;
    const reachedExcuse = date >= schedule.excuseDate;
    const reachedStrike = record.endDate === null && date >= schedule.strikeDate;

    rows.push({
      studentId: student.id,
      name: `${student.lastName} ${student.firstName}`.trim(),
      className: classNameById.get(student.classId) ?? classNameById.get(record.classId) ?? '',
      hours: cumulativeHours > 0 ? String(cumulativeHours) : '',
      absenceDate: record.startDate,
      reason: record.reason.trim() || defaultReason,
      firstNotice: formatDate(schedule.firstNoticeDate),
      secondNotice: reachedSecond ? formatDate(schedule.secondNoticeDate) : '',
      excuse: reachedExcuse ? formatDate(schedule.excuseDate) : '',
      struckDate: reachedStrike ? schedule.strikeDate : '',
    });
  }

  return rows.sort(
    (a, b) =>
      a.className.localeCompare(b.className, undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
}

export function mergeParentCorrespondenceRows(
  manualRows: ParentCorrespondenceRow[],
  autoRows: ParentCorrespondenceRow[],
): ParentCorrespondenceRow[] {
  if (autoRows.length === 0) return manualRows;
  const manualStudentIds = new Set(
    manualRows.map((row) => row.studentId).filter((id): id is string => Boolean(id)),
  );
  const additional = autoRows.filter((row) => !row.studentId || !manualStudentIds.has(row.studentId));
  return [...manualRows, ...additional];
}

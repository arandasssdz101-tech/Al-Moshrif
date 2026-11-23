import type { AbsenceCountRule, CanteenEntry, SchoolClass, Student, StudentAbsence, SupervisorAbsenceRow, Teacher, TeacherAbsence, TeacherAbsenceReason, TimetableSlot, User } from '@/db/types';
import { canteenReport, isEnrolledOn, teacherDayAbsences } from '@/utils/absenceReports';
import { classLessonsForDay, weekdayOfDate, type StudentAbsenceTotals } from '@/utils/absences';
import { evaluateStudentDayAbsence, indexActiveAbsencesForDate } from '@/utils/dailyPage1';
import { levelAttendance, personCounts, studentSummary, type LevelAttendance, type PersonCounts, type StudentSummary } from '@/utils/dailyReportStats';
import { normalizeText } from '@/utils/text';

export const DEFAULT_PERIOD_COLUMNS = 7;
export const MAX_PERIOD_COLUMNS = 8;

const BRACKETED_TD_RE = /\s*[[({]\s*(?:t\.?\s*d\.?(?:\s*\d+)?|[أإآا]عمال\s+موجه[ةه]|[أإآا]\s*\.\s*م\.?)\s*[\])}]\s*/gi;
const STANDALONE_TD_RE = /(^|[\s\-–—_:/\\,،+·•\u0600-\u06FF])(?:t\.?\s*d\.?(?:\s*\d+)?)(?=$|[\s\-–—_:/\\,،+·•()[\]{}\u0600-\u06FF])/gi;
const ARABIC_TD_RE = /(^|[\s\-–—_:/\\,،+·•()[\]{}])(?:[أإآا]عمال\s+موجه[ةه]|[أإآا]\s*\.\s*م\.?)(?=$|[\s\-–—_:/\\,،+·•()[\]{}])/g;
const EDGE_SEPARATORS_RE = /^[\s\-–—_:/\\,،+·•]+|[\s\-–—_:/\\,،+·•]+$/g;

export function cleanDailyReportSubject(subject: string): string {
  return subject
    .replace(BRACKETED_TD_RE, ' ')
    .replace(STANDALONE_TD_RE, '$1')
    .replace(ARABIC_TD_RE, '$1')
    .replace(/\s+/g, ' ')
    .replace(EDGE_SEPARATORS_RE, '')
    .trim();
}

export function formatDailyReportSubjects(rawSubjects: string[]): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of rawSubjects) {
    for (const part of raw.split('/')) {
      const base = cleanDailyReportSubject(part);
      if (!base) continue;
      const key = normalizeText(base);
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(base);
    }
  }

  if (cleaned.length > 0) return cleaned.join(' / ');
  return [...new Set(rawSubjects.map((item) => item.trim()).filter(Boolean))].join(' / ');
}

export interface TeacherLineRender {
  teacherId: string;
  name: string;
  subjects: string;
  marks: number[];
  classes: string;
  classByPeriod: Record<number, string>;
  reason: TeacherAbsenceReason | '';
  reasonNote: string;
  note: string;
}

export interface Page2Input {
  date: string;
  rule: AbsenceCountRule;
  classes: SchoolClass[];
  students: Student[];
  slots: TimetableSlot[];
  studentAbsences: StudentAbsence[];
  teachers: Teacher[];
  teacherAbsences: TeacherAbsence[];
  supervisors: User[];
  supervisorRows: SupervisorAbsenceRow[];
  teacherNotes: Record<string, string>;
  canteenEntries: CanteenEntry[];
  canteenTrackingStart: string | null;
}

export interface CanteenRender {
  halfBoarders: number;
  present: number;
  absent: number;
  absentNames: string[];
  source: 'scans' | 'calculated' | 'beforeTracking';
}

export interface SummaryRender {
  students: StudentSummary;
  teachers: PersonCounts;
  supervisors: PersonCounts;
}

export interface Page2Computed {
  periods: number[];
  teacherLines: TeacherLineRender[];
  canteen: CanteenRender;
  levels: LevelAttendance[];
  summary: SummaryRender;
}

export function periodColumns(usedPeriods: number[]): number[] {
  const highest = Math.max(DEFAULT_PERIOD_COLUMNS, ...usedPeriods);
  return Array.from({ length: Math.min(highest, MAX_PERIOD_COLUMNS) }, (_, index) => index + 1);
}

function scannedCanteenRender(
  input: Page2Input,
  scans: CanteenEntry[],
  nameWithClass: (id: string) => string,
): CanteenRender {
  const halfBoarders = input.students.filter(
    (student) => student.deletedAt === null && student.boardingStatus === 'half-boarder' && isEnrolledOn(student, input.date),
  );
  const acceptedIds = new Set(
    scans.filter((entry) => entry.result === 'accepted' && entry.studentId !== null).map((entry) => entry.studentId),
  );
  const absent = halfBoarders.filter((student) => !acceptedIds.has(student.id));
  return {
    halfBoarders: halfBoarders.length,
    present: halfBoarders.length - absent.length,
    absent: absent.length,
    absentNames: absent.map((student) => nameWithClass(student.id)),
    source: 'scans',
  };
}

export function computePage2(input: Page2Input): Page2Computed {
  const activeStudents = input.students.filter((student) => student.deletedAt === null || student.deletedAt === undefined);
  const weekday = weekdayOfDate(input.date);
  const lessonsByClass = new Map(
    input.classes.map((schoolClass) => [
      schoolClass.id,
      classLessonsForDay(input.slots, schoolClass.id, weekday),
    ]),
  );
  const lessonCountByClass = new Map(
    Array.from(lessonsByClass.entries()).map(([classId, lessons]) => [classId, lessons.length]),
  );

  const absenceIndex = indexActiveAbsencesForDate(input.studentAbsences, input.date);
  const totalsByStudent = new Map<string, StudentAbsenceTotals>();
  const wholeDayAbsentByStudent = new Set<string>();
  const absentLastPeriodByStudent = new Set<string>();

  for (const student of activeStudents) {
    const lessons = lessonsByClass.get(student.classId) ?? classLessonsForDay(input.slots, student.classId, weekday);
    const evaluation = evaluateStudentDayAbsence(absenceIndex.get(student.id), lessons);
    if (!evaluation) continue;
    totalsByStudent.set(student.id, evaluation.totals);
    if (evaluation.wholeDay) wholeDayAbsentByStudent.add(student.id);
    if (evaluation.absentLastPeriod) absentLastPeriodByStudent.add(student.id);
  }

  const attendance = {
    classes: input.classes,
    students: activeStudents,
    date: input.date,
    rule: input.rule,
    totalsByStudent,
    lessonCountByClass,
    absentLastPeriodByStudent,
    wholeDayAbsentByStudent,
  };

  const teacherById = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const classNameById = new Map(input.classes.map((schoolClass) => [schoolClass.id, schoolClass.name]));
  const absentTeachers = teacherDayAbsences(input.teacherAbsences, input.date).filter(
    (absence) => absence.hours > 0 && teacherById.has(absence.teacherId),
  );
  const teacherLines: TeacherLineRender[] = absentTeachers.map((absence) => ({
    teacherId: absence.teacherId,
    name: teacherById.get(absence.teacherId)?.name ?? '',
    subjects: formatDailyReportSubjects(absence.lessons.map((lesson) => lesson.subject)),
    marks: absence.lessons.map((lesson) => lesson.period),
    classes: [...new Set(absence.lessons.map((lesson) => classNameById.get(lesson.classId) ?? ''))].join(' / '),
    classByPeriod: Object.fromEntries(
      absence.lessons.map((lesson) => [lesson.period, classNameById.get(lesson.classId) ?? '']),
    ),
    reason: absence.reason ?? '',
    reasonNote: absence.reasonNote ?? '',
    note: input.teacherNotes[absence.teacherId] ?? '',
  }));
  const usedPeriods = teacherLines.flatMap((line) => line.marks);

  const canteen = canteenReport({
    students: input.students,
    date: input.date,
    totalsByStudent,
    lessonCountByClass,
  });
  const studentById = new Map(input.students.map((student) => [student.id, student]));
  const nameWithClass = (id: string) => {
    const student = studentById.get(id);
    return student ? `${student.firstName} ${student.lastName} (${classNameById.get(student.classId) ?? ''})` : '';
  };
  const scans = input.canteenEntries.filter((entry) => entry.deletedAt === null && entry.date === input.date);
  const beforeTracking = input.canteenTrackingStart !== null && input.canteenTrackingStart !== '' && input.date < input.canteenTrackingStart;
  const halfBoarderIds = canteen.absentHalfBoarderIds.length > 0 ? canteen.absentHalfBoarderIds : input.students
    .filter((student) => student.deletedAt === null && student.boardingStatus === 'half-boarder' && isEnrolledOn(student, input.date))
    .map((student) => student.id);
  const canteenRender: CanteenRender =
    beforeTracking
      ? {
          halfBoarders: canteen.halfBoarderCount,
          present: canteen.halfBoarderCount - canteen.absentHalfBoarderIds.length,
          absent: canteen.absentHalfBoarderIds.length,
          absentNames: halfBoarderIds.map(nameWithClass),
          source: 'beforeTracking',
        }
    : scans.length > 0
      ? scannedCanteenRender(input, scans, nameWithClass)
      : {
          halfBoarders: canteen.halfBoarderCount,
          present: 0,
          absent: canteen.halfBoarderCount,
          absentNames: halfBoarderIds.map(nameWithClass),
          source: 'calculated',
        };

  const absentSupervisors = new Set(
    input.supervisorRows
      .filter((row) => row.morning === 'absent' || row.evening === 'absent')
      .map((row) => row.supervisorId ?? row.name),
  );
  const summary: SummaryRender = {
    students: studentSummary(attendance),
    teachers: personCounts(input.teachers.length, absentTeachers.length),
    supervisors: personCounts(input.supervisors.length, absentSupervisors.size),
  };

  return {
    periods: periodColumns(usedPeriods),
    teacherLines,
    canteen: canteenRender,
    levels: levelAttendance(attendance),
    summary,
  };
}

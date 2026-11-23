import type { StudentAbsence, TeacherAbsenceLesson, TimetableSlot } from '@/db/types';
import { slotLessons } from '@/utils/timetableLessons';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type LessonSlot = Pick<TimetableSlot, 'classId' | 'day' | 'period' | 'subject' | 'teacherId'> &
  Partial<Pick<TimetableSlot, 'roomId' | 'groups'>>;

export interface ClassLesson {
  period: number;
  subject: string;
  teacherId: string | null;
}

export function classLessonsForDay(slots: LessonSlot[], classId: string, day: number): ClassLesson[] {
  const targetDay = Number(day);
  const byPeriod = new Map<number, { subjects: string[]; teacherIds: Set<string>; hasNullTeacher: boolean }>();

  for (const slot of slots) {
    if (slot.classId !== classId || Number(slot.day) !== targetDay) continue;
    const period = Number(slot.period);
    if (!Number.isFinite(period)) continue;

    let entry = byPeriod.get(period);
    if (!entry) {
      entry = { subjects: [], teacherIds: new Set<string>(), hasNullTeacher: false };
      byPeriod.set(period, entry);
    }

    for (const lesson of slotLessons(slot)) {
      if (lesson.subject && !entry.subjects.includes(lesson.subject)) {
        entry.subjects.push(lesson.subject);
      }
      if (lesson.teacherId) {
        entry.teacherIds.add(lesson.teacherId);
      } else {
        entry.hasNullTeacher = true;
      }
    }
  }

  return [...byPeriod.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([period, entry]) => ({
      period,
      subject: entry.subjects.join(' / '),
      teacherId: !entry.hasNullTeacher && entry.teacherIds.size === 1 ? [...entry.teacherIds][0] : null,
    }));
}

export function slotHasTeacher(slot: LessonSlot, teacherId: string): boolean {
  return slotLessons(slot).some((lesson) => lesson.teacherId === teacherId);
}

export function teacherLessonsForDay(slots: LessonSlot[], teacherId: string, day: number): TeacherAbsenceLesson[] {
  const targetDay = Number(day);
  const byPeriod = new Map<number, TeacherAbsenceLesson>();
  for (const slot of [...slots].sort((a, b) => Number(a.period) - Number(b.period))) {
    const period = Number(slot.period);
    if (Number(slot.day) !== targetDay || !Number.isFinite(period) || byPeriod.has(period)) continue;
    const lesson = slotLessons(slot).find((item) => item.teacherId === teacherId);
    if (lesson) byPeriod.set(period, { period, classId: slot.classId, subject: lesson.subject });
  }
  return [...byPeriod.values()];
}

export function affectedClassIds(lessons: TeacherAbsenceLesson[]): string[] {
  return [...new Set(lessons.map((lesson) => lesson.classId))].sort();
}

export function teacherAbsenceHours(lessons: TeacherAbsenceLesson[]): number {
  return lessons.length;
}

export interface StudentAbsenceTotals {
  hours: number;
  justifiedHours: number;
  unjustifiedHours: number;
}

export function summarizeStudentAbsences(
  records: Pick<StudentAbsence, 'studentId' | 'justified' | 'date'>[],
  date?: string,
): Map<string, StudentAbsenceTotals> {
  const totals = new Map<string, StudentAbsenceTotals>();
  for (const record of records) {
    if (date !== undefined && record.date !== date) continue;
    const current = totals.get(record.studentId) ?? { hours: 0, justifiedHours: 0, unjustifiedHours: 0 };
    current.hours += 1;
    if (record.justified) current.justifiedHours += 1;
    else current.unjustifiedHours += 1;
    totals.set(record.studentId, current);
  }
  return totals;
}

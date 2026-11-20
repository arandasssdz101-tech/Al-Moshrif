import { db } from './database';
import type {
  CanteenEntry,
  DailyReportRecord,
  Institution,
  Room,
  SchoolClass,
  Student,
  StudentAbsence,
  Teacher,
  TeacherAbsence,
  TimetableSlot,
  User,
} from './types';

const BACKUP_FORMAT = 'school-admin-backup';
const BACKUP_VERSION = 1;

interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  institutions: Institution[];
  users: User[];
  classes: SchoolClass[];
  students: Student[];
  timetableSlots: TimetableSlot[];
  teachers: Teacher[];
  rooms: Room[];
  studentAbsences: StudentAbsence[];
  teacherAbsences: TeacherAbsence[];
  dailyReports?: DailyReportRecord[];
  canteenEntries?: CanteenEntry[];
}

export interface BackupData {
  institutions: Institution[];
  users: User[];
  classes: SchoolClass[];
  students: Student[];
  timetableSlots: TimetableSlot[];
  teachers: Teacher[];
  rooms: Room[];
  studentAbsences: StudentAbsence[];
  teacherAbsences: TeacherAbsence[];
  dailyReports: DailyReportRecord[];
  canteenEntries: CanteenEntry[];
}

export async function exportBackup(): Promise<string> {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    institutions: await db.institutions.toArray(),
    users: await db.users.toArray(),
    classes: await db.classes.toArray(),
    students: await db.students.toArray(),
    timetableSlots: await db.timetableSlots.toArray(),
    teachers: await db.teachers.toArray(),
    rooms: await db.rooms.toArray(),
    studentAbsences: await db.studentAbsences.toArray(),
    teacherAbsences: await db.teacherAbsences.toArray(),
    dailyReports: await db.dailyReports.toArray(),
    canteenEntries: await db.canteenEntries.toArray(),
  };
  return JSON.stringify(file);
}

function isRecordList(value: unknown): value is { id: string; institutionId: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { institutionId?: unknown }).institutionId === 'string',
    )
  );
}

export function parseBackup(text: string): BackupData | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const file = data as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT || file.version !== BACKUP_VERSION) return null;

  const classes = file.classes ?? [];
  const students = file.students ?? [];
  const timetableSlots = file.timetableSlots ?? [];
  const teachers = file.teachers ?? [];
  const rooms = file.rooms ?? [];
  const studentAbsences = file.studentAbsences ?? [];
  const teacherAbsences = file.teacherAbsences ?? [];
  const dailyReports = file.dailyReports ?? [];
  const canteenEntries = file.canteenEntries ?? [];
  if (
    !isRecordList(file.institutions) ||
    !isRecordList(file.users) ||
    !isRecordList(classes) ||
    !isRecordList(students) ||
    !isRecordList(timetableSlots) ||
    !isRecordList(teachers) ||
    !isRecordList(rooms) ||
    !isRecordList(studentAbsences) ||
    !isRecordList(teacherAbsences) ||
    !isRecordList(dailyReports) ||
    !isRecordList(canteenEntries)
  ) {
    return null;
  }
  return {
    institutions: file.institutions as Institution[],
    users: file.users as User[],
    classes: classes as SchoolClass[],
    students: students as Student[],
    timetableSlots: timetableSlots as TimetableSlot[],
    teachers: teachers as Teacher[],
    rooms: rooms as Room[],
    studentAbsences: studentAbsences as StudentAbsence[],
    teacherAbsences: teacherAbsences as TeacherAbsence[],
    dailyReports: dailyReports as DailyReportRecord[],
    canteenEntries: canteenEntries as CanteenEntry[],
  };
}

export async function replaceAllData(data: BackupData): Promise<void> {
  const tables = [
    db.institutions,
    db.users,
    db.classes,
    db.students,
    db.timetableSlots,
    db.teachers,
    db.rooms,
    db.studentAbsences,
    db.teacherAbsences,
    db.dailyReports,
    db.canteenEntries,
  ];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()));
    await db.institutions.bulkPut(data.institutions);
    await db.users.bulkPut(data.users);
    await db.classes.bulkPut(data.classes);
    await db.students.bulkPut(data.students);
    await db.timetableSlots.bulkPut(data.timetableSlots);
    await db.teachers.bulkPut(data.teachers);
    await db.rooms.bulkPut(data.rooms);
    await db.studentAbsences.bulkPut(data.studentAbsences);
    await db.teacherAbsences.bulkPut(data.teacherAbsences);
    await db.dailyReports.bulkPut(data.dailyReports);
    await db.canteenEntries.bulkPut(data.canteenEntries);
  });
}

import { db } from './database';
import type {
  CanteenEntry,
  DailyReportRecord,
  Institution,
  LibraryFile,
  LibraryMeta,
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

export interface SerializedLibraryFile {
  id: string;
  mime: string;
  size: number;
  hash: string;
  dataBase64: string;
}

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
  libraryMeta?: LibraryMeta[];
  libraryFiles?: SerializedLibraryFile[];
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
  libraryMeta?: LibraryMeta[];
  libraryFiles?: SerializedLibraryFile[];
}

export interface ExportBackupOptions {
  includeLibrary?: boolean;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

export async function exportBackup(options: ExportBackupOptions = {}): Promise<string> {
  const includeLibrary = options.includeLibrary === true;
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

  if (includeLibrary) {
    const [metaRows, fileRows] = await Promise.all([
      db.libraryMeta.toArray(),
      db.libraryFiles.toArray(),
    ]);
    file.libraryMeta = metaRows;
    file.libraryFiles = await Promise.all(
      fileRows.map(async (entry) => ({
        id: entry.id,
        mime: entry.mime,
        size: entry.size,
        hash: entry.hash,
        dataBase64: await blobToBase64(entry.blob),
      })),
    );
  }

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

function isLibraryMetaList(value: unknown): value is LibraryMeta[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { title?: unknown }).title === 'string',
    )
  );
}

function isSerializedLibraryFileList(value: unknown): value is SerializedLibraryFile[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { hash?: unknown }).hash === 'string' &&
        typeof (item as { dataBase64?: unknown }).dataBase64 === 'string',
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

  if (file.libraryMeta !== undefined && !isLibraryMetaList(file.libraryMeta)) {
    return null;
  }
  if (file.libraryFiles !== undefined && !isSerializedLibraryFileList(file.libraryFiles)) {
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
    ...(file.libraryMeta !== undefined ? { libraryMeta: file.libraryMeta } : {}),
    ...(file.libraryFiles !== undefined ? { libraryFiles: file.libraryFiles } : {}),
  };
}

export async function replaceAllData(data: BackupData): Promise<void> {
  const hasLibrary = data.libraryMeta !== undefined || data.libraryFiles !== undefined;
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
    ...(hasLibrary ? [db.libraryMeta, db.libraryFiles] : []),
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

    if (hasLibrary) {
      if (data.libraryMeta?.length) {
        await db.libraryMeta.bulkPut(data.libraryMeta);
      }
      if (data.libraryFiles?.length) {
        const restoredFiles: LibraryFile[] = data.libraryFiles.map((entry) => ({
          id: entry.id,
          mime: entry.mime,
          size: entry.size,
          hash: entry.hash,
          blob: base64ToBlob(entry.dataBase64, entry.mime),
        }));
        await db.libraryFiles.bulkPut(restoredFiles);
      }
    }
  });
}

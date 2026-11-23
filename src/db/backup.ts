import { DomainError } from '@/utils/errors';
import { db } from './database';
import type {
  AppNotification,
  CanteenEntry,
  ContinuousAbsence,
  DailyReportRecord,
  EntryDayClosure,
  GateEntry,
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
  continuousAbsences?: ContinuousAbsence[];
  teacherAbsences: TeacherAbsence[];
  dailyReports?: DailyReportRecord[];
  canteenEntries?: CanteenEntry[];
  entries?: GateEntry[];
  entryClosures?: EntryDayClosure[];
  notifications?: AppNotification[];
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
  continuousAbsences?: ContinuousAbsence[];
  teacherAbsences: TeacherAbsence[];
  dailyReports: DailyReportRecord[];
  canteenEntries: CanteenEntry[];
  entries: GateEntry[];
  entryClosures: EntryDayClosure[];
  notifications?: AppNotification[];
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
    continuousAbsences: await db.continuousAbsences.toArray(),
    teacherAbsences: await db.teacherAbsences.toArray(),
    dailyReports: await db.dailyReports.toArray(),
    canteenEntries: await db.canteenEntries.toArray(),
    entries: await db.entries.toArray(),
    entryClosures: await db.entryClosures.toArray(),
    notifications: await db.notifications.toArray(),
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
  const continuousAbsences = file.continuousAbsences ?? [];
  const teacherAbsences = file.teacherAbsences ?? [];
  const dailyReports = file.dailyReports ?? [];
  const canteenEntries = file.canteenEntries ?? [];
  const entries = file.entries ?? [];
  const entryClosures = file.entryClosures ?? [];
  const notifications = file.notifications ?? [];
  if (
    !isRecordList(file.institutions) ||
    !isRecordList(file.users) ||
    !isRecordList(classes) ||
    !isRecordList(students) ||
    !isRecordList(timetableSlots) ||
    !isRecordList(teachers) ||
    !isRecordList(rooms) ||
    !isRecordList(studentAbsences) ||
    !isRecordList(continuousAbsences) ||
    !isRecordList(teacherAbsences) ||
    !isRecordList(dailyReports) ||
    !isRecordList(canteenEntries) ||
    !isRecordList(entries) ||
    !isRecordList(entryClosures) ||
    !isRecordList(notifications)
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
    continuousAbsences: continuousAbsences as ContinuousAbsence[],
    teacherAbsences: teacherAbsences as TeacherAbsence[],
    dailyReports: dailyReports as DailyReportRecord[],
    canteenEntries: canteenEntries as CanteenEntry[],
    entries: entries as GateEntry[],
    entryClosures: entryClosures as EntryDayClosure[],
    notifications: notifications as AppNotification[],
    ...(file.libraryMeta !== undefined ? { libraryMeta: file.libraryMeta } : {}),
    ...(file.libraryFiles !== undefined ? { libraryFiles: file.libraryFiles } : {}),
  };
}

export interface BackupSummary {
  institutionNames: string[];
  activeUserCount: number;
  studentCount: number;
  hasLibrary: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidAuthBackup(data: BackupData): boolean {
  const activeInstitutionIds = new Set(
    data.institutions
      .filter((inst) => inst.deletedAt == null && isNonEmptyString(inst.name))
      .map((inst) => inst.id),
  );
  if (activeInstitutionIds.size === 0) return false;

  return data.users.some(
    (user) =>
      user.deletedAt == null &&
      user.status !== 'rejected' &&
      activeInstitutionIds.has(user.institutionId) &&
      (user.role === 'head' || user.role === 'supervisor') &&
      isNonEmptyString(user.usernameKey) &&
      isNonEmptyString(user.passwordHash),
  );
}

export function summarizeBackup(data: BackupData): BackupSummary {
  const activeInstitutions = data.institutions.filter(
    (inst) => inst.deletedAt == null && isNonEmptyString(inst.name),
  );
  const activeInstitutionIds = new Set(activeInstitutions.map((inst) => inst.id));
  const activeUserCount = data.users.filter(
    (user) =>
      user.deletedAt == null &&
      user.status !== 'rejected' &&
      activeInstitutionIds.has(user.institutionId),
  ).length;
  const studentCount = data.students.filter(
    (student) => student.deletedAt == null && activeInstitutionIds.has(student.institutionId),
  ).length;

  return {
    institutionNames: activeInstitutions.map((inst) => inst.name.trim()),
    activeUserCount,
    studentCount,
    hasLibrary: Boolean(data.libraryFiles?.length || data.libraryMeta?.length),
  };
}

export async function hasExistingLocalData(): Promise<boolean> {
  const [institutionCount, userCount] = await Promise.all([
    db.institutions.count(),
    db.users.count(),
  ]);
  return institutionCount > 0 || userCount > 0;
}

export async function replaceAllData(data: BackupData): Promise<void> {
  const hasLibrary = data.libraryMeta !== undefined || data.libraryFiles !== undefined;
  let restoredFiles: LibraryFile[] = [];
  if (hasLibrary && data.libraryFiles?.length) {
    try {
      restoredFiles = data.libraryFiles.map((entry) => ({
        id: entry.id,
        mime: entry.mime,
        size: entry.size,
        hash: entry.hash,
        blob: base64ToBlob(entry.dataBase64, entry.mime),
      }));
    } catch {
      throw new DomainError('institution.restoreInvalid');
    }
  }

  const tables = [
    db.institutions,
    db.users,
    db.classes,
    db.students,
    db.timetableSlots,
    db.teachers,
    db.rooms,
    db.studentAbsences,
    db.continuousAbsences,
    db.teacherAbsences,
    db.dailyReports,
    db.canteenEntries,
    db.entries,
    db.entryClosures,
    db.notifications,
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
    if (data.continuousAbsences?.length) {
      await db.continuousAbsences.bulkPut(data.continuousAbsences);
    }
    await db.teacherAbsences.bulkPut(data.teacherAbsences);
    await db.dailyReports.bulkPut(data.dailyReports);
    await db.canteenEntries.bulkPut(data.canteenEntries);
    if (data.entries?.length) {
      await db.entries.bulkPut(data.entries);
    }
    if (data.entryClosures?.length) {
      await db.entryClosures.bulkPut(data.entryClosures);
    }
    if (data.notifications?.length) {
      await db.notifications.bulkPut(data.notifications);
    }

    if (hasLibrary) {
      if (data.libraryMeta?.length) {
        await db.libraryMeta.bulkPut(data.libraryMeta);
      }
      if (restoredFiles.length) {
        await db.libraryFiles.bulkPut(restoredFiles);
      }
    }
  });
}

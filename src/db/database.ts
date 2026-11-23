import Dexie, { type Table } from 'dexie';
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

export interface OutboxEntry {
  id: string;
  institutionId: string;
  tableName: string;
  recordId: string;
  updatedAt: string;
  payload: string;
  retries: number;
  createdAt: string;
}

class SchoolDatabase extends Dexie {
  institutions!: Table<Institution, string>;
  users!: Table<User, string>;
  classes!: Table<SchoolClass, string>;
  students!: Table<Student, string>;
  timetableSlots!: Table<TimetableSlot, string>;
  teachers!: Table<Teacher, string>;
  rooms!: Table<Room, string>;
  studentAbsences!: Table<StudentAbsence, string>;
  continuousAbsences!: Table<ContinuousAbsence, string>;
  teacherAbsences!: Table<TeacherAbsence, string>;
  outbox!: Table<OutboxEntry, string>;
  dailyReports!: Table<DailyReportRecord, string>;
  canteenEntries!: Table<CanteenEntry, string>;
  libraryMeta!: Table<LibraryMeta, string>;
  libraryFiles!: Table<LibraryFile, string>;
  entries!: Table<GateEntry, string>;
  entryClosures!: Table<EntryDayClosure, string>;
  notifications!: Table<AppNotification, string>;

  constructor() {
    super('school-admin');
    this.version(1).stores({
      institutions: 'id, inviteCode',
      users: 'id, institutionId, usernameKey, status',
    });
    this.version(2).stores({
      classes: 'id, institutionId',
      students: 'id, institutionId, classId',
    });
    this.version(3).stores({
      timetableSlots: 'id, institutionId, classId',
      teachers: 'id, institutionId',
      rooms: 'id, institutionId',
    });
    this.version(4).stores({
      studentAbsences: 'id, institutionId, classId',
      teacherAbsences: 'id, institutionId, teacherId',
    });
    this.version(5).stores({
      outbox: 'id, institutionId, tableName, updatedAt',
    });
    this.version(6).stores({
      dailyReports: 'id, institutionId, date',
    });
    this.version(7).stores({
      canteenEntries: 'id, institutionId, date, studentId',
    });
    this.version(8).stores({
      students: 'id, institutionId, classId, cardCode',
    });
    this.version(9)
      .stores({
        libraryMeta: 'id, category, addedAt, lastOpenedAt, favorite, builtIn, hidden',
        libraryFiles: 'id, hash',
      })
      .upgrade(() => {
        // Non-destructive upgrade: existing tables and records remain intact.
      });
    this.version(10)
      .stores({
        entries: 'id, institutionId, date, [date+studentId]',
        entryClosures: 'id, institutionId, date',
      })
      .upgrade(() => {
        // Non-destructive upgrade: existing tables and records remain intact.
      });
    this.version(11)
      .stores({
        continuousAbsences: 'id, institutionId, studentId, classId',
      })
      .upgrade(() => {
        // Non-destructive upgrade: existing tables and records remain intact.
      });
    this.version(12)
      .stores({
        notifications: 'id, institutionId, kind, read, resolved, createdAt',
      })
      .upgrade(() => {
        // Non-destructive upgrade: existing tables and records remain intact.
      });
  }
}

export const db = new SchoolDatabase();

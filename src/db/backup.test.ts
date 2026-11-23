import { describe, expect, it } from 'vitest';
import { isValidAuthBackup, parseBackup, summarizeBackup, type BackupData } from '@/db/backup';

const BASE_BACKUP = {
  format: 'school-admin-backup',
  version: 1,
  exportedAt: '2026-11-20T00:00:00.000Z',
  institutions: [{ id: 'inst-1', institutionId: 'inst-1' }],
  users: [{ id: 'user-1', institutionId: 'inst-1' }],
};

function makeAuthBackup(overrides: Partial<BackupData> = {}): BackupData {
  return {
    institutions: [
      {
        id: 'inst-1',
        institutionId: 'inst-1',
        name: 'ثانوية الأمير عبد القادر',
        inviteCode: 'ABCD-EFGH',
        workingDays: [0, 1, 2, 3, 4],
        holidays: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        createdBy: 'user-1',
        updatedBy: 'user-1',
        deletedAt: null,
      },
    ],
    users: [
      {
        id: 'user-1',
        institutionId: 'inst-1',
        name: 'رئيس المشرفين',
        usernameKey: 'admin',
        passwordHash: 'pbkdf2$100000$salt$hash',
        role: 'head',
        status: 'approved',
        permissions: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        createdBy: 'user-1',
        updatedBy: 'user-1',
        deletedAt: null,
      },
    ],
    classes: [],
    students: [],
    timetableSlots: [],
    teachers: [],
    rooms: [],
    studentAbsences: [],
    teacherAbsences: [],
    dailyReports: [],
    canteenEntries: [],
    entries: [],
    entryClosures: [],
    ...overrides,
  };
}

describe('parseBackup', () => {
  it('parses legacy backups without dailyReports or canteenEntries', () => {
    const parsed = parseBackup(JSON.stringify(BASE_BACKUP));
    expect(parsed).not.toBeNull();
    expect(parsed?.dailyReports).toEqual([]);
    expect(parsed?.canteenEntries).toEqual([]);
  });

  it('preserves dailyReports and canteenEntries when present', () => {
    const full = {
      ...BASE_BACKUP,
      dailyReports: [{ id: 'dr-1', institutionId: 'inst-1', date: '2026-11-20' }],
      canteenEntries: [{ id: 'ce-1', institutionId: 'inst-1', date: '2026-11-20' }],
    };
    const parsed = parseBackup(JSON.stringify(full));
    expect(parsed).not.toBeNull();
    expect(parsed?.dailyReports).toHaveLength(1);
    expect(parsed?.canteenEntries).toHaveLength(1);
  });

  it('rejects malformed or wrong-format backups', () => {
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup(JSON.stringify({ format: 'other', version: 1 }))).toBeNull();
    expect(
      parseBackup(JSON.stringify({ ...BASE_BACKUP, dailyReports: [{ invalid: true }] })),
    ).toBeNull();
  });
});

describe('isValidAuthBackup & summarizeBackup', () => {
  it('accepts backups with an active institution and active user credentials', () => {
    const backup = makeAuthBackup();
    expect(isValidAuthBackup(backup)).toBe(true);
    expect(summarizeBackup(backup)).toEqual({
      institutionNames: ['ثانوية الأمير عبد القادر'],
      activeUserCount: 1,
      studentCount: 0,
      hasLibrary: false,
    });
  });

  it('rejects backups with no active institution or only deleted/rejected accounts', () => {
    const noInstitutions = makeAuthBackup({ institutions: [] });
    expect(isValidAuthBackup(noInstitutions)).toBe(false);

    const rejectedOnly = makeAuthBackup({
      users: [{ ...makeAuthBackup().users[0], status: 'rejected' }],
    });
    expect(isValidAuthBackup(rejectedOnly)).toBe(false);

    const deletedOnly = makeAuthBackup({
      users: [{ ...makeAuthBackup().users[0], deletedAt: '2026-10-01T00:00:00.000Z' }],
    });
    expect(isValidAuthBackup(deletedOnly)).toBe(false);

    const missingPasswordHash = makeAuthBackup({
      users: [{ ...makeAuthBackup().users[0], passwordHash: '' }],
    });
    expect(isValidAuthBackup(missingPasswordHash)).toBe(false);
  });

  it('excludes deleted records from backup summary counts', () => {
    const base = makeAuthBackup();
    const summary = summarizeBackup(
      makeAuthBackup({
        users: [
          base.users[0],
          { ...base.users[0], id: 'user-2', usernameKey: 'sup1', role: 'supervisor' },
          { ...base.users[0], id: 'user-3', usernameKey: 'deleted', deletedAt: '2026-10-01T00:00:00.000Z' },
        ],
      }),
    );
    expect(summary.activeUserCount).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { parseBackup } from '@/db/backup';

const BASE_BACKUP = {
  format: 'school-admin-backup',
  version: 1,
  exportedAt: '2026-11-20T00:00:00.000Z',
  institutions: [{ id: 'inst-1', institutionId: 'inst-1' }],
  users: [{ id: 'user-1', institutionId: 'inst-1' }],
};

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

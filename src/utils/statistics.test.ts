import { describe, expect, it } from 'vitest';
import type { SchoolClass, Student } from '@/db/types';
import { buildClassStatistics, sumClassStatistics } from '@/utils/statistics';

function makeClass(id: string, name: string, level: number): SchoolClass {
  return {
    id,
    institutionId: 'inst-1',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
    deletedAt: null,
    updatedBy: 'user-1',
    name,
    level,
  };
}

function makeStudent(overrides: Partial<Student>): Student {
  return {
    id: 'stu-1',
    institutionId: 'inst-1',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
    deletedAt: null,
    updatedBy: 'user-1',
    firstName: 'أحمد',
    lastName: 'سالم',
    gender: 'male',
    dateOfBirth: '2013-01-01',
    placeOfBirth: 'البليدة',
    repeater: false,
    boardingStatus: 'external',
    classId: 'c1',
    joinDate: '2026-09-01',
    leaveDate: null,
    ...overrides,
  };
}

describe('Student statistics with repeaters breakdown', () => {
  it('computes boys, girls, and total repeaters per class and across classes while excluding inactive students', () => {
    const classes = [makeClass('c1', '1م1', 1), makeClass('c2', '2م1', 2)];
    const students: Student[] = [
      makeStudent({ id: 's1', classId: 'c1', gender: 'male', repeater: true, boardingStatus: 'half-boarder' }),
      makeStudent({ id: 's2', classId: 'c1', gender: 'male', repeater: true, boardingStatus: 'external' }),
      makeStudent({ id: 's3', classId: 'c1', gender: 'female', repeater: true, boardingStatus: 'half-boarder' }),
      makeStudent({ id: 's4', classId: 'c1', gender: 'female', repeater: false, boardingStatus: 'external' }),
      // Inactive (left school) repeater should be ignored
      makeStudent({ id: 's5', classId: 'c1', gender: 'male', repeater: true, leaveDate: '2026-10-01' }),
      // Second class
      makeStudent({ id: 's6', classId: 'c2', gender: 'female', repeater: true, boardingStatus: 'external' }),
      makeStudent({ id: 's7', classId: 'c2', gender: 'male', repeater: false, boardingStatus: 'half-boarder' }),
    ];

    const rows = buildClassStatistics(classes, students, '2026-11-21');
    expect(rows[0].students).toEqual({ boys: 2, girls: 2, total: 4 });
    expect(rows[0].halfBoarders).toEqual({ boys: 1, girls: 1, total: 2 });
    expect(rows[0].repeaters).toEqual({ boys: 2, girls: 1, total: 3 });

    expect(rows[1].students).toEqual({ boys: 1, girls: 1, total: 2 });
    expect(rows[1].repeaters).toEqual({ boys: 0, girls: 1, total: 1 });

    const totals = sumClassStatistics(rows);
    expect(totals.students).toEqual({ boys: 3, girls: 3, total: 6 });
    expect(totals.halfBoarders).toEqual({ boys: 2, girls: 1, total: 3 });
    expect(totals.repeaters).toEqual({ boys: 2, girls: 2, total: 4 });
  });
});

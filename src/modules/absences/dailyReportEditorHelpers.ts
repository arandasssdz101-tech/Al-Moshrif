import type { ParentCorrespondenceRow, SupervisorAbsenceRow } from '@/db/types';

export const INPUT_CLASS =
  'min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';

export function emptyParentRow(): ParentCorrespondenceRow {
  return {
    studentId: null,
    name: '',
    className: '',
    hours: '',
    absenceDate: '',
    reason: '',
    firstNotice: '',
    secondNotice: '',
    excuse: '',
    struckDate: '',
  };
}

export function emptySupervisorRow(): SupervisorAbsenceRow {
  return { supervisorId: null, name: '', morning: 'none', evening: 'none', notes: '' };
}

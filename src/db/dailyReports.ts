import { emitAppDataChanged } from '@/utils/dataEvents';
import { DomainError } from '@/utils/errors';
import { schoolYearForDate } from '@/utils/schoolYear';
import { getModuleAccess } from './access';
import { db } from './database';
import { assertHeadActor } from './users';
import type { DailyReportRecord, ParentCorrespondenceRow, SupervisorAbsenceRow } from './types';

export type DailyReportInput = {
  reportNumber: string;
  schoolYear: string;
  parentRows: ParentCorrespondenceRow[];
  counselorNotes: string;
  directorNotes: string;
  observationsActions: string;
  canteenNote: string;
  mealServed: string;
  plannedMeal: string;
  canteenEnteredCount?: number | null;
  canteenSupervisors: string[];
  supervisorRows: SupervisorAbsenceRow[];
  teacherNotes: Record<string, string>;
};

export interface CanteenDailyInfoPatch {
  mealServed?: string;
  plannedMeal?: string;
  canteenNote?: string;
  canteenEnteredCount?: number | null;
  canteenSupervisors?: string[];
  supervisorRows?: SupervisorAbsenceRow[];
}

export function dailyReportId(institutionId: string, date: string): string {
  return `${institutionId}|${date}`;
}

export function loadDailyReport(institutionId: string, date: string): Promise<DailyReportRecord | undefined> {
  return db.dailyReports.get(dailyReportId(institutionId, date));
}

export async function saveDailyReport(
  institutionId: string,
  date: string,
  input: DailyReportInput,
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  await db.dailyReports.put({
    ...input,
    canteenEnteredCount: input.canteenEnteredCount ?? null,
    id: dailyReportId(institutionId, date),
    institutionId,
    date,
    updatedAt: new Date().toISOString(),
  });
  emitAppDataChanged(['dailyReports', 'canteen'], { date, reason: 'save-daily-report' });
}

export async function saveCanteenDailyInfo(
  institutionId: string,
  date: string,
  patch: CanteenDailyInfoPatch,
  actorId: string,
): Promise<void> {
  const access = await getModuleAccess(actorId, 'canteen');
  if (!access.isHead && !access.canEdit) {
    throw new DomainError('errors.notAuthorized');
  }
  const id = dailyReportId(institutionId, date);
  const existing = await db.dailyReports.get(id);
  const record: DailyReportRecord = existing
    ? { ...existing, ...patch, updatedAt: new Date().toISOString() }
    : {
        id,
        institutionId,
        date,
        reportNumber: '',
        schoolYear: schoolYearForDate(date),
        parentRows: [],
        counselorNotes: '',
        directorNotes: '',
        observationsActions: '',
        canteenNote: '',
        mealServed: '',
        plannedMeal: '',
        canteenEnteredCount: null,
        canteenSupervisors: [],
        supervisorRows: patch.supervisorRows ?? [],
        teacherNotes: {},
        updatedAt: new Date().toISOString(),
      };
  if (patch.mealServed !== undefined) record.mealServed = patch.mealServed;
  if (patch.plannedMeal !== undefined) record.plannedMeal = patch.plannedMeal;
  if (patch.canteenNote !== undefined) record.canteenNote = patch.canteenNote;
  if (patch.canteenEnteredCount !== undefined) record.canteenEnteredCount = patch.canteenEnteredCount;
  if (patch.canteenSupervisors !== undefined) record.canteenSupervisors = patch.canteenSupervisors;
  if (patch.supervisorRows !== undefined) record.supervisorRows = patch.supervisorRows;
  await db.dailyReports.put(record);
  emitAppDataChanged(['dailyReports', 'canteen'], { date, reason: 'save-canteen-daily-info' });
}
